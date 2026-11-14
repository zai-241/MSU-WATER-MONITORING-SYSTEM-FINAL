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
import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { database, auth } from '@/config/firebase';
import { ref, onValue, set, update, push, remove, runTransaction, query, orderByChild, limitToLast, endAt, get } from 'firebase/database';
import {
  CONTROLLER_OFFLINE_THRESHOLD_MS,
  WORKER_STALE_MS,
  LIVE_NOTIFICATION_LIMIT,
  LIVE_LOG_LIMIT,
  HISTORY_PAGE_SIZE,
  RETENTION_DAYS,
  TANK_CACHE_WRITE_INTERVAL_MS,
  STORAGE_KEYS,
  DEFAULT_TANK_CAPACITY_LITERS,
  tankCapacityLiters,
} from '@/lib/constants';
import { planRaise, planResolve, archiveOf, type RaisePlan, type RaiseOutcome } from '@/lib/alertEngine';

export type UserRole = 'admin' | 'worker' | 'viewer';
export type TankStatus = 'safe' | 'warning' | 'danger' | 'offline';

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
  /** Tank capacity in liters, set by an admin (used for the estimated volume) */
  capacityLiters?: number;
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
  /** When false the alert worker stops sending push notifications */
  pushEnabled?: boolean;
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
    /** Tank the entry belongs to (sent by the Tank 2–4 controllers; Tank 1 and old logs omit it) */
    tankId?: string;
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
    capacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
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
    capacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
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
    capacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
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
    capacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
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

export { CONTROLLER_OFFLINE_THRESHOLD_MS };

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
    addNotification?: (notif: Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string; acknowledged?: boolean; resolved?: boolean }) => Promise<unknown>;
    resolveNotification?: (id: string) => Promise<unknown>;
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
export function sanitizeTank(key: string, raw: unknown): Tank {
  // Database values are untrusted: every field below is checked before it is used
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Tank>;
  const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  // Sensor health flags
  const phSensorOk = r.phSensorOk !== false;
  const levelSensorOk = r.levelSensorOk !== false;

  // Water level: 0-100%, handling firmware -999 or non-numeric/null
  let waterLevel = 0;
  if (isNumber(r.waterLevel)) {
    if (r.waterLevel === -999) {
      waterLevel = 0;
    } else {
      waterLevel = Math.max(0, Math.min(100, r.waterLevel));
    }
  }

  // pH level: 0-14, default 7.0 for uninitialized or invalid
  let phLevel = 7.0;
  if (isNumber(r.phLevel)) {
    if (r.phLevel === -999) {
      phLevel = 7.0;
    } else {
      phLevel = Math.max(0, Math.min(14, r.phLevel));
    }
  }

  // Water height: >= 0
  let waterHeight = 0;
  if (isNumber(r.waterHeight) && r.waterHeight >= 0) {
    waterHeight = r.waterHeight;
  }

  return {
    ...r,
    id: r.id || key,
    name: r.name || `Tank ${key}`,
    waterLevel,
    phLevel,
    waterHeight,
    status: r.status || 'safe',
    pumpOn: !!r.pumpOn,
    enabled: r.enabled !== false,
    phSensorOk,
    levelSensorOk,
    levelVmin: isNumber(r.levelVmin) ? r.levelVmin : 0.25,
    levelVmax: isNumber(r.levelVmax) ? r.levelVmax : 3.0,
    tankHeight: isNumber(r.tankHeight) ? r.tankHeight : 5.0,
    capacityLiters: tankCapacityLiters(r),
    levelOffset: isNumber(r.levelOffset) ? r.levelOffset : 0,
    phNeutralVoltage: isNumber(r.phNeutralVoltage) ? r.phNeutralVoltage : 2.5,
    phSlope: isNumber(r.phSlope) ? r.phSlope : 0.18,
    phOffset: isNumber(r.phOffset) ? r.phOffset : 0.0,
    assignedWorker: r.assignedWorker ?? null,
    controllerOffline: !!r.controllerOffline,
  };
}

// ---------------------------------------------------------------------------
// Shared subscriptions (P2)
//
// Each database path is listened to once, no matter how many components use the
// hook. The first component to mount attaches the Firebase listener; the last one
// to unmount detaches it. Every consumer reads the same parsed value, so parsing,
// sorting and localStorage writes happen once per update instead of once per hook.
// ---------------------------------------------------------------------------

interface Shared<T> {
  subscribe: (listener: () => void) => () => void;
  get: () => T;
}

