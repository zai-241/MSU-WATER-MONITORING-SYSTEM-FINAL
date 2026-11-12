import { useEffect, useRef } from 'react';
import { 
  useTanks, 
  useConfig, 
  useNotifications, 
  addSystemLog,
  useServerTimeOffset,
  isTankPlanned, 
  isTankControllerOffline, 
  syncTankOfflineState 
} from '@/store/useStore';
import { toast } from 'sonner';
import { alertSound } from '@/utils/alertSound';

// Validation delays and notification cooldown configurations
const ALERT_VALIDATION_TIME = 5000;   // 5 seconds continuous anomaly required
const RECOVERY_VALIDATION_TIME = 5000; // 5 seconds continuous normal required

interface AlertTracker {
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';
  abnormalStartTime: number;
  normalStartTime: number;
  lastNotificationTime: number;
}

/**
 * SystemMonitor Component
 * Headless browser component that performs client-side alert evaluation across all pages.
 * - Hardware and sensor anomaly detection (pH, overflow, low level, hardware faults)
 * - Continuous device-offline watchdog on every page (R3)
 * - Background tab alert title flashing & desktop Web Notifications (R7)
 * - Idempotent de-duplication and state-machine transitions (R4 / B2 / B3 / B6)
 */
const SystemMonitor = () => {
    const { tanks } = useTanks();
    const { config } = useConfig();
    const { notifications, addNotification, resolveNotification } = useNotifications();
    const addLog = addSystemLog;
    const serverTimeOffset = useServerTimeOffset();
    
    // Store stable state machines for alerts across renders to prevent fluctuations/noise
    const trackers = useRef<Record<string, Record<string, AlertTracker>>>({});
    const inFlightOffline = useRef<Set<string>>(new Set());

    // 1. Real-time audio synchronization & toast dismissal
    useEffect(() => {
        // B4 & R8: Maintenance mode or sound disabled suppresses audio chime
        if (config?.maintenanceMode || config?.soundEnabled === false) {
            alertSound.stopAlert();
            return;
        }

        const unacknowledgedAlerts = notifications.filter(
            n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged && !n.resolved
        );

        if (unacknowledgedAlerts.length > 0) {
            alertSound.startAlert();
        } else {
            alertSound.stopAlert();
        }

        // Dismiss active toast for any alert that has been acknowledged or resolved
        notifications.forEach(n => {
            if (n.acknowledged || n.resolved) {
                toast.dismiss(n.id);
            }
        });
    }, [notifications, config?.maintenanceMode, config?.soundEnabled]);

    // Cleanup sound on component unmount
    useEffect(() => {
        return () => {
            alertSound.stopAlert();
        };
    }, []);

    // 2. R7: Visual cues that work when dashboard is in a background tab (title flash)
    useEffect(() => {
        const unacknowledgedCount = notifications.filter(
            n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged && !n.resolved
        ).length;

        if (unacknowledgedCount > 0) {
            let flash = false;
            const originalTitle = document.title || 'MSU Water Monitoring';
            const interval = setInterval(() => {
                document.title = flash
                    ? `(! ${unacknowledgedCount}) ALERT — MSU Water`
                    : `(${unacknowledgedCount} Active Alerts) System Warning`;
                flash = !flash;
            }, 1000);
            return () => {
                clearInterval(interval);
                document.title = 'MSU Water Monitoring';
            };
        } else {
            document.title = 'MSU Water Monitoring';
        }
    }, [notifications]);

    // 3. R3: Global controller offline watchdog checking on every page
    useEffect(() => {
        if (config?.maintenanceMode) return;

        // Configurable offline threshold (R8), minimum 20 seconds (2 heartbeats)
        const thresholdSec = Math.max(20, config?.offlineThresholdSec ?? 30);
        const thresholdMs = thresholdSec * 1000;

        tanks.forEach((tank) => {
            if (!tank.id || isTankPlanned(tank) || !tank.enabled) return;
            if (inFlightOffline.current.has(tank.id)) return;

            const isOffline = isTankControllerOffline(tank, serverTimeOffset, thresholdMs);
            const currentFlag = tank.controllerOffline ?? false;

            if (isOffline !== currentFlag) {
                inFlightOffline.current.add(tank.id);
                syncTankOfflineState(
                    tank.id,
                    tank.name,
                    isOffline,
                    addLog,
                    { addNotification, resolveNotification },
                    thresholdSec
                ).finally(() => {
                    inFlightOffline.current.delete(tank.id);
                });
            }
        });
    }, [tanks, config?.maintenanceMode, config?.offlineThresholdSec, serverTimeOffset, addLog, addNotification, resolveNotification]);

    // 4. Main alert evaluation state machine
    useEffect(() => {
        // B4: Maintenance mode suppresses alert evaluations system-wide
        if (config?.maintenanceMode) {
            return;
        }

        const now = Date.now();
        // R8: repeat interval for unacknowledged alerts is set in Admin Panel (minimum 10 s)
        const ALERT_COOLDOWN = Math.max(10, config?.repeatIntervalSec ?? 60) * 1000;

        tanks.forEach(tank => {
            // Planned tanks and disabled tanks must never evaluate or trigger alerts
            if (!tank.enabled || isTankPlanned(tank)) return;

            // Initialize trackers for this tank if they do not exist
            if (!trackers.current[tank.id]) {
                trackers.current[tank.id] = {
                    lowLevel: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    overflow: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    ph: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    levelFault: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                    phFault: { status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 },
                };
            }

            const tankTrackers = trackers.current[tank.id];

            // Helper to evaluate and update alert state machine for a specific alert key
            const evaluateAlert = (
                key: 'lowLevel' | 'overflow' | 'ph' | 'levelFault' | 'phFault',
                isAbnormal: boolean,
                isNormal: boolean,
                title: string,
                abnormalMsg: string,
                recoveryMsg: string,
                type: 'warning' | 'danger'
            ) => {
                const tracker = tankTrackers[key];
                if (!tracker) return;
                const notifId = `alert-${tank.id}-${key}`;
                const existingNotif = notifications.find(n => n.id === notifId);

                // B2: If alert is already active and acknowledged in the database, adopt its status
                // so a page reload or new login does not overwrite acknowledged: true or re-alarm
                if (existingNotif && !existingNotif.resolved && existingNotif.acknowledged) {
                    if (tracker.status === 'NORMAL' && isAbnormal) {
                        tracker.status = type === 'warning' ? 'WARNING' : 'CRITICAL';
                        tracker.abnormalStartTime = 0;
                        tracker.lastNotificationTime = existingNotif.timestamp;
                    }
                }

                // 1. STATE MACHINE TRANSITIONS
                switch (tracker.status) {
                    case 'NORMAL':
                        if (isAbnormal) {
                            if (tracker.abnormalStartTime === 0) {
                                tracker.abnormalStartTime = now;
                            } else if (now - tracker.abnormalStartTime >= ALERT_VALIDATION_TIME) {
                                tracker.status = type === 'warning' ? 'WARNING' : 'CRITICAL';
                                tracker.abnormalStartTime = 0;
                                tracker.lastNotificationTime = now;
                                
                                // B2: Check if alert is already active and acknowledged
                                if (existingNotif && !existingNotif.resolved && existingNotif.acknowledged) {
                                    return;
                                }

                                // Prevent duplicate write within cooldown if already raised
                                if (existingNotif && !existingNotif.resolved &&
                                    (now - Math.max(existingNotif.timestamp, existingNotif.lastRepeatedAt ?? 0) < ALERT_COOLDOWN)) {
                                    return;
                                }

                                // Dispatch warning notification and toast
                                toast[type === 'warning' ? 'warning' : 'error'](abnormalMsg, { id: notifId, duration: 15000 });
                                addNotification({ id: notifId, tankId: tank.id, title, message: abnormalMsg, type, acknowledged: false, resolved: false });

                                // R7: Native browser notification if tab is in the background
                                if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
                                    try {
                                        new Notification(title, { body: abnormalMsg, tag: notifId });
                                    } catch {
                                        // Ignore permission/OS error
                                    }
                                }
                            }
                        } else {
                            tracker.abnormalStartTime = 0;
                        }
                        break;

                    case 'WARNING':
                    case 'CRITICAL':
                        if (isNormal) {
                            if (tracker.normalStartTime === 0) {
                                tracker.normalStartTime = now;
                            } else if (now - tracker.normalStartTime >= RECOVERY_VALIDATION_TIME) {
                                tracker.status = 'RECOVERED';
                                tracker.normalStartTime = 0;
                                tracker.lastNotificationTime = now;
                                
                                // Dismiss active toast on recovery
                                toast.dismiss(notifId);
                                toast.success(recoveryMsg);

                                // B3: Mark original alert resolved to stop alarm across all tabs
                                resolveNotification(notifId);

                                // B3: Use a deterministic recovery key to deduplicate across multiple open browsers
                                // Keyed by the start time of the alert it closes, so every episode keeps its own recovery row
                                const recoveryId = `recovery-${tank.id}-${key}-${existingNotif?.timestamp ?? 'latest'}`;
                                addNotification({ 
                                    id: recoveryId, 
                                    tankId: tank.id,
                                    title: `${title} Recovered`, 
                                    message: recoveryMsg, 
                                    type: 'info',
                                    acknowledged: true,
                                    resolved: true
                                });
                            }
                        } else {
                            tracker.normalStartTime = 0;
                            // Check if alert was already acknowledged by an operator
                            const isAcknowledged = existingNotif?.acknowledged ?? false;
                            if (isAcknowledged) {
                                // Acknowledged by operator: do not re-toast or overwrite while still active
                                return;
                            }

                            // Cooldown handling to prevent duplicate spamming for persistent unacknowledged alert
                            if (now - tracker.lastNotificationTime >= ALERT_COOLDOWN) {
                                tracker.lastNotificationTime = now;
                                toast[type === 'warning' ? 'warning' : 'error'](abnormalMsg, { id: notifId, duration: 15000 });
                                addNotification({ id: notifId, tankId: tank.id, title, message: abnormalMsg, type, acknowledged: false, resolved: false });
                            }
                        }
                        break;

                    case 'RECOVERED':
                        // Reset to normal on next tick
                        tracker.status = 'NORMAL';
                        tracker.abnormalStartTime = 0;
                        tracker.normalStartTime = 0;
                        break;
                }
            };

            // B7 / R6: CHECK HARDWARE SENSOR FAULTS
            const isLevelFault = tank.levelSensorOk === false;
            evaluateAlert(
                'levelFault',
                isLevelFault,
                !isLevelFault,
                'Level Sensor Fault',
                `${tank.name} water level sensor reported a hardware fault. Level monitoring suspended.`,
                `${tank.name} water level sensor fault resolved.`,
                'danger'
            );

            const isPhFault = tank.phSensorOk === false;
            evaluateAlert(
                'phFault',
                isPhFault,
                !isPhFault,
                'pH Sensor Fault',
                `${tank.name} pH sensor reported a hardware fault. pH monitoring suspended.`,
                `${tank.name} pH sensor fault resolved.`,
                'danger'
            );

            // B7 / R6 / E1: Only evaluate threshold alerts if the corresponding sensor is healthy and values are in range
            const validLevel = tank.levelSensorOk !== false && 
                               Number.isFinite(tank.waterLevel) && 
                               tank.waterLevel >= 0 && 
                               tank.waterLevel <= 100;

            const validPh = tank.phSensorOk !== false && 
                            Number.isFinite(tank.phLevel) && 
                            tank.phLevel >= 0 && 
                            tank.phLevel <= 14;

            if (validLevel) {
                // 2. CHECK LOW WATER LEVEL (Hysteresis recovery margin: +2%)
                const isLowAbnormal = tank.waterLevel < config.lowLevelThreshold;
                const isLowNormal = tank.waterLevel >= (config.lowLevelThreshold + 2);
                evaluateAlert(
                    'lowLevel',
                    isLowAbnormal,
                    isLowNormal,
                    'Low Water Level',
                    `${tank.name} water level is extremely low (${tank.waterLevel}%).`,
                    `${tank.name} water level returned to normal (${tank.waterLevel}%).`,
                    'danger' // firmware reports low water as CRITICAL (tank status "danger")
                );

                // 3. CHECK OVERFLOW (Hysteresis recovery margin: -2%)
                const isOverflowAbnormal = tank.waterLevel > config.overflowThreshold;
                const isOverflowNormal = tank.waterLevel <= (config.overflowThreshold - 2);
                evaluateAlert(
                    'overflow',
                    isOverflowAbnormal,
                    isOverflowNormal,
                    'High Water Level',
                    `${tank.name} is reaching overflow capacity (${tank.waterLevel}%).`,
                    `${tank.name} overflow condition resolved (${tank.waterLevel}%).`,
                    'warning' // firmware reports overflow as WARNING (tank status "warning")
                );
            } else {
                if (tankTrackers.lowLevel) tankTrackers.lowLevel.abnormalStartTime = 0;
                if (tankTrackers.overflow) tankTrackers.overflow.abnormalStartTime = 0;
            }

            if (validPh) {
                // 4. CHECK PH LEVELS (Hysteresis recovery margin: +/- 0.15)
                const isPhAbnormal = tank.phLevel < config.minPh || tank.phLevel > config.maxPh;
                const isPhNormal = tank.phLevel >= (config.minPh + 0.15) && tank.phLevel <= (config.maxPh - 0.15);
                evaluateAlert(
                    'ph',
                    isPhAbnormal,
                    isPhNormal,
                    'Unsafe pH Level',
                    `${tank.name} pH level is unsafe (${tank.phLevel}).`,
                    `${tank.name} pH level returned to safe zone (${tank.phLevel}).`,
                    'danger'
                );
            } else {
                if (tankTrackers.ph) tankTrackers.ph.abnormalStartTime = 0;
            }
        });
    }, [tanks, config, notifications, addNotification, resolveNotification]);

    return null; // Headless component
};

export default SystemMonitor;
