/**
 * @file useStore.ts
 * @description Centralized state management for the Water Monitoring System.
 *
 * This store orchestrates the end‑to‑end telemetry flow between the ESP32 firmware,
 * Firebase Realtime Database, and the React frontend. Sensor data (water level,
 * pH, RSSI, connection status) is streamed from the ESP32, persisted in
 * Firebase, and synchronized here via onValue listeners. The UI components pull
 * from this store to render dashboards, logs, notifications, and configuration
 * panels.
 *
 * Key responsibilities include:
 *   • Loading initial state from localStorage for offline resilience.
 *   • Subscribing to Firebase paths for real‑time updates of users, tanks,
 *     configuration, notifications, and logs.
 *   • Providing CRUD helper functions (addUser, updateTank, addLog, etc.) that
 *     write back to Firebase and update local cache.
 *   • Exposing utility hooks (useAuth, useClock) used throughout the app.
 *
 * The architecture follows a unidirectional data flow: ESP32 → Firebase →
 * useStore (real‑time listeners) → React components. This ensures the UI always
 * reflects the latest telemetry while keeping the codebase modular and testable.
 */
import { useState, useEffect, useCallback } from 'react';
import { database, auth } from '@/config/firebase';
import { ref, onValue, set, update, push, remove, runTransaction, query, orderByChild, limitToLast, get } from 'firebase/database';

export type UserRole = 'admin' | 'worker' | 'viewer';
export type TankStatus = 'safe' | 'warning' | 'danger' | 'offline';

export interface User {
  id: string;
  username: string;
  password?: string;
  role: UserRole;
  jobTitle: string;
  status: 'active' | 'inactive';
}

export interface Tank {
  id: string;
  name: string;
  waterLevel: number;
  phLevel: number;
  waterHeight: number;
  status: TankStatus;
  assignedWorker: string | null;
  pumpOn: boolean;
  enabled: boolean;
  
  /**
   * Calibration parameters used to convert raw sensor voltages to meaningful values.
   * These are configurable per‑tank to allow fine‑tuning of sensor accuracy.
   */
  /** Minimum voltage reading for the water level sensor (V) */
  levelVmin: number;
  /** Maximum voltage reading for the water level sensor (V) */
  levelVmax: number;
  /** Physical height of the tank (meters) */
  tankHeight: number;
  /** User‑defined offset applied to the calculated water level */
  levelOffset: number;
  /** Voltage reading corresponding to neutral pH (7.0) */
  phNeutralVoltage: number;
  /** Slope factor to convert voltage difference to pH units */
  phSlope: number;
  /** Additional offset applied to pH calculation */
  phOffset: number;

  // Sensor Validation Status
  phSensorOk: boolean;
  levelSensorOk: boolean;

  // Stable Alert States
  lowLevelAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  highLevelAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  phAlert?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';

  // Connection Telemetry Fields
  lastUpdate?: number;
  rssi?: number;
  wifiConnected?: boolean;
  firebaseConnected?: boolean;
  ethConnected?: boolean;
  location?: string;
  controllerOffline?: boolean;
}

export interface SystemConfig {
  lowLevelThreshold: number;
  overflowThreshold: number;
  minPh: number;
  maxPh: number;
  maintenanceMode: boolean;
  pumpControlLock: boolean;
  offlineThresholdSec?: number;
  repeatIntervalSec?: number;
  soundEnabled?: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'danger';
  timestamp: number;
  read: boolean;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolved?: boolean;
  resolvedAt?: number;
  /** UID of the operator who acknowledged; database rules require it to match the signed-in user */
  acknowledgedByUid?: string;
  /** Tank this notification belongs to (used by history filters) */
  tankId?: string;
  /** Last time an unacknowledged active alert was re-announced */
  lastRepeatedAt?: number;
}