function createShared<T>(init: () => T, attach: (emit: (value: T) => void) => (() => void) | void): Shared<T> {
  let value: T;
  let hasValue = false;
  let detach: (() => void) | void;
  const listeners = new Set<() => void>();

  const get = () => {
    if (!hasValue) {
      value = init();
      hasValue = true;
    }
    return value;
  };

  const emit = (next: T) => {
    value = next;
    hasValue = true;
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      try {
        detach = attach(emit);
      } catch (err) {
        console.error('Error attaching database listener:', err);
        detach = undefined;
      }
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        if (typeof detach === 'function') detach();
        detach = undefined;
        hasValue = false; // next mount starts from a fresh initial value
      }
    };
  };

  return { subscribe, get };
}

function useShared<T>(source: Shared<T>): T {
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}

/** True when a real Firebase database instance is available (false under mocked test databases). */
function dbUsable(): boolean {
  const db = database as unknown as { _checkNotDeleted?: unknown; app?: unknown } | null;
  return typeof db?._checkNotDeleted === 'function' || !!db?.app;
}

// --- Server time -----------------------------------------------------------

let cachedServerOffset = 0;

/** Estimated Firebase server time. Used for every timestamp the web app writes (B18). */
export function serverNow(): number {
  return Date.now() + cachedServerOffset;
}

const serverOffsetSource = createShared<number>(
  () => cachedServerOffset,
  (emit) =>
    onValue(
      ref(database, '.info/serverTimeOffset'),
      (snapshot) => {
        const val = snapshot.val();
        if (typeof val === 'number') {
          cachedServerOffset = val;
          emit(val);
        }
      },
      (error) => console.error('Error reading serverTimeOffset from database:', error)
    )
);

/**
 * Firebase server time offset from '/.info/serverTimeOffset'.
 * Estimated Server Time = Date.now() + serverTimeOffset
 */
export function useServerTimeOffset(): number {
  return useShared(serverOffsetSource);
}

// --- Tanks -----------------------------------------------------------------

interface TanksState {
  tanks: Tank[];
  /** false until the first snapshot arrives: until then `tanks` is the local cache (B15) */
  isLive: boolean;
}

let lastTankCacheWrite = 0;

const tanksSource = createShared<TanksState>(
  () => ({ tanks: loadFromStorage(STORAGE_KEYS.tanks, DEFAULT_TANKS), isLive: false }),
  (emit) => {
    const tanksRef = ref(database, 'tanks');
    return onValue(
      tanksRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Sanitize raw tank telemetry (E1 / R6)
          const tankList = Object.entries(data).map(([key, value]) => sanitizeTank(key, value));
          emit({ tanks: tankList, isLive: true });
          addMissingDefaultTanks(Object.keys(data));
          // P3: telemetry changes about once a second; the offline cache does not need to
          const now = Date.now();
          if (now - lastTankCacheWrite >= TANK_CACHE_WRITE_INTERVAL_MS) {
            lastTankCacheWrite = now;
            saveToStorage(STORAGE_KEYS.tanks, tankList);
          }
        } else {
          // Empty database: create the tank records (name + calibration only, no readings).
          // Rules allow this for admins/workers; for anyone else it is refused and ignored.
          Promise.resolve(update(tanksRef, DEFAULT_TANKS.reduce((acc, tank) => ({ ...acc, [tank.id]: tank }), {})))
            .catch(() => { /* not permitted for this role */ });
        }
      },
      (error) => console.error('Error reading tanks from database:', error)
    );
  }
);

export function updateTank(id: string, updates: Partial<Tank>) {
  if (!id || id.trim() === '') {
    return Promise.reject(new Error('Invalid tank ID. Operations cannot be performed on blank identifiers.'));
  }
  return update(ref(database, `tanks/${id}`), updates);
}

export function addTank(tank: Pick<Tank, 'id' | 'name'> & Partial<Tank>) {
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
    capacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
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
}

/** Default tank IDs this client already tried to create, so a refused write is not retried on every snapshot */
const attemptedDefaultTankIds = new Set<string>();

/**
 * Creates any of the default tanks (1–4) that are missing from the database, through addTank.
 * Tanks that already exist are never written. Rules allow this for admins/workers; for
 * anyone else the write is refused and ignored.
 */
export function addMissingDefaultTanks(existingIds: string[]) {
  const existing = new Set(existingIds);
  for (const tank of DEFAULT_TANKS) {
    if (existing.has(tank.id) || attemptedDefaultTankIds.has(tank.id)) continue;
    attemptedDefaultTankIds.add(tank.id);
    Promise.resolve(addTank({ ...tank })).catch(() => { /* not permitted for this role */ });
  }
}

/** Test helper: forget which default tanks were already attempted */
export function resetDefaultTankSeeding() {
  attemptedDefaultTankIds.clear();
}

