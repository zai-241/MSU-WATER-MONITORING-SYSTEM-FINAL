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
