import { useEffect, useRef, useState } from 'react';
import {
  useTanks,
  useConfig,
  useNotifications,
  useWorkerStatus,
  addSystemLog,
  serverNow,
  isTankPlanned,
  isTankControllerOffline,
  syncTankOfflineState,
} from '@/store/useStore';
import { evaluateTank, createTankTrackers, offlineThresholdMs, ALERT_SERVICE_OFFLINE_ID, type TankTrackers } from '@/lib/alertEngine';
import { toast } from 'sonner';
import { alertSound } from '@/utils/alertSound';

const APP_TITLE = 'MSU Water Monitoring';
/** How often the browser re-checks timers (5 s validation, offline watchdog) when it is the evaluator. */
const EVALUATION_TICK_MS = 2000;
/** The Alert Service must be gone this long before users are told (restarts and redeploys stay quiet). */
const SERVICE_DOWN_GRACE_MS = 60_000;

/**
 * SystemMonitor
 * Headless component mounted on every signed-in page. It has two jobs:
 *
 * 1. Presentation (always): alarm sound, tab-title flash, a toast and an optional desktop
 *    notification for each new alert, driven purely by what is in /notifications.
 *
 * 2. Evaluation (fallback only): when the server-side worker is running it owns alert
 *    evaluation and this component stays passive. If the worker's heartbeat goes stale,
 *    this component evaluates alerts itself with the same shared engine, so alerts keep
 *    working while at least one dashboard is open. Raises and resolves are database
 *    transactions, so several open browsers cannot duplicate or reopen an alert.
 */
