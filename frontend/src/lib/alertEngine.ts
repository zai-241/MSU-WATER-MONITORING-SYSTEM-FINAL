/**
 * @file alertEngine.ts
 * @description Pure alert state machine shared by the browser (SystemMonitor) and the
 * server-side worker (backend/worker). It has no imports and no side effects: it takes
 * a tank reading plus the previous tracker state and returns the events to act on.
 *
 * Keeping it pure means one implementation, one set of unit tests, and identical
 * behaviour whether alerts are evaluated by the worker or by a browser fallback.
 *
 * Severity and threshold comparisons follow the ESP32 firmware:
 *   low water  -> CRITICAL (danger),  level <  lowLevelThreshold
 *   overflow   -> WARNING,            level >  overflowThreshold
 *   pH         -> CRITICAL (danger),  pH outside minPh..maxPh
 * Hysteresis: 2 % for level, 0.15 for pH (fixed in firmware).
 */

export const ALERT_VALIDATION_MS = 5000;   // condition must hold this long before raising
export const RECOVERY_VALIDATION_MS = 5000; // and this long before recovering
export const DEFAULT_REPEAT_SEC = 60;
export const MIN_REPEAT_SEC = 10;
export const DEFAULT_OFFLINE_THRESHOLD_SEC = 30;
export const MIN_OFFLINE_THRESHOLD_SEC = 20; // never below two 10 s heartbeats
export const LEVEL_HYSTERESIS = 2;
export const PH_HYSTERESIS = 0.15;

export type AlertKey = 'lowLevel' | 'overflow' | 'ph' | 'levelFault' | 'phFault';
export type AlertLevel = 'warning' | 'danger';
export type TrackerStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';

export const ALERT_KEYS: AlertKey[] = ['levelFault', 'phFault', 'lowLevel', 'overflow', 'ph'];

export interface AlertTracker {
  status: TrackerStatus;
  abnormalStartTime: number;
  normalStartTime: number;
  lastNotificationTime: number;
}

export type TankTrackers = Record<AlertKey, AlertTracker>;

export interface EngineTank {
  id: string;
  name: string;
  enabled?: boolean;
  lastUpdate?: number;
  waterLevel: number;
  phLevel: number;
  phSensorOk?: boolean;
  levelSensorOk?: boolean;
}

export interface EngineConfig {
  lowLevelThreshold: number;
  overflowThreshold: number;
  minPh: number;
  maxPh: number;
  maintenanceMode?: boolean;
  repeatIntervalSec?: number;
  offlineThresholdSec?: number;
}

/** The slice of an existing notification record the engine needs to stay idempotent. */
export interface ExistingAlert {
  timestamp: number;
  lastRepeatedAt?: number;
  acknowledged?: boolean;
  resolved?: boolean;
}

export interface AlertEvent {
  kind: 'raise' | 'repeat' | 'recover';
  key: AlertKey;
  tankId: string;
  /** Fixed ID of the live alert record: one per tank and condition */
  notifId: string;
  level: AlertLevel;
  title: string;
  message: string;
}

export function alertNotifId(tankId: string, key: AlertKey | 'offline'): string {
  return `alert-${tankId}-${key}`;
}

export function createTankTrackers(): TankTrackers {
  const fresh = (): AlertTracker => ({ status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 });
  return { lowLevel: fresh(), overflow: fresh(), ph: fresh(), levelFault: fresh(), phFault: fresh() };
}

export function repeatIntervalMs(config: Pick<EngineConfig, 'repeatIntervalSec'> | null | undefined): number {
  const sec = Number(config?.repeatIntervalSec);
  return Math.max(MIN_REPEAT_SEC, Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_REPEAT_SEC) * 1000;
}

export function offlineThresholdMs(config: Pick<EngineConfig, 'offlineThresholdSec'> | null | undefined): number {
  const sec = Number(config?.offlineThresholdSec);
  return Math.max(MIN_OFFLINE_THRESHOLD_SEC, Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_OFFLINE_THRESHOLD_SEC) * 1000;
}

/** A tank that has never reported is "planned", not offline. */
export function isControllerOffline(lastUpdate: number | undefined | null, serverNow: number, thresholdMs: number): boolean {
  if (!lastUpdate) return false;
  return serverNow - lastUpdate > thresholdMs;
}

export function isValidLevel(tank: EngineTank): boolean {
  return tank.levelSensorOk !== false && Number.isFinite(tank.waterLevel) && tank.waterLevel >= 0 && tank.waterLevel <= 100;
}

export function isValidPh(tank: EngineTank): boolean {
  return tank.phSensorOk !== false && Number.isFinite(tank.phLevel) && tank.phLevel >= 0 && tank.phLevel <= 14;
}

