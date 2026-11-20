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
/** Notification raised by open dashboards when the Alert Service heartbeat stops; the service resolves it on start. */
export const ALERT_SERVICE_OFFLINE_ID = 'alert-service-offline';
export const MIN_OFFLINE_THRESHOLD_SEC = 20; // never below two 10 s heartbeats
export const LEVEL_HYSTERESIS = 2;
export const PH_HYSTERESIS = 0.15;

export type AlertKey = 'lowLevel' | 'overflow' | 'ph' | 'levelFault' | 'phFault' | 'pumpFault';
export type AlertLevel = 'warning' | 'danger';
export type TrackerStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERED';

export const ALERT_KEYS: AlertKey[] = ['levelFault', 'phFault', 'pumpFault', 'lowLevel', 'overflow', 'ph'];

/**
 * tanks/{id}/pumpFault, written by the controller's dry-run guard when it stops the pump:
 * "no-rise" (the level did not rise while pumping) or "max-run" (maximum run time reached).
 * Cleared when an operator turns the pump ON again (or the controller restarts).
 */
export const PUMP_FAULT_TEXT: Record<string, string> = {
  'no-rise': 'the water level did not rise while the pump was running',
  'max-run': 'the pump reached its maximum run time',
};

/** Readable reason for a pumpFault value, or null when there is none. */
export function describePumpFault(fault: unknown): string | null {
  if (typeof fault !== 'string' || fault === '') return null;
  return PUMP_FAULT_TEXT[fault] ?? `pump fault "${fault}"`;
}

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
  /** This tank's own maintenance switch (tanks/{id}/maintenanceMode, set by an admin) */
  maintenanceMode?: boolean;
  /** Set by the controller's dry-run guard (see PUMP_FAULT_TEXT); missing = none */
  pumpFault?: string | null;
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

export function alertNotifId(tankId: string, key: AlertKey | NightKey | 'offline'): string {
  return `alert-${tankId}-${key}`;
}

export function createTankTrackers(): TankTrackers {
  const fresh = (): AlertTracker => ({ status: 'NORMAL', abnormalStartTime: 0, normalStartTime: 0, lastNotificationTime: 0 });
  return { lowLevel: fresh(), overflow: fresh(), ph: fresh(), levelFault: fresh(), phFault: fresh(), pumpFault: fresh() };
}

export function repeatIntervalMs(config: Pick<EngineConfig, 'repeatIntervalSec'> | null | undefined): number {
  const sec = Number(config?.repeatIntervalSec);
  return Math.max(MIN_REPEAT_SEC, Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_REPEAT_SEC) * 1000;
}

export function offlineThresholdMs(config: Pick<EngineConfig, 'offlineThresholdSec'> | null | undefined): number {
  const sec = Number(config?.offlineThresholdSec);
  return Math.max(MIN_OFFLINE_THRESHOLD_SEC, Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_OFFLINE_THRESHOLD_SEC) * 1000;
}

/**
 * True while the tank is under maintenance: its own switch (tanks/{id}/maintenanceMode)
 * or the system-wide one (config/maintenanceMode). No alerts, no offline watchdog, pump held off.
 */
export function isTankInMaintenance(
  tank: { maintenanceMode?: boolean } | null | undefined,
  config: { maintenanceMode?: boolean } | null | undefined,
): boolean {
  return config?.maintenanceMode === true || tank?.maintenanceMode === true;
}

/** A tank that has never reported is "planned", not offline. */
export function isControllerOffline(lastUpdate: number | undefined | null, serverNow: number, thresholdMs: number): boolean {
  if (!lastUpdate) return false;
  return serverNow - lastUpdate > thresholdMs;
}

/**
 * A level value the threshold checks can use. A sensor fault does not make it unusable:
 * monitoring continues on a faulty sensor (the alert says the reading may be inaccurate).
 * Only a missing or impossible value (e.g. the firmware's -999 "no reading yet") is skipped.
 */
export function isValidLevel(tank: EngineTank): boolean {
  return Number.isFinite(tank.waterLevel) && tank.waterLevel >= 0 && tank.waterLevel <= 100;
}

/** Same as isValidLevel, for pH (0 to 14). */
export function isValidPh(tank: EngineTank): boolean {
  return Number.isFinite(tank.phLevel) && tank.phLevel >= 0 && tank.phLevel <= 14;
}