export function deleteTank(id: string) {
  if (!id || id.trim() === '') {
    return Promise.reject(new Error('Invalid tank ID. Deletion cannot be performed on blank identifiers.'));
  }
  return remove(ref(database, `tanks/${id}`));
}

export function useTanks() {
  const { tanks, isLive } = useShared(tanksSource);
  const serverTimeOffset = useServerTimeOffset();
  return { tanks, isLive, updateTank, addTank, deleteTank, serverTimeOffset };
}

// --- Config ----------------------------------------------------------------

const configSource = createShared<SystemConfig>(
  () => ({ ...DEFAULT_CONFIG, ...loadFromStorage<Partial<SystemConfig>>(STORAGE_KEYS.config, {}) }),
  (emit) => {
    const configRef = ref(database, 'config');
    return onValue(
      configRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          emit({ ...DEFAULT_CONFIG, ...data });
          saveToStorage(STORAGE_KEYS.config, data);
        } else {
          Promise.resolve(set(configRef, DEFAULT_CONFIG)).catch(() => { /* only an admin may create the config */ });
        }
      },
      (error) => console.error('Error reading config from database:', error)
    );
  }
);

export function updateConfig(updates: Partial<SystemConfig>) {
  return update(ref(database, 'config'), updates);
}

export function useConfig() {
  const config = useShared(configSource);
  return { config, updateConfig };
}

// --- Notifications ---------------------------------------------------------

function parseNotifications(data: unknown): Notification[] {
  if (!data || typeof data !== 'object') return [];
  const list = Object.entries(data as Record<string, Partial<Notification> | null>).map(([key, value]) => ({
    ...value,
    id: value?.id || key,
    timestamp: typeof value?.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : 0,
  })) as Notification[];
  list.sort((a, b) => b.timestamp - a.timestamp);
  return list;
}

/** Latest notifications: feeds the bell, the alarm sound and the alert monitor. */
const notificationsSource = createShared<Notification[]>(
  () => [],
  (emit) =>
    onValue(
      // R2 / P1: only the newest entries are streamed to every page
      query(ref(database, 'notifications'), orderByChild('timestamp'), limitToLast(LIVE_NOTIFICATION_LIMIT)),
      (snapshot) => emit(parseNotifications(snapshot.val())),
      (error) => console.error('Error reading notifications from database:', error)
    )
);

export type NewNotification = Omit<Notification, 'id' | 'timestamp' | 'read'> & { id?: string };
export type { RaiseOutcome };

/**
 * Writes a notification.
 *
 * - Without an `id`, or with `resolved: true`: a plain history row (recovery, info).
 * - With a fixed `id` (one live record per tank + condition): an atomic raise.
 *   The database transaction guarantees that when several browsers (or a browser and
 *   the worker) detect the same condition together, exactly one of them creates the
 *   alert. An alert that is already active is re-announced, never recreated, and an
 *   acknowledged one is left untouched (B2). When a new episode starts, the finished
 *   episode is first copied to its own row so history is never overwritten.
 */
export async function addNotification(notif: NewNotification): Promise<RaiseOutcome> {
  const now = serverNow();
  const notifsRef = ref(database, 'notifications');

  if (!notif.id || notif.resolved === true) {
    const id = notif.id || push(notifsRef)?.key || `${now}`;
    await set(ref(database, `notifications/${id}`), {
      timestamp: now,
      read: false,
      acknowledged: false,
      resolved: false,
      ...notif,
      id,
    });
    return 'created';
  }

  const id = notif.id;
  let plan: RaisePlan<Notification> | null = null;

  const result = await runTransaction(ref(database, `notifications/${id}`), (current: Notification | null) => {
    plan = planRaise<Notification>(current, { ...notif, id }, now);
    return plan.next; // undefined aborts: an operator already acknowledged this episode
  });

  const applied = plan as RaisePlan<Notification> | null;
  if (!result?.committed || !applied) return 'skipped';

  if (applied.outcome === 'created' && applied.previous) {
    const archive = archiveOf(id, applied.previous);
    if (archive) {
      try {
        await set(ref(database, `notifications/${archive.id}`), archive.record);
      } catch (err) {
        console.error('Error archiving previous alert episode:', err);
      }
    }
  }
  return applied.outcome;
}

/**
 * Marks a live alert as resolved. Returns the alert as it was before resolving, or
 * null when there was nothing to resolve (missing, or another client got there first).
 * Callers use that to write the matching "recovered" row exactly once (B3).
 */