interface Check {
  key: AlertKey;
  level: AlertLevel;
  title: string;
  isAbnormal: boolean;
  isNormal: boolean;
  abnormalMsg: string;
  recoveryMsg: string;
}

function buildChecks(tank: EngineTank, config: EngineConfig, trackers: TankTrackers): Check[] {
  const checks: Check[] = [];

  const levelFault = tank.levelSensorOk === false;
  checks.push({
    key: 'levelFault', level: 'danger', title: 'Level Sensor Fault',
    isAbnormal: levelFault, isNormal: !levelFault,
    abnormalMsg: `${tank.name} water level sensor reported a hardware fault. Level monitoring suspended.`,
    recoveryMsg: `${tank.name} water level sensor fault resolved.`,
  });

  const phFault = tank.phSensorOk === false;
  checks.push({
    key: 'phFault', level: 'danger', title: 'pH Sensor Fault',
    isAbnormal: phFault, isNormal: !phFault,
    abnormalMsg: `${tank.name} pH sensor reported a hardware fault. pH monitoring suspended.`,
    recoveryMsg: `${tank.name} pH sensor fault resolved.`,
  });

  // Threshold checks only run on a healthy sensor with a physically possible value,
  // so a broken sensor can never produce a false low-water or pH alarm.
  if (isValidLevel(tank)) {
    checks.push({
      key: 'lowLevel', level: 'danger', title: 'Low Water Level',
      isAbnormal: tank.waterLevel < config.lowLevelThreshold,
      isNormal: tank.waterLevel >= config.lowLevelThreshold + LEVEL_HYSTERESIS,
      abnormalMsg: `${tank.name} water level is extremely low (${tank.waterLevel}%).`,
      recoveryMsg: `${tank.name} water level returned to normal (${tank.waterLevel}%).`,
    });
    checks.push({
      key: 'overflow', level: 'warning', title: 'High Water Level',
      isAbnormal: tank.waterLevel > config.overflowThreshold,
      isNormal: tank.waterLevel <= config.overflowThreshold - LEVEL_HYSTERESIS,
      abnormalMsg: `${tank.name} is reaching overflow capacity (${tank.waterLevel}%).`,
      recoveryMsg: `${tank.name} overflow condition resolved (${tank.waterLevel}%).`,
    });
  } else {
    // Do not let a pending (not yet raised) level alarm fire on stale data
    trackers.lowLevel.abnormalStartTime = 0;
    trackers.overflow.abnormalStartTime = 0;
  }

  if (isValidPh(tank)) {
    checks.push({
      key: 'ph', level: 'danger', title: 'Unsafe pH Level',
      isAbnormal: tank.phLevel < config.minPh || tank.phLevel > config.maxPh,
      isNormal: tank.phLevel >= config.minPh + PH_HYSTERESIS && tank.phLevel <= config.maxPh - PH_HYSTERESIS,
      abnormalMsg: `${tank.name} pH level is unsafe (${tank.phLevel}).`,
      recoveryMsg: `${tank.name} pH level returned to safe zone (${tank.phLevel}).`,
    });
  } else {
    trackers.ph.abnormalStartTime = 0;
  }

  return checks;
}

export interface EvaluateArgs {
  tank: EngineTank;
  config: EngineConfig;
  /** Mutated in place: keep one object per tank between calls */
  trackers: TankTrackers;
  now: number;
  /** Looks up the live alert record (by notifId) as currently stored in the database */
  getExisting: (notifId: string) => ExistingAlert | null | undefined;
}

/**
 * Advances every alert state machine for one tank and returns what should happen.
 * Callers perform the side effects (database writes, toasts, pushes).
 */