/**
   * Represents an event log entry recorded by the system.
   */
  export interface Log {
    /** Unique identifier for the log entry */
    id: string;
    /** Short description of the action performed */
    action: string;
    /** Detailed information about the event */
    details: string;
    /** Identifier of the user or system component that triggered the log */
    performedBy: string;
    /** Unix timestamp (ms) when the log was created */
    timestamp: number;
    /** Severity level of the log entry */
    logLevel?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  }

const DEFAULT_TANKS: Tank[] = [
  {
    id: '1',
    name: 'Reservoir Tank 1',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    enabled: true,
    levelVmin: 0.25,
    levelVmax: 3.0,
    tankHeight: 5.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // No lastUpdate here on purpose: a tank only counts as live once its controller has reported
    controllerOffline: false,
  },
  {
    id: '2',
    name: 'Reservoir Tank 2',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    enabled: true,
    levelVmin: 0.25,
    levelVmax: 3.0,
    tankHeight: 5.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
    controllerOffline: false,
  },
  {
    id: '3',
    name: 'Reservoir Tank 3',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    enabled: true,
    levelVmin: 0.25,
    levelVmax: 3.0,
    tankHeight: 5.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
    controllerOffline: false,
  },
  {
    id: '4',
    name: 'Reservoir Tank 4',
    waterLevel: 0,
    phLevel: 7.0,
    waterHeight: 0,
    status: 'safe',
    assignedWorker: null,
    pumpOn: false,
    enabled: true,
    levelVmin: 0.25,
    levelVmax: 3.0,
    tankHeight: 5.0,
    levelOffset: 0,
    phNeutralVoltage: 2.5,
    phSlope: 0.18,
    phOffset: 0.0,
    phSensorOk: true,
    levelSensorOk: true,
    lowLevelAlert: 'NORMAL',
    highLevelAlert: 'NORMAL',
    phAlert: 'NORMAL',
    // Planned expansion tank: IoT not yet installed (never had lastUpdate)
    controllerOffline: false,
  },
];

const DEFAULT_CONFIG: SystemConfig = {
  lowLevelThreshold: 15,
  overflowThreshold: 95,
  minPh: 6.5,
  maxPh: 8.5,
  maintenanceMode: false,
  pumpControlLock: false,
  offlineThresholdSec: 30,
  repeatIntervalSec: 60,
  soundEnabled: true,
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch { return fallback; }
}

function saveToStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Hook to retrieve Firebase server time offset from '/.info/serverTimeOffset'.
 * Realtime Database measures the difference in milliseconds between the client's clock
 * and Firebase server time.
 * Estimated Server Time = Date.now() + serverTimeOffset
 */
