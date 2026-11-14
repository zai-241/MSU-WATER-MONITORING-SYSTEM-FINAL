/**
 * @file constants.ts
 * @description Timing values, limits and storage keys used across the web app (Q9).
 * Alert timing that the worker also needs lives in alertEngine.ts.
 */
import { DEFAULT_OFFLINE_THRESHOLD_SEC } from './alertEngine';

/** Default "controller offline" threshold. Admins can change it in the Admin Panel. */
export const CONTROLLER_OFFLINE_THRESHOLD_MS = DEFAULT_OFFLINE_THRESHOLD_SEC * 1000;

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