const FAULT_NOTE = ' Sensor fault: this reading may be inaccurate.';

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
    abnormalMsg: `${tank.name} water level sensor reported a hardware fault. Monitoring continues, but level readings may be inaccurate until the sensor is checked. The pump stays off while the level sensor is faulty.`,
    recoveryMsg: `${tank.name} water level sensor fault resolved.`,
  });

  const phFault = tank.phSensorOk === false;
  checks.push({
    key: 'phFault', level: 'danger', title: 'pH Sensor Fault',
    isAbnormal: phFault, isNormal: !phFault,
    abnormalMsg: `${tank.name} pH sensor reported a hardware fault. Monitoring continues, but pH readings may be inaccurate until the sensor is checked.`,
    recoveryMsg: `${tank.name} pH sensor fault resolved.`,
  });

  const pumpReason = describePumpFault(tank.pumpFault);
  checks.push({
    key: 'pumpFault', level: 'danger', title: 'Pump Stopped: Check Water Supply',
    isAbnormal: pumpReason !== null, isNormal: pumpReason === null,
    abnormalMsg: `${tank.name} pump was stopped automatically because ${pumpReason ?? 'of a pump fault'}. Check the water source, valve and pipe. Automatic refills are blocked until the pump is turned ON from the dashboard.`,
    recoveryMsg: `${tank.name} pump fault cleared.`,
  });

  // Threshold checks keep running on a faulty sensor (monitoring is never suspended);
  // the message then says the reading may be inaccurate. Only a missing or impossible
  // value is skipped.
  const levelNote = levelFault ? FAULT_NOTE : '';
  const phNote = phFault ? FAULT_NOTE : '';
  if (isValidLevel(tank)) {
    checks.push({
      key: 'lowLevel', level: 'danger', title: 'Low Water Level',
      isAbnormal: tank.waterLevel < config.lowLevelThreshold,
      isNormal: tank.waterLevel >= config.lowLevelThreshold + LEVEL_HYSTERESIS,
      abnormalMsg: `${tank.name} water level is extremely low (${tank.waterLevel}%).${levelNote}`,
      recoveryMsg: `${tank.name} water level returned to normal (${tank.waterLevel}%).${levelNote}`,
    });
    checks.push({
      key: 'overflow', level: 'warning', title: 'High Water Level',
      isAbnormal: tank.waterLevel > config.overflowThreshold,
      isNormal: tank.waterLevel <= config.overflowThreshold - LEVEL_HYSTERESIS,
      abnormalMsg: `${tank.name} is reaching overflow capacity (${tank.waterLevel}%).${levelNote}`,
      recoveryMsg: `${tank.name} overflow condition resolved (${tank.waterLevel}%).${levelNote}`,
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
      abnormalMsg: `${tank.name} pH level is unsafe (${tank.phLevel}).${phNote}`,
      recoveryMsg: `${tank.name} pH level returned to safe zone (${tank.phLevel}).${phNote}`,
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

  // Disabled tanks, tanks that never reported, and maintenance (system-wide or this tank) never alert
  if (tank.enabled === false || !tank.lastUpdate || isTankInMaintenance(tank, config)) return events;

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
// Night watch: possible leak or open faucet
//
// No water is used at the motor pool at night (default 10 PM to 3 AM, Philippine
// time), so a falling level then means water is leaving the tank. Two checks:
//   - fast: the level falls nightFastDropPercent or more within 30 min
//           -> "Possible Leak or Open Faucet" (danger), raised right away
//   - slow: the level falls nightSlowDropPercent or more over the whole window
//           -> "Possible Slow Leak" (warning), reported when the window ends
// Readings while the pump runs, while the level sensor is faulty, during live
// calibration, and before a gap in evaluation (maintenance, offline controller)
// are left out. The level only changes in steps of at least 2 % (firmware
// WATER_LEVEL_DEADBAND), so the thresholds must stay above that.
// ---------------------------------------------------------------------------

/** Philippine time is UTC+8 all year (no daylight saving). The worker's own clock is UTC. */
export const NIGHT_TZ_OFFSET_MIN = 8 * 60;
export const DEFAULT_NIGHT_START_HOUR = 22;
export const DEFAULT_NIGHT_END_HOUR = 3;
export const DEFAULT_NIGHT_FAST_DROP_PERCENT = 5;
export const DEFAULT_NIGHT_SLOW_DROP_PERCENT = 3;
/** Smallest drop threshold allowed: above the firmware's 2 % level deadband. */
export const MIN_NIGHT_DROP_PERCENT = 3;
/** The fast check compares the level with the highest level of this last stretch. */
export const NIGHT_FAST_WINDOW_MS = 30 * 60_000;
/** A fast drop must still be there after this long before it is raised (one bad reading is not enough). */
export const NIGHT_DRAIN_CONFIRM_MS = 60_000;
/** The fast alert recovers once the level has not fallen any further for this long. */
export const NIGHT_STEADY_MS = 15 * 60_000;
/** Level samples kept for the fast check: at most one per this interval. */
export const NIGHT_SAMPLE_MS = 30_000;
/** A pause in evaluation longer than this (maintenance, offline controller, sleeping tab) restarts the tracking. */
export const NIGHT_GAP_RESET_MS = 60_000;
/** The slow-leak summary is skipped if the evaluator only notices the window ended this much later. */
export const NIGHT_SUMMARY_LATE_MS = 30 * 60_000;

export type NightKey = 'nightDrain' | 'nightLeak';

export interface NightConfig {
  maintenanceMode?: boolean;
  repeatIntervalSec?: number;
  /** Missing = on */
  nightWatchEnabled?: boolean;
  nightStartHour?: number;
  nightEndHour?: number;
  nightFastDropPercent?: number;
  nightSlowDropPercent?: number;
}

export interface NightSettings {
  enabled: boolean;
  startHour: number;
  endHour: number;
  fastDrop: number;
  slowDrop: number;
}

export interface NightTank {
  id: string;
  name: string;
  enabled?: boolean;
  lastUpdate?: number;
  waterLevel: number;
  levelSensorOk?: boolean;
  maintenanceMode?: boolean;
  pumpOn?: boolean;
  /** Server ms until which live calibration runs (readings are skipped meanwhile) */
  calibrationUntil?: number | null;
  capacityLiters?: number;
}

export interface NightState {
  /** Start (server ms) of the window being tracked; 0 = none yet */
  windowStart: number;
  windowEnd: number;
  /** Level samples of the last 30 min, pump off, inside the window */
  samples: { t: number; level: number }[];
  /** When the fast drop was first seen (0 = not now) */
  fastSince: number;
  /** Highest level since tracking (re)started; null = no reading yet */
  segmentPeak: number | null;
  segmentLast: number | null;
  /** Drop already counted from earlier stretches of this window */
  committedDrop: number;
  /** The fast alert was raised during this window (then the summary is not needed) */
  fastRaisedThisWindow: boolean;
  summaryDone: boolean;
  /** The fast alert is active: lowest level since and when it was reached */
  active: boolean;
  trough: number;
  troughAt: number;
  lastNotificationTime: number;
  /** Last time this tank was evaluated (0 = never) */
  lastEvalAt: number;
}

export interface NightEvent {
  /** close = resolve without a recovery message */
  kind: 'raise' | 'repeat' | 'recover' | 'close';
  key: NightKey;
  tankId: string;
  notifId: string;
  level: AlertLevel;
  title: string;
  message: string;
}

export function createNightState(): NightState {
  return {
    windowStart: 0, windowEnd: 0, samples: [], fastSince: 0, segmentPeak: null, segmentLast: null,
    committedDrop: 0, fastRaisedThisWindow: false, summaryDone: false,
    active: false, trough: 0, troughAt: 0, lastNotificationTime: 0, lastEvalAt: 0,
  };
}

/**
 * Rebuilds a night state saved in the database (the worker keeps it in /system/nightWatch so a
 * restart during the night does not lose the slow-leak total). Anything missing or malformed
 * falls back to a fresh state's value. The database drops nulls and empty arrays, hence the defaults.
 */
export function restoreNightState(raw: unknown): NightState {
  const fresh = createNightState();
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const bool = (v: unknown) => v === true;
  const samples = Array.isArray(r.samples)
    ? r.samples
        .filter((s): s is { t: number; level: number } =>
          !!s && typeof s === 'object' && Number.isFinite((s as { t: unknown }).t) && Number.isFinite((s as { level: unknown }).level))
        .map(s => ({ t: s.t, level: s.level }))
    : [];
  return {
    windowStart: num(r.windowStart, 0),
    windowEnd: num(r.windowEnd, 0),
    samples,
    fastSince: num(r.fastSince, 0),
    segmentPeak: numOrNull(r.segmentPeak),
    segmentLast: numOrNull(r.segmentLast),
    committedDrop: num(r.committedDrop, 0),
    fastRaisedThisWindow: bool(r.fastRaisedThisWindow),
    summaryDone: bool(r.summaryDone),
    active: bool(r.active),
    trough: num(r.trough, 0),
    troughAt: num(r.troughAt, 0),
    lastNotificationTime: num(r.lastNotificationTime, 0),
    lastEvalAt: num(r.lastEvalAt, 0),
  };
}

function hourOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== null && Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function dropOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== null && Number.isFinite(n) && n >= MIN_NIGHT_DROP_PERCENT && n <= 100 ? n : fallback;
}

/** The night watch settings from /config, with defaults for anything missing or invalid. */
export function nightSettings(config: NightConfig | null | undefined): NightSettings {
  return {
    enabled: config?.nightWatchEnabled !== false,
    startHour: hourOr(config?.nightStartHour, DEFAULT_NIGHT_START_HOUR),
    endHour: hourOr(config?.nightEndHour, DEFAULT_NIGHT_END_HOUR),
    fastDrop: dropOr(config?.nightFastDropPercent, DEFAULT_NIGHT_FAST_DROP_PERCENT),
    slowDrop: dropOr(config?.nightSlowDropPercent, DEFAULT_NIGHT_SLOW_DROP_PERCENT),
  };
}

/** "10 PM", "12 AM", "3 AM" */
export function formatHour12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

const HOUR_MS = 3_600_000;

/**
 * The night window (server ms) that contains `now`, or null outside it.
 * Hours are Philippine time; a window may cross midnight (22 -> 3). Equal hours mean no window.
 */
export function nightWindowAt(now: number, startHour: number, endHour: number): { start: number; end: number } | null {
  const length = (endHour - startHour + 24) % 24;
  if (length === 0) return null;
  const offsetMs = NIGHT_TZ_OFFSET_MIN * 60_000;
  const local = now + offsetMs;
  const localMidnight = Math.floor(local / (24 * HOUR_MS)) * 24 * HOUR_MS;
  // Today's window, or the one that started yesterday and runs past midnight
  for (const dayStart of [localMidnight, localMidnight - 24 * HOUR_MS]) {
    const start = dayStart + startHour * HOUR_MS - offsetMs;
    const end = start + length * HOUR_MS;
    if (now >= start && now < end) return { start, end };
  }
  return null;
}

function litersNote(dropPercent: number, capacityLiters: number | undefined): string {
  return typeof capacityLiters === 'number' && capacityLiters > 0
    ? ` (about ${Math.round((dropPercent / 100) * capacityLiters)} L)`
    : '';
}

/** Counts the current stretch into the window total and starts a new one. */
function closeSegment(state: NightState): void {
  if (state.segmentPeak !== null && state.segmentLast !== null) {
    state.committedDrop += Math.max(0, state.segmentPeak - state.segmentLast);
  }
  state.segmentPeak = null;
  state.segmentLast = null;
  state.samples = [];
  state.fastSince = 0;
}

export interface EvaluateNightArgs {
  tank: NightTank;
  config: NightConfig;
  /** Mutated in place: keep one object per tank between calls */
  state: NightState;
  /** Server time (ms): the window follows the clock, so it must not be a device's own clock */
  now: number;
  getExisting: (notifId: string) => ExistingAlert | null | undefined;
}

/**
 * Advances the night watch for one tank and returns what should happen.
 * The caller skips offline controllers and maintenance mode (as for evaluateTank);
 * the gap check below then restarts the tracking when evaluation resumes.
 */
export function evaluateNight({ tank, config, state, now, getExisting }: EvaluateNightArgs): NightEvent[] {
  const events: NightEvent[] = [];
  const settings = nightSettings(config);
  const drainId = alertNotifId(tank.id, 'nightDrain');
  const leakId = alertNotifId(tank.id, 'nightLeak');
  const window = settings.enabled ? nightWindowAt(now, settings.startHour, settings.endHour) : null;
  const hours = `${formatHour12(settings.startHour)} to ${formatHour12(settings.endHour)}`;

  if (tank.enabled === false || !tank.lastUpdate || isTankInMaintenance(tank, config)) {
    state.lastEvalAt = 0;
    return events;
  }

  // A pause in evaluation: the readings from before it say nothing about now
  if (state.lastEvalAt && now - state.lastEvalAt > NIGHT_GAP_RESET_MS) closeSegment(state);
  state.lastEvalAt = now;

  // 1. The tracked window ended: report a slow leak once
  if (state.windowStart && now >= state.windowEnd && !state.summaryDone) {
    state.summaryDone = true;
    closeSegment(state);
    const late = now - state.windowEnd > NIGHT_SUMMARY_LATE_MS;
    if (!late && !state.fastRaisedThisWindow && state.committedDrop >= settings.slowDrop) {
      const drop = Math.round(state.committedDrop);
      events.push({
        kind: 'raise', key: 'nightLeak', tankId: tank.id, notifId: leakId, level: 'warning',
        title: 'Possible Slow Leak',
        message: `${tank.name} lost ${drop}% of its water${litersNote(drop, tank.capacityLiters)} between ${hours}, when no water should be used. Check for a dripping faucet or a slow leak.`,
      });
    }
  }

  // 2. A new window starts: fresh tracking, and last night's slow-leak notice is closed
  if (window && window.start !== state.windowStart) {
    const previousLeak = getExisting(leakId);
    if (previousLeak && !previousLeak.resolved) {
      events.push({ kind: 'close', key: 'nightLeak', tankId: tank.id, notifId: leakId, level: 'warning', title: 'Possible Slow Leak', message: '' });
    }
    Object.assign(state, {
      windowStart: window.start, windowEnd: window.end, samples: [], fastSince: 0,
      segmentPeak: null, segmentLast: null, committedDrop: 0, fastRaisedThisWindow: false, summaryDone: false,
    });
  }

  const level = tank.waterLevel;
  const usable = Number.isFinite(level) && level >= 0 && level <= 100
    && tank.levelSensorOk !== false
    && !(typeof tank.calibrationUntil === 'number' && tank.calibrationUntil > now);

  // 3. An active fast alert (also one raised before this process started) recovers once the level holds
  const existingDrain = getExisting(drainId);
  if (!state.active && existingDrain && !existingDrain.resolved && usable) {
    state.active = true;
    state.fastRaisedThisWindow = true; // no slow-leak notice on top of it
    state.trough = level;
    state.troughAt = now;
    state.lastNotificationTime = Math.max(existingDrain.timestamp || 0, existingDrain.lastRepeatedAt || 0);
  }
  if (state.active && usable) {
    if (level < state.trough) {
      state.trough = level;
      state.troughAt = now;
    } else if (now - state.troughAt >= NIGHT_STEADY_MS) {
      state.active = false;
      // The drop already reported must not raise the alert again: only a new drop counts
      state.samples = [];
      state.fastSince = 0;
      events.push({
        kind: 'recover', key: 'nightDrain', tankId: tank.id, notifId: drainId, level: 'danger',
        title: 'Night Water Loss Stopped',
        message: `${tank.name} water level has held for ${NIGHT_STEADY_MS / 60_000} minutes (now ${level}%).`,
      });
    }
  }

  // 4. Inside the window: follow the level while the pump is off
  if (!window) return events;
  if (!usable || tank.pumpOn) {
    closeSegment(state); // the pump refills the tank; a faulty or calibrating sensor is not trusted
    return events;
  }

  state.segmentPeak = state.segmentPeak === null ? level : Math.max(state.segmentPeak, level);
  state.segmentLast = level;

  state.samples = state.samples.filter(s => now - s.t <= NIGHT_FAST_WINDOW_MS);
  const lastSample = state.samples[state.samples.length - 1];
  if (!lastSample || now - lastSample.t >= NIGHT_SAMPLE_MS) state.samples.push({ t: now, level });

  const recentPeak = Math.max(...state.samples.map(s => s.level), level);
  const fastDrop = recentPeak - level;
  if (fastDrop < settings.fastDrop) {
    state.fastSince = 0;
  } else if (state.fastSince === 0) {
    state.fastSince = now;
  } else if (!state.active && now - state.fastSince >= NIGHT_DRAIN_CONFIRM_MS) {
    state.active = true;
    state.fastRaisedThisWindow = true;
    state.trough = level;
    state.troughAt = now;
    state.lastNotificationTime = now;
    events.push({
      kind: 'raise', key: 'nightDrain', tankId: tank.id, notifId: drainId, level: 'danger',
      title: 'Possible Leak or Open Faucet',
      message: `${tank.name} dropped ${Math.round(fastDrop)}%${litersNote(fastDrop, tank.capacityLiters)} within ${NIGHT_FAST_WINDOW_MS / 60_000} minutes during night hours (${hours}), when no water should be used. Check for an open faucet or a leak. Now at ${level}%.`,
    });
  }

  // Re-announce an unacknowledged fast alert like the other alerts
  if (state.active && !events.some(e => e.key === 'nightDrain')) {
    const existing = getExisting(drainId);
    if (!(existing?.acknowledged && !existing.resolved) && now - state.lastNotificationTime >= repeatIntervalMs(config)) {
      state.lastNotificationTime = now;
      events.push({
        kind: 'repeat', key: 'nightDrain', tankId: tank.id, notifId: drainId, level: 'danger',
        title: 'Possible Leak or Open Faucet',
        message: `${tank.name} is still losing water during night hours (${hours}). Check for an open faucet or a leak. Now at ${level}%.`,
      });
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