export function useServerTimeOffset(): number {
  const [offset, setOffset] = useState<number>(0);

  useEffect(() => {
    const offsetRef = ref(database, '.info/serverTimeOffset');
    const unsubscribe = onValue(
      offsetRef,
      (snapshot) => {
        const val = snapshot.val();
        if (typeof val === 'number') {
          setOffset(val);
        }
      },
      (error) => {
        console.error('Error reading serverTimeOffset from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  return offset;
}

export const CONTROLLER_OFFLINE_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Checks whether a tank is a planned expansion tank (IoT hardware not yet installed).
 * Rule: A tank is "planned" only if it has never had a lastUpdate.
 */
export function isTankPlanned(tank: Tank | null | undefined): boolean {
  if (!tank) return false;
  return !tank.lastUpdate;
}

/**
 * Checks whether a tank's controller is offline by comparing its lastUpdate
 * against the estimated Firebase server time (Date.now() + serverTimeOffset).
 * Rule: A tank with an old lastUpdate is "offline", not "planned".
 * A tank that has never had a lastUpdate is "planned", not "offline".
 */
export function isTankControllerOffline(tank: Tank, serverTimeOffset: number = 0, thresholdMs: number = CONTROLLER_OFFLINE_THRESHOLD_MS): boolean {
  if (!tank.lastUpdate) return false;
  const currentServerTime = Date.now() + serverTimeOffset;
  return (currentServerTime - tank.lastUpdate) > thresholdMs;
}

export type TankOperationalStatus = 'planned' | 'offline' | 'live';

/**
 * Derives operational status ('planned' | 'offline' | 'live') from telemetry without writing connected flags to DB.
 */
export function getTankOperationalStatus(tank: Tank, serverTimeOffset: number = 0, thresholdMs: number = CONTROLLER_OFFLINE_THRESHOLD_MS): TankOperationalStatus {
  if (isTankPlanned(tank)) return 'planned';
  if (isTankControllerOffline(tank, serverTimeOffset, thresholdMs)) return 'offline';
  return 'live';
}

/**
 * Atomically updates a tank's controllerOffline flag in Firebase Realtime Database
 * and writes a log entry and notification only if the transaction committed the change (R3).
 * This prevents duplicate log entries or notifications when multiple users or tabs have the app open.
 */
export async function syncTankOfflineState(
  tankId: string,
  tankName: string,
  shouldBeOffline: boolean,
  addLogFn: (log: Omit<Log, 'id' | 'timestamp'>) => void,
  notificationHelpers?: {
    addNotification?: (notif: Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string; acknowledged?: boolean; resolved?: boolean }) => Promise<any>;
    resolveNotification?: (id: string) => Promise<any>;
  },
  thresholdSec: number = 30
): Promise<boolean> {
  if (!tankId) return false;
  const flagRef = ref(database, `tanks/${tankId}/controllerOffline`);

  try {
    const result = await runTransaction(flagRef, (currentVal) => {
      // Transitioning to offline:
      if (shouldBeOffline) {
        if (currentVal === true) {
          // Already marked offline, abort transaction to prevent duplicate log
          return undefined;
        }
        return true;
      } else {
        // Transitioning to recovered (online):
        if (currentVal === false || currentVal === null || currentVal === undefined) {
          // Already marked recovered/online, abort transaction
          return undefined;
        }
        return false;
      }
    });

    if (result.committed) {
      const offlineAlertId = `alert-${tankId}-offline`;
      // Unique per outage: the transaction above guarantees a single writer
      const recoveryAlertId = `recovery-alert-${tankId}-offline-${Date.now()}`;

      if (shouldBeOffline) {
        addLogFn({
          action: 'CONTROLLER_OFFLINE',
          details: `Controller for ${tankName} went offline (last update older than ${thresholdSec}s).`,
          logLevel: 'WARNING',
          performedBy: 'System',
        });

        // R3: Dispatch real danger notification for controller offline
        if (notificationHelpers?.addNotification) {
          notificationHelpers.addNotification({
            id: offlineAlertId,
            tankId,
            title: 'Controller Offline',
            message: `Controller for ${tankName} went offline (no update in >${thresholdSec}s).`,
            type: 'danger',
            acknowledged: false,
            resolved: false,
          });
        }
      } else {
        addLogFn({
          action: 'CONTROLLER_RECOVERED',
          details: `Controller for ${tankName} recovered and is back online.`,
          logLevel: 'INFO',
          performedBy: 'System',
        });

        // R3: Resolve danger notification and post recovery notification
        if (notificationHelpers?.resolveNotification) {
          notificationHelpers.resolveNotification(offlineAlertId);
        }
        if (notificationHelpers?.addNotification) {
          notificationHelpers.addNotification({
            id: recoveryAlertId,
            tankId,
            title: 'Controller Back Online',
            message: `Controller for ${tankName} re-established connection and is reporting live.`,
            type: 'info',
            acknowledged: true,
            resolved: true,
          });
        }
      }
      return true;
    }
  } catch (err) {
    console.error(`Error synchronizing controllerOffline state for tank ${tankId}:`, err);
  }
  return false;
}

/**
 * Sanitizes and validates raw tank telemetry from Firebase (E1 / R6).
 * Handles null/undefined, firmware -999 uninitialized codes, non-numeric values,
 * and maintains accurate sensor health flags so alert state machines do not produce false alarms.
 */
export function sanitizeTank(key: string, raw: any): Tank {
  const isNumber = (v: any): boolean => typeof v === 'number' && Number.isFinite(v);

  // Sensor health flags
  const phSensorOk = raw?.phSensorOk !== false;
  const levelSensorOk = raw?.levelSensorOk !== false;

  // Water level: 0-100%, handling firmware -999 or non-numeric/null
  let waterLevel = 0;
  if (isNumber(raw?.waterLevel)) {
    if (raw.waterLevel === -999) {
      waterLevel = 0;
    } else {
      waterLevel = Math.max(0, Math.min(100, raw.waterLevel));
    }
  }

  // pH level: 0-14, default 7.0 for uninitialized or invalid
  let phLevel = 7.0;
  if (isNumber(raw?.phLevel)) {
    if (raw.phLevel === -999) {
      phLevel = 7.0;
    } else {
      phLevel = Math.max(0, Math.min(14, raw.phLevel));
    }
  }

  // Water height: >= 0
  let waterHeight = 0;
  if (isNumber(raw?.waterHeight) && raw.waterHeight >= 0) {
    waterHeight = raw.waterHeight;
  }

  return {
    ...raw,
    id: raw?.id || key,
    name: raw?.name || `Tank ${key}`,
    waterLevel,
    phLevel,
    waterHeight,
    status: raw?.status || 'safe',
    pumpOn: !!raw?.pumpOn,
    enabled: raw?.enabled !== false,
    phSensorOk,
    levelSensorOk,
    levelVmin: isNumber(raw?.levelVmin) ? raw.levelVmin : 0.25,
    levelVmax: isNumber(raw?.levelVmax) ? raw.levelVmax : 3.0,
    tankHeight: isNumber(raw?.tankHeight) ? raw.tankHeight : 5.0,
    levelOffset: isNumber(raw?.levelOffset) ? raw.levelOffset : 0,
    phNeutralVoltage: isNumber(raw?.phNeutralVoltage) ? raw.phNeutralVoltage : 2.5,
    phSlope: isNumber(raw?.phSlope) ? raw.phSlope : 0.18,
    phOffset: isNumber(raw?.phOffset) ? raw.phOffset : 0.0,
    assignedWorker: raw?.assignedWorker ?? null,
    controllerOffline: !!raw?.controllerOffline,
  };
}

export function useTanks() {
  const [tanks, setTanks] = useState<Tank[]>(() => loadFromStorage('wm_tanks', DEFAULT_TANKS));
  const serverTimeOffset = useServerTimeOffset();

  useEffect(() => {
    const tanksRef = ref(database, 'tanks');
    const unsubscribe = onValue(
      tanksRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Sanitize raw tank telemetry (E1 / R6)
          const tankList = Object.entries(data).map(([key, value]) => sanitizeTank(key, value));
          setTanks(tankList);
          saveToStorage('wm_tanks', tankList);
        } else {
          // Empty database: create the tank records (name + calibration only, no readings).
          // Rules allow this for admins/workers; for anyone else it is refused and ignored.
          Promise.resolve(update(tanksRef, DEFAULT_TANKS.reduce((acc, tank) => ({ ...acc, [tank.id]: tank }), {})))
            .catch(() => { /* not permitted for this role */ });
        }
      },
      (error) => {
        console.error('Error reading tanks from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const updateTank = (id: string, updates: Partial<Tank>) => {
    if (!id || id.trim() === '') {
      return Promise.reject(new Error('Invalid tank ID. Operations cannot be performed on blank identifiers.'));
    }
    return update(ref(database, `tanks/${id}`), updates);
  };

  const addTank = (tank: Pick<Tank, 'id' | 'name'> & Partial<Tank>) => {
    if (!tank.id || tank.id.trim() === '') {
      return Promise.reject(new Error('Tank ID is required for registration.'));
    }
    const newTank: Tank = {
      waterLevel: 0,
      phLevel: 7.0,
      waterHeight: 0,
      status: 'safe',
      pumpOn: false,
      phSensorOk: true,
      levelSensorOk: true,
      levelVmin: 0.25,
      levelVmax: 3.0,
      tankHeight: 5.0,
      levelOffset: 0,
      phNeutralVoltage: 2.5,
      phSlope: 0.18,
      phOffset: 0.0,
      enabled: true,
      location: 'Unspecified',
      assignedWorker: null,
      controllerOffline: false,
      ...tank
    };
    return set(ref(database, `tanks/${newTank.id}`), newTank);
  };

  const deleteTank = (id: string) => {
    if (!id || id.trim() === '') {
      return Promise.reject(new Error('Invalid tank ID. Deletion cannot be performed on blank identifiers.'));
    }
    return remove(ref(database, `tanks/${id}`));
  };

  return { tanks, updateTank, addTank, deleteTank, serverTimeOffset };
}

export function useConfig() {
  const [config, setConfig] = useState<SystemConfig>(() => loadFromStorage('wm_config', DEFAULT_CONFIG));

  useEffect(() => {
    const configRef = ref(database, 'config');
    const unsubscribe = onValue(
      configRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setConfig(data);
          saveToStorage('wm_config', data);
        } else {
          Promise.resolve(set(configRef, DEFAULT_CONFIG)).catch(() => { /* only an admin may create the config */ });
        }
      },
      (error) => {
        console.error('Error reading config from database:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const updateConfig = (updates: Partial<SystemConfig>) => {
    return update(ref(database, 'config'), updates);
  };

  return { config, updateConfig };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const notifsRef = ref(database, 'notifications');
    // R2 / P1: Limit query to the latest 100 entries to optimize bandwidth
    const notifsQuery = query(notifsRef, orderByChild('timestamp'), limitToLast(100));
    const unsubscribe = onValue(
      notifsQuery,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Convert object to array using database key as fallback ID and sort by timestamp (newest first)
          const list = Object.entries(data).map(([key, value]: [string, any]) => ({
            ...value,
            id: value.id || key,
          })) as Notification[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          setNotifications(list);
        } else {
          setNotifications([]);
        }
      },
      (error) => {
        console.error('Error reading notifications from database:', error);
      }
    );
    return () => unsubscribe();
  }, []);

  const addNotification = useCallback(async (notif: Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string; acknowledged?: boolean; resolved?: boolean }) => {
    const notifsRef = ref(database, 'notifications');

    // Event-style notification without a fixed ID: always a new history row
    if (!notif.id) {
      const newNotifRef = push(notifsRef);
      const id = newNotifRef?.key || Date.now().toString();
      return update(ref(database, `notifications/${id}`), {
        timestamp: Date.now(),
        read: false,
        acknowledged: false,
        resolved: false,
        ...notif,
        id,
      });
    }

    // Fixed-ID alert (one live record per tank + condition)
    const id = notif.id;
    const liveRef = ref(database, `notifications/${id}`);
    let existing: Notification | null = null;
    try {
      const snap = await get(liveRef);
      existing = snap?.exists?.() ? (snap.val() as Notification) : null;
    } catch {
      existing = null;
    }

    const isRaise = notif.resolved !== true;

    if (existing && isRaise && !existing.resolved) {
      // Already acknowledged by an operator: never reopen it from another browser
      if (existing.acknowledged) return;
      // Same episode still active: re-announce without rewriting when it started
      return update(liveRef, { read: false, lastRepeatedAt: Date.now(), message: notif.message });
    }

    if (existing && isRaise && existing.resolved && existing.timestamp) {
      // A new episode is starting. Keep the finished one as its own history row.
      // The archive key is derived from the old record, so several browsers
      // doing this at once all write the same row.
      const archiveId = `${id}-${existing.timestamp}`;
      const { acknowledgedByUid: _uid, ...archived } = existing;
      try {
        await set(ref(database, `notifications/${archiveId}`), { ...archived, id: archiveId, read: true });
      } catch (err) {
        console.error('Error archiving previous alert episode:', err);
      }
    }

    // set() so nothing from an earlier episode (who acknowledged, when it resolved) leaks into the new one
    return set(liveRef, {
      timestamp: Date.now(),
      read: false,
      acknowledged: false,
      resolved: false,
      ...notif,
      id,
    });
  }, []);

  const resolveNotification = useCallback((id: string) => {
    return update(ref(database, `notifications/${id}`), {
      resolved: true,
      resolvedAt: Date.now(),
      acknowledged: true, // Resolving stops sound across dashboards
    });
  }, []);

  const markRead = useCallback((id: string) => {
    return update(ref(database, `notifications/${id}`), { read: true });
  }, []);

  const acknowledgeNotification = useCallback((id: string, username: string, title?: string) => {
    const acknowledgedAt = Date.now();
    const logsRef = ref(database, 'logs');
    const newLogRef = push(logsRef);
    const logId = newLogRef?.key || Date.now().toString();
    const newLog: Log = {
      id: logId,
      action: 'Alert Acknowledged',
      details: `Alert "${title || 'System Alert'}" was acknowledged by ${username}.`,
      performedBy: username,
      timestamp: acknowledgedAt,
      logLevel: 'INFO'
    };

    const ackFields: Record<string, unknown> = {
      [`notifications/${id}/acknowledged`]: true,
      [`notifications/${id}/acknowledgedBy`]: username,
      [`notifications/${id}/acknowledgedAt`]: acknowledgedAt,
    };
    const uid = auth?.currentUser?.uid;
    if (uid) ackFields[`notifications/${id}/acknowledgedByUid`] = uid;

    // Single multi-path write: the acknowledgement and its audit log succeed or fail together
    return update(ref(database), { ...ackFields, [`logs/${logId}`]: newLog });
  }, []);

  const clearAll = useCallback(() => {
    return set(ref(database, 'notifications'), null);
  }, []);

  const purgeOldNotifications = useCallback(async (olderThanDays = 90): Promise<number> => {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const notifsRef = ref(database, 'notifications');
    try {
      const snap = await get(notifsRef);
      if (!snap.exists()) return 0;
      const data = snap.val();
      const updates: Record<string, null> = {};
      let count = 0;
      Object.entries(data).forEach(([key, notif]: [string, any]) => {
        if (notif.timestamp && notif.timestamp < cutoff) {
          updates[key] = null;
          count++;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(notifsRef, updates);
      }
      return count;
    } catch (err) {
      console.error('Error purging old notifications:', err);
      throw err;
    }
  }, []);

  return { notifications, addNotification, resolveNotification, markRead, clearAll, purgeOldNotifications, acknowledgeNotification };
}

export function addSystemLog(log: Omit<Log, 'id' | 'timestamp'>) {
  try {
    if (typeof (database as any)?._checkNotDeleted !== 'function' && !(database as any)?.app) {
      return Promise.resolve();
    }
    const logsRef = ref(database, 'logs');
    const newLogRef = push(logsRef);
    const id = newLogRef?.key || Date.now().toString();
    const newLog: Log = {
      ...log,
      logLevel: log.logLevel || 'INFO',
      id,
      timestamp: Date.now()
    };
    return set(newLogRef || ref(database, `logs/${id}`), newLog);
  } catch (err) {
    console.error('Failed to add log:', err);
    return Promise.resolve();
  }
}

export function useLogs() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    try {
      if (typeof (database as any)?._checkNotDeleted !== 'function' && !(database as any)?.app) {
        return;
      }
      const logsRef = ref(database, 'logs');
      // Limit to latest 100 entries using native server-side key ordering to avoid unindexed full downloads
      const logsQuery = query(logsRef, limitToLast(100));
      const unsubscribe = onValue(
        logsQuery,
        (snapshot) => {
          const data = snapshot.val();
          if (data && typeof data === 'object') {
            const list = Object.entries(data).map(([key, value]: [string, any]) => ({
              ...value,
              id: key,
              timestamp: typeof value?.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : Date.now(),
            })) as Log[];
            list.sort((a, b) => b.timestamp - a.timestamp);
            setLogs(list);
          } else {
            setLogs([]);
          }
        },
        (error) => {
          console.error('Error reading logs from database:', error);
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.error('Error initializing useLogs listener:', err);
    }
  }, []);

  const addLog = useCallback((log: Omit<Log, 'id' | 'timestamp'>) => {
    return addSystemLog(log);
  }, []);

  const clearAll = useCallback(() => {
    try {
      return set(ref(database, 'logs'), null);
    } catch (err) {
      console.error('Failed to clear logs:', err);
      return Promise.resolve();
    }
  }, []);

  const purgeOldLogs = useCallback(async (olderThanDays = 90): Promise<number> => {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const logsRef = ref(database, 'logs');
    try {
      const snap = await get(logsRef);
      if (!snap.exists()) return 0;
      const data = snap.val();
      const updates: Record<string, null> = {};
      let count = 0;
      Object.entries(data).forEach(([key, item]: [string, any]) => {
        const ts = Number(item?.timestamp);
        if (ts && ts < cutoff) {
          updates[key] = null;
          count++;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(logsRef, updates);
      }
      return count;
    } catch (err) {
      console.error('Error purging old logs:', err);
      throw err;
    }
  }, []);

  return { logs, addLog, clearAll, purgeOldLogs };
}

/**
 * Hook to monitor Firebase WebSocket connection state via '/.info/connected' (R2 / E3).
 * Returns true when connected, false when disconnected or offline.
 */
export function useConnectionState(): boolean {
  const [connected, setConnected] = useState<boolean>(true);

  useEffect(() => {
    try {
      if (typeof (database as any)?._checkNotDeleted !== 'function' && !(database as any)?.app) {
        return;
      }
      const connectedRef = ref(database, '.info/connected');
      const unsubscribe = onValue(
        connectedRef,
        (snapshot) => {
          const val = snapshot.val();
          if (typeof val === 'boolean') {
            setConnected(val);
          }
        },
        (error) => {
          console.error('Error reading .info/connected:', error);
        }
      );
      return () => unsubscribe();
    } catch {
      // Graceful fallback for mocked test databases
    }
  }, []);

  return connected;
}

/**
 * Hook for per-user notification read timestamp state stored in '/userState/{uid}/notificationsLastReadAt' (R5).
 * Eliminates shared read flags so each operator maintains their own read/unread status.
 */
export function useUserNotificationsState(uid?: string) {
  const [lastReadAt, setLastReadAt] = useState<number>(0);

  useEffect(() => {
    if (!uid) return;
    try {
      if (typeof (database as any)?._checkNotDeleted !== 'function' && !(database as any)?.app) {
        return;
      }
      const readRef = ref(database, `userState/${uid}/notificationsLastReadAt`);
      const unsubscribe = onValue(
        readRef,
        (snapshot) => {
          const val = snapshot.val();
          if (typeof val === 'number') {
            setLastReadAt(val);
          }
        },
        (error) => {
          console.error('Error reading user notification state:', error);
        }
      );
      return () => unsubscribe();
    } catch {
      // Graceful fallback for mocked test databases
    }
  }, [uid]);

  const markAllAsRead = useCallback(() => {
    if (!uid) return Promise.resolve();
    try {
      if (typeof (database as any)?._checkNotDeleted !== 'function' && !(database as any)?.app) {
        setLastReadAt(Date.now());
        return Promise.resolve();
      }
      return set(ref(database, `userState/${uid}/notificationsLastReadAt`), Date.now());
    } catch {
      setLastReadAt(Date.now());
      return Promise.resolve();
    }
  }, [uid]);

  return { lastReadAt, markAllAsRead };
}

export function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatted = time.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) +
    ' - ' + time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return formatted;
}