const SystemMonitor = () => {
  const { tanks, serverTimeOffset } = useTanks();
  const { config } = useConfig();
  const { notifications, addNotification, resolveNotification } = useNotifications();
  const { active: workerActive, loaded: workerLoaded } = useWorkerStatus();

  const trackers = useRef<Record<string, TankTrackers>>({});
  const inFlightOffline = useRef<Set<string>>(new Set());
  const announced = useRef<Map<string, number>>(new Map());
  const serviceDownSince = useRef<number | null>(null);
  const serviceNoticeRaised = useRef(false);
  const mountedAt = useRef<number>(serverNow());
  const [tick, setTick] = useState(0);

  const activeAlertCount = notifications.filter(
    n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged && !n.resolved
  ).length;

  // 1. Alarm sound follows unacknowledged, unresolved alerts
  useEffect(() => {
    if (config?.maintenanceMode || config?.soundEnabled === false || activeAlertCount === 0) {
      alertSound.stopAlert();
    } else {
      alertSound.startAlert();
    }
  }, [activeAlertCount, config?.maintenanceMode, config?.soundEnabled]);

  useEffect(() => () => alertSound.stopAlert(), []);

  // 2. Tab title flashes while alerts are active, so a background tab is noticeable
  useEffect(() => {
    if (activeAlertCount === 0) {
      document.title = APP_TITLE;
      return;
    }
    let flash = false;
    const interval = setInterval(() => {
      document.title = flash ? `(${activeAlertCount}) ALERT — MSU Water` : `(${activeAlertCount}) Active alert${activeAlertCount > 1 ? 's' : ''}`;
      flash = !flash;
    }, 1000);
    return () => {
      clearInterval(interval);
      document.title = APP_TITLE;
    };
  }, [activeAlertCount]);

  // 3. Announce notifications that arrive (or are re-announced) after this page loaded.
  //    Works the same whether the worker or a browser created them.
  useEffect(() => {
    notifications.forEach((n) => {
      if (n.acknowledged || n.resolved) toast.dismiss(n.id);

      const stamp = Math.max(n.timestamp || 0, n.lastRepeatedAt || 0);
      if (announced.current.get(n.id) === stamp) return;
      announced.current.set(n.id, stamp);
      if (stamp < mountedAt.current - 2000 || config?.maintenanceMode) return;

      if (n.type === 'info') {
        toast.success(n.message, { id: n.id });
        return;
      }
      if (n.acknowledged || n.resolved) return;

      toast[n.type === 'warning' ? 'warning' : 'error'](n.message, { id: n.id, duration: 15000 });

      if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted' && document.hidden) {
        try {
          // `tag` makes the browser replace, not stack, repeats of the same alert
          new window.Notification(n.title, { body: n.message, tag: n.id });
        } catch {
          // Some browsers only allow notifications from a service worker
        }
      }
    });
  }, [notifications, config?.maintenanceMode]);

  // Timer for the fallback evaluator: validation windows and the offline watchdog must
  // advance even when no new telemetry arrives (which is exactly the offline case).
  useEffect(() => {
    if (workerActive) return;
    const interval = setInterval(() => setTick(t => t + 1), EVALUATION_TICK_MS);
    return () => clearInterval(interval);
  }, [workerActive]);

  // 4. Fallback: controller-offline watchdog (R3)
  useEffect(() => {
    if (workerActive || config?.maintenanceMode) return;
    const thresholdMs = offlineThresholdMs(config);

    tanks.forEach((tank) => {
      if (!tank.id || isTankPlanned(tank) || !tank.enabled) return;
      if (inFlightOffline.current.has(tank.id)) return;

      const isOffline = isTankControllerOffline(tank, serverTimeOffset, thresholdMs);
      if (isOffline === (tank.controllerOffline ?? false)) return;

      inFlightOffline.current.add(tank.id);
      syncTankOfflineState(tank.id, tank.name, isOffline, addSystemLog, { addNotification, resolveNotification }, thresholdMs / 1000)
        .finally(() => inFlightOffline.current.delete(tank.id));
    });
  }, [tanks, config, serverTimeOffset, workerActive, tick, addNotification, resolveNotification]);

  // 5. Fallback: threshold and sensor-fault alerts through the shared engine
  useEffect(() => {
    if (workerActive) {
      trackers.current = {}; // the worker owns state; start clean if we ever take over
      return;
    }
    const now = Date.now();
    const byId = new Map(notifications.map(n => [n.id, n]));

    const thresholdMs = offlineThresholdMs(config);

    tanks.forEach((tank) => {
      if (!tank.id) return;
      // An offline controller's last readings are stale: never start alerts from them
      if (isTankControllerOffline(tank, serverTimeOffset, thresholdMs)) return;
      const tankTrackers = (trackers.current[tank.id] ??= createTankTrackers());
      const events = evaluateTank({ tank, config, trackers: tankTrackers, now, getExisting: id => byId.get(id) });

      events.forEach((event) => {
        if (event.kind === 'recover') {
          Promise.resolve(resolveNotification(event.notifId))
            .then((resolved) => {
              // Only the client whose transaction resolved the alert writes the recovery row
              if (!resolved) return;
              return addNotification({
                tankId: event.tankId,
                title: event.title,
                message: event.message,
                type: 'info',
                acknowledged: true,
                resolved: true,
              });
            })
            .catch((err) => console.error('Error resolving alert:', err));
        } else {
          Promise.resolve(addNotification({
            id: event.notifId,
            tankId: event.tankId,
            title: event.title,
            message: event.message,
            type: event.level,
            acknowledged: false,
            resolved: false,
          })).catch((err) => console.error('Error raising alert:', err));
        }
      });
    });
  }, [tanks, config, notifications, workerActive, tick, serverTimeOffset, addNotification, resolveNotification]);

  // 6. Tell users when the Alert Service stops: it cannot announce its own outage, and push
  //    notifications pause until it is back. Raised once per outage by this browser after
  //    SERVICE_DOWN_GRACE_MS (so a restart or redeploy stays quiet; the database transaction keeps
  //    several browsers to one record) and resolved when the heartbeat returns.
  useEffect(() => {
    if (!workerLoaded) return;
    const existing = notifications.find(n => n.id === ALERT_SERVICE_OFFLINE_ID);
    const open = !!existing && !existing.resolved;
    if (!workerActive) {
      const now = Date.now();
      serviceDownSince.current ??= now;
      if (open || config?.maintenanceMode || serviceNoticeRaised.current) return;
      if (now - serviceDownSince.current < SERVICE_DOWN_GRACE_MS) return;
      serviceNoticeRaised.current = true;
      Promise.resolve(addNotification({
        id: ALERT_SERVICE_OFFLINE_ID,
        title: 'Alert Service Offline',
        message: 'The cloud-hosted Alert Service stopped sending its heartbeat. Open dashboards keep checking alerts, but push notifications are paused until it is back.',
        type: 'warning',
        acknowledged: false,
        resolved: false,
      })).catch((err) => console.error('Error raising Alert Service notice:', err));
    } else {
      serviceDownSince.current = null;
      serviceNoticeRaised.current = false;
      if (open) {
        Promise.resolve(resolveNotification(ALERT_SERVICE_OFFLINE_ID))
          .catch((err) => console.error('Error resolving Alert Service notice:', err));
      }
    }
  }, [workerActive, workerLoaded, notifications, tick, config?.maintenanceMode, addNotification, resolveNotification]);

  return null;
};

export default SystemMonitor;