export async function resolveNotification(id: string): Promise<Notification | null> {
  const now = serverNow();
  let before: Notification | null = null;
  const result = await runTransaction(ref(database, `notifications/${id}`), (current: Notification | null) => {
    const next = planResolve(current, now);
    before = next ? current : null;
    return next;
  });
  return result?.committed ? (before as Notification | null) : null;
}

/** @deprecated Shared read flag. Read state is per user: see useUserNotificationsState. */
export function markRead(id: string) {
  return update(ref(database, `notifications/${id}`), { read: true });
}

export function acknowledgeNotification(id: string, username: string, title?: string) {
  const acknowledgedAt = serverNow();
  const logId = push(ref(database, 'logs'))?.key || `${acknowledgedAt}`;
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
}

async function purgeOlderThan(path: 'notifications' | 'logs', olderThanDays: number): Promise<number> {
  const cutoff = serverNow() - olderThanDays * 24 * 60 * 60 * 1000;
  const targetRef = ref(database, path);
  // Indexed range query: only the expired rows are downloaded
  const snap = await get(query(targetRef, orderByChild('timestamp'), endAt(cutoff)));
  if (!snap.exists()) return 0;
  const updates: Record<string, null> = {};
  snap.forEach((child) => {
    if (child.key) updates[child.key] = null;
  });
  const count = Object.keys(updates).length;
  if (count > 0) await update(targetRef, updates);
  return count;
}

export function purgeOldNotifications(olderThanDays = RETENTION_DAYS): Promise<number> {
  return purgeOlderThan('notifications', olderThanDays);
}

function clearAllNotifications() {
  return set(ref(database, 'notifications'), null);
}

export function useNotifications() {
  const notifications = useShared(notificationsSource);
  return {
    notifications,
    addNotification,
    resolveNotification,
    markRead,
    clearAll: clearAllNotifications,
    purgeOldNotifications,
    acknowledgeNotification,
  };
}

/**
 * Notification history for the history page (R5).
 * Unlike the live feed it is not capped: "load older" widens the window, so every
 * stored notification within the retention period can be reached.
 */
export function useNotificationHistory(pageSize: number = HISTORY_PAGE_SIZE) {
  const [limit, setLimit] = useState(pageSize);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onValue(
      query(ref(database, 'notifications'), orderByChild('timestamp'), limitToLast(limit)),
      (snapshot) => {
        setItems(parseNotifications(snapshot.val()));
        setLoading(false);
      },
      (error) => {
        console.error('Error reading notification history:', error);
        setLoading(false);
      }
    );
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [limit]);

  const hasMore = items.length >= limit;
  const loadMore = useCallback(() => setLimit((current) => current + pageSize), [pageSize]);

  return { notifications: items, loading, hasMore, loadMore };
}

// --- Logs ------------------------------------------------------------------

export function addSystemLog(log: Omit<Log, 'id' | 'timestamp'>) {
  try {
    if (!dbUsable()) return Promise.resolve();
    const newLogRef = push(ref(database, 'logs'));
    const timestamp = serverNow();
    const id = newLogRef?.key || `${timestamp}`;
    const newLog: Log = { ...log, logLevel: log.logLevel || 'INFO', id, timestamp };
    return set(newLogRef || ref(database, `logs/${id}`), newLog);
  } catch (err) {
    console.error('Failed to add log:', err);
    return Promise.resolve();
  }
}

