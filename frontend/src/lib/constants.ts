/**
 * @file constants.ts
 * @description Timing values, limits and storage keys used across the web app (Q9).
 * Alert timing that the worker also needs lives in alertEngine.ts.
 */
import { DEFAULT_OFFLINE_THRESHOLD_SEC } from './alertEngine';

/** Default "controller offline" threshold. Admins can change it in the Admin Panel. */
export const CONTROLLER_OFFLINE_THRESHOLD_MS = DEFAULT_OFFLINE_THRESHOLD_SEC * 1000;

/**
 * A browser that stands in for the worker may only mark a controller offline after its own
 * database connection has been up, and the page awake, for this long. A tab or the APK coming
 * back from the background still holds tank data from before it slept; without this wait it
 * would report the controller offline and then "back online" a second later.
 */
export const OFFLINE_CHECK_SETTLE_MS = 10_000;

/** The worker writes a heartbeat every 10 s; three missed beats means it is down. */
export const WORKER_STALE_MS = 35_000;

/** Newest notifications streamed to every page (bell, sound, monitor). */
export const LIVE_NOTIFICATION_LIMIT = 100;
/** Newest log entries streamed to the Logs page. */
export const LIVE_LOG_LIMIT = 100;
/** Rows fetched per "load older" step on the notification history page. */
export const HISTORY_PAGE_SIZE = 200;
/** Notifications, logs and history samples older than this are purged. */
export const RETENTION_DAYS = 90;

/**
 * The system's own tanks: Reservoir Tanks 1–4. The app creates a missing one, and they cannot be
 * deleted (disable them instead). An admin can register more tanks (5, 6, ...) in Tank Assignment.
 */
export const DEFAULT_TANK_IDS = ['1', '2', '3', '4'] as const;

export function isDefaultTankId(id: string): boolean {
  return (DEFAULT_TANK_IDS as readonly string[]).includes(id);
}

/** Highest tank ID that can be registered. IDs are whole numbers because the firmware's TANK_ID is an int. */
export const MAX_TANK_ID = 999;

/** A tank ID an admin may register: a whole number from 1 to MAX_TANK_ID, without leading zeros. */
export function isValidTankId(id: string): boolean {
  return /^[1-9]\d*$/.test(id) && Number(id) <= MAX_TANK_ID;
}

/** Tank IDs in number order (1, 2, ..., 10), not text order (1, 10, 2). */
export function tankIdsInOrder(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (Number(a) || Infinity) - (Number(b) || Infinity) || a.localeCompare(b));
}

/** The lowest whole-number tank ID that is not taken yet. */
export function nextFreeTankId(existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  let id = 1;
  while (taken.has(String(id))) id++;
  return String(id);
}

/**
 * Capacity a tank gets until an admin sets its own (Tank 1 holds 200 L).
 * Each tank stores its capacity in /tanks/{id}/capacityLiters.
 */
export const DEFAULT_TANK_CAPACITY_LITERS = 200;

/** A tank's capacity in liters, or the default when it has none (or an invalid one). */
export function tankCapacityLiters(tank: { capacityLiters?: number } | null | undefined): number {
  const value = tank?.capacityLiters;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TANK_CAPACITY_LITERS;
}

/** Estimated stored volume in liters for a level percentage (0–100) of a tank of this capacity. */
export function estimateVolumeLiters(levelPercent: number, capacityLiters: number = DEFAULT_TANK_CAPACITY_LITERS): number {
  return Math.round((levelPercent / 100) * capacityLiters);
}

/**
 * How long the dashboard waits for the controller to acknowledge a pump command
 * (tanks/{id}/pumpCommandAt changes) before it says there was no response.
 */
export const PUMP_COMMAND_TIMEOUT_MS = 15_000;
/** How long the result of a pump command stays under the pump toggle. */
export const PUMP_FEEDBACK_MS = 5_000;

/**
 * Live sensor readings (Admin Panel calibration): each Start or +10 min opens the
 * window by this much; the window never reaches further than CALIBRATION_LIVE_MAX_MS
 * ahead (the database rules enforce the same 30 min). The firmware also stops after
 * 30 min on its own (CALIB_LIVE_MAX_MS).
 */
export const CALIBRATION_LIVE_STEP_MS = 10 * 60_000;
export const CALIBRATION_LIVE_MAX_MS = 30 * 60_000;
/** A live reading older than this is treated as missing ("Waiting for readings"). */
export const CALIBRATION_LIVE_STALE_MS = 8_000;

/** Minimum gap between writes of the tank list to the offline cache. */
export const TANK_CACHE_WRITE_INTERVAL_MS = 5_000;

export const STORAGE_KEYS = {
  tanks: 'wm_tanks',
  config: 'wm_config',
  rememberMe: 'wm_remember_me',
  rememberedEmail: 'wm_remembered_email',
  legacyRememberedPassword: 'wm_remembered_password',
  soundMuted: 'wm_sound_muted',
  soundSnoozeUntil: 'wm_sound_snooze_until',
} as const;