export function evaluateTank({ tank, config, trackers, now, getExisting }: EvaluateArgs): AlertEvent[] {
  const events: AlertEvent[] = [];

  // Disabled tanks, tanks that never reported, and maintenance mode never alert
  if (tank.enabled === false || !tank.lastUpdate || config.maintenanceMode) return events;

  const cooldown = repeatIntervalMs(config);

  for (const check of buildChecks(tank, config, trackers)) {
    const tracker = trackers[check.key];
    const notifId = alertNotifId(tank.id, check.key);
    const existing = getExisting(notifId) ?? null;
    const existingActive = !!existing && !existing.resolved;
    const base = { key: check.key, tankId: tank.id, notifId, level: check.level, title: check.title };

    // An alert that is already active in the database (raised by another evaluator, or
    // before this process started) is adopted instead of being raised a second time.
    // This is what stops a page reload from reopening an acknowledged alert.
    if (tracker.status === 'NORMAL' && existingActive && check.isAbnormal) {
      tracker.status = check.level === 'warning' ? 'WARNING' : 'CRITICAL';
      tracker.abnormalStartTime = 0;
      tracker.lastNotificationTime = Math.max(existing!.timestamp || 0, existing!.lastRepeatedAt || 0);
    }

    switch (tracker.status) {
      case 'NORMAL':
        if (!check.isAbnormal) {
          tracker.abnormalStartTime = 0;
        } else if (tracker.abnormalStartTime === 0) {
          tracker.abnormalStartTime = now;
        } else if (now - tracker.abnormalStartTime >= ALERT_VALIDATION_MS) {
          tracker.status = check.level === 'warning' ? 'WARNING' : 'CRITICAL';
          tracker.abnormalStartTime = 0;
          tracker.lastNotificationTime = now;
          events.push({ ...base, kind: 'raise', message: check.abnormalMsg });
        }
        break;

      case 'WARNING':
      case 'CRITICAL':
        if (check.isNormal) {
          if (tracker.normalStartTime === 0) {
            tracker.normalStartTime = now;
          } else if (now - tracker.normalStartTime >= RECOVERY_VALIDATION_MS) {
            tracker.status = 'RECOVERED';
            tracker.normalStartTime = 0;
            tracker.lastNotificationTime = now;
            events.push({ ...base, kind: 'recover', title: `${check.title} Recovered`, message: check.recoveryMsg });
          }
        } else {
          tracker.normalStartTime = 0;
          // Acknowledged by an operator: stay silent until the condition clears
          if (existing?.acknowledged && !existing.resolved) break;
          if (now - tracker.lastNotificationTime >= cooldown) {
            tracker.lastNotificationTime = now;
            events.push({ ...base, kind: 'repeat', message: check.abnormalMsg });
          }
        }
        break;

      case 'RECOVERED':
        tracker.status = 'NORMAL';
        tracker.abnormalStartTime = 0;
        tracker.normalStartTime = 0;
        break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Database write plans
//
// Pure functions used inside a Realtime Database transaction on the live alert
// record. The browser store and the worker both call them, so "who wins when two
// evaluators act at once" is decided by one piece of code.
// ---------------------------------------------------------------------------

export interface AlertRecord {
  id: string;
  title: string;
  message: string;
  type: 'info' | AlertLevel;
  timestamp: number;
  read?: boolean;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  acknowledgedByUid?: string;
  resolved?: boolean;
  resolvedAt?: number;
  tankId?: string;
  lastRepeatedAt?: number;
}

export type RaiseOutcome = 'created' | 'repeated' | 'skipped';

export interface RaisePlan<T> {
  outcome: RaiseOutcome;
  /** Value to write; undefined means "abort the transaction" */
  next: T | undefined;
  /** The finished episode that `next` replaces, to be archived by the caller */
  previous: T | null;
}

/**
 * Decides what raising an alert does to the live record.
 *  - active + acknowledged  -> skipped (never reopen what an operator acknowledged)
 *  - active                 -> repeated (re-announce; the start time is preserved)
 *  - missing or resolved    -> created (a new episode)
 */
export function planRaise<T extends Partial<AlertRecord>>(
  current: T | null | undefined,
  fresh: Partial<AlertRecord> & { id: string; message: string },
  now: number
): RaisePlan<T> {
  if (current && !current.resolved) {
    if (current.acknowledged) return { outcome: 'skipped', next: undefined, previous: null };
    return { outcome: 'repeated', next: { ...current, lastRepeatedAt: now, message: fresh.message }, previous: null };
  }
  return {
    outcome: 'created',
    next: { timestamp: now, read: false, acknowledged: false, resolved: false, ...fresh } as unknown as T,
    previous: current && current.resolved ? current : null,
  };
}

/** Resolves an active alert; undefined (abort) when there is nothing active to resolve. */
export function planResolve<T extends Partial<AlertRecord>>(current: T | null | undefined, now: number): T | undefined {
  if (!current || current.resolved) return undefined;
  return { ...current, resolved: true, resolvedAt: now };
}

/**
 * History row for a finished episode. The key comes from the old record itself, so
 * archiving is idempotent. The acknowledging UID is dropped because database rules
 * only let a user write their own UID.
 */
export function archiveOf<T extends Partial<AlertRecord>>(liveId: string, previous: T): { id: string; record: Omit<T, 'acknowledgedByUid'> & { id: string } } | null {
  if (!previous?.timestamp) return null;
  const id = `${liveId}-${previous.timestamp}`;
  const { acknowledgedByUid: _uid, ...rest } = previous;
  return { id, record: { ...rest, id } };
}