const logsSource = createShared<Log[]>(
  () => [],
  (emit) => {
    if (!dbUsable()) return;
    // Latest entries by key order (push keys are chronological): no full download
    return onValue(
      query(ref(database, 'logs'), limitToLast(LIVE_LOG_LIMIT)),
      (snapshot) => {
        const data = snapshot.val();
        if (data && typeof data === 'object') {
          const list = Object.entries(data).map(([key, value]: [string, Partial<Log> | null]) => ({
            ...value,
            id: key, // database key: ESP32 "esp32-<millis>" ids repeat after a reboot
            timestamp: typeof value?.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : Date.now(),
          })) as Log[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          emit(list);
        } else {
          emit([]);
        }
      },
      (error) => console.error('Error reading logs from database:', error)
    );
  }
);

function clearAllLogs() {
  try {
    return set(ref(database, 'logs'), null);
  } catch (err) {
    console.error('Failed to clear logs:', err);
    return Promise.resolve();
  }
}

export function purgeOldLogs(olderThanDays = RETENTION_DAYS): Promise<number> {
  return purgeOlderThan('logs', olderThanDays);
}

export function useLogs() {
  const logs = useShared(logsSource);
  return { logs, addLog: addSystemLog, clearAll: clearAllLogs, purgeOldLogs };
}

// --- Connection ------------------------------------------------------------

const connectedSource = createShared<boolean>(
  () => true,
  (emit) => {
    if (!dbUsable()) return;
    return onValue(
      ref(database, '.info/connected'),
      (snapshot) => {
        const val = snapshot.val();
        if (typeof val === 'boolean') emit(val);
      },
      (error) => console.error('Error reading .info/connected:', error)
    );
  }
);

/**
 * Firebase connection state via '/.info/connected' (R2 / E3).
 * Returns true when connected, false when disconnected or offline.
 */
export function useConnectionState(): boolean {
  return useShared(connectedSource);
}

// --- Server-side alert worker ----------------------------------------------

// undefined = not read yet; null = no heartbeat (never ran, or it disconnected and removed it)
const workerSource = createShared<number | null | undefined>(
  () => undefined,
  (emit) => {
    if (!dbUsable()) return;
    return onValue(
      ref(database, 'system/worker/lastSeen'),
      (snapshot) => {
        const val = snapshot.val();
        emit(typeof val === 'number' ? val : null);
      },
      // Not readable (older rules) simply means "no worker": the browser keeps evaluating
      () => emit(null)
    );
  }
);

/**
 * Reports whether the server-side alert worker (backend/worker) is running.
 * The worker writes a heartbeat every few seconds. While it is fresh the worker owns
 * alert evaluation and browsers only display; when it goes stale, browsers take over
 * again so alerts never silently stop.
 */
export function useWorkerStatus(): { active: boolean; lastSeen: number | null; loaded: boolean } {
  const raw = useShared(workerSource);
  const lastSeen = raw ?? null;
  const offset = useServerTimeOffset();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const active = lastSeen !== null && Date.now() + offset - lastSeen < WORKER_STALE_MS;
  return { active, lastSeen, loaded: raw !== undefined };
}

// --- Per-user notification read state (R5) ---------------------------------

interface UserNotificationState {
  lastReadAt: number;
  readIds: Record<string, true>;
}

const EMPTY_READ_STATE: UserNotificationState = { lastReadAt: 0, readIds: {} };

/**
 * Read/unread is stored per user under '/userState/{uid}', never on the shared
 * notification record, so one operator reading an alert does not hide it for others.
 *
 *   notificationsLastReadAt : everything at or before this time is read ("mark all")
 *   notificationsReadIds    : individual notifications opened since then
 */
export function useUserNotificationsState(uid?: string) {
  const [state, setState] = useState<UserNotificationState>(EMPTY_READ_STATE);

  useEffect(() => {
    setState(EMPTY_READ_STATE);
    if (!uid || !dbUsable()) return;
    try {
      const unsubscribe = onValue(
        ref(database, `userState/${uid}`),
        (snapshot) => {
          const val = snapshot.val() || {};
          setState({
            lastReadAt: typeof val.notificationsLastReadAt === 'number' ? val.notificationsLastReadAt : 0,
            readIds: val.notificationsReadIds && typeof val.notificationsReadIds === 'object' ? val.notificationsReadIds : {},
          });
        },
        (error) => console.error('Error reading user notification state:', error)
      );
      return () => unsubscribe();
    } catch {
      // Graceful fallback for mocked test databases
    }
  }, [uid]);

  const isUnread = useCallback(
    (notif: Pick<Notification, 'id' | 'timestamp'>) => notif.timestamp > state.lastReadAt && !state.readIds[notif.id],
    [state]
  );

  const markAllAsRead = useCallback(() => {
    const now = serverNow();
    setState({ lastReadAt: now, readIds: {} }); // optimistic
    if (!uid || !dbUsable()) return Promise.resolve();
    return update(ref(database, `userState/${uid}`), {
      notificationsLastReadAt: now,
      notificationsReadIds: null, // everything older is covered by the timestamp
    });
  }, [uid]);

  const markOneRead = useCallback((id: string) => {
    if (!id || state.readIds[id]) return Promise.resolve();
    setState((prev) => ({ ...prev, readIds: { ...prev.readIds, [id]: true } })); // optimistic
    if (!uid || !dbUsable()) return Promise.resolve();
    return set(ref(database, `userState/${uid}/notificationsReadIds/${id}`), true);
  }, [uid, state.readIds]);

  return { lastReadAt: state.lastReadAt, readIds: state.readIds, isUnread, markAllAsRead, markOneRead };
}

// --- Clock -----------------------------------------------------------------

/** Header clock, in Firebase server time (B17). */
export function useClock() {
  const [time, setTime] = useState(() => new Date(serverNow()));
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date(serverNow())), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatted = time.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) +
    ' - ' + time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return formatted;
}
