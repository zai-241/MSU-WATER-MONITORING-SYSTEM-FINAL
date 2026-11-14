/**
 * MSU Water Monitoring System — alert worker
 *
 * A small always-on process that makes alerts independent of any open browser:
 *
 *   1. Evaluates threshold and sensor-fault alerts for every tank, using the same
 *      alert engine as the web app (frontend/src/lib/alertEngine.ts).
 *   2. Runs the "controller has not reported" watchdog.
 *   3. Sends push notifications (Firebase Cloud Messaging) to registered browsers
 *      and Android devices when an alert starts.
 *   4. Applies the 90-day retention policy to notifications, logs and history.
 *   5. Writes a heartbeat to /system/worker. While it is fresh, browsers stop
 *      evaluating alerts themselves; if this process stops they take over again.
 *
 * The ESP32 firmware is not involved: the worker only reads what the device
 * already writes to /tanks.
 *
 * When the PORT environment variable is set (Render and similar hosts), it also
 * answers HTTP on that port: GET /health returns 200 while the evaluation loop is
 * alive and 503 if it has stalled, so an uptime pinger can keep it awake and watch it.
 *
 * Run:  npm start          (needs .env, see .env.example)
 *       npm run check      (verifies credentials and database access, then exits)
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import {
  evaluateTank,
  createTankTrackers,
  offlineThresholdMs,
  isControllerOffline,
  alertNotifId,
  ALERT_SERVICE_OFFLINE_ID,
  planRaise,
  planResolve,
  archiveOf,
  type AlertRecord,
  type EngineConfig,
  type EngineTank,
  type RaiseOutcome,
  type RaisePlan,
  type TankTrackers,
} from '../../../frontend/src/lib/alertEngine.ts';

const TICK_MS = 2000;
const HEARTBEAT_MS = 10_000;
const HEALTH_STALE_SEC = 60; // /health reports 503 if no evaluation finished for this long
const RETENTION_DAYS = 90;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CONFIG: EngineConfig = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5 };

// Settings are read from backend/worker/.env regardless of the current directory
const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(WORKER_DIR, '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PUSH_ENABLED = process.env.PUSH_ENABLED !== 'false';
const CHECK_ONLY = process.argv.includes('--check');

function fail(message: string): never {
  console.error(`\n[worker] ${message}\n`);
  process.exit(1);
}

if (!DATABASE_URL) {
  fail(`DATABASE_URL is not set.
  Copy ${resolve(WORKER_DIR, '.env.example')} to ${resolve(WORKER_DIR, '.env')} and fill it in.`);
}

// The key path is resolved against the worker folder, so the worker starts correctly
// from any directory (repo root, pm2, Task Scheduler).
const configuredKey = process.env.GOOGLE_APPLICATION_CREDENTIALS || './serviceAccount.json';
const keyPath = isAbsolute(configuredKey) ? configuredKey : resolve(WORKER_DIR, configuredKey);
if (!existsSync(keyPath)) {
  fail(
    `Service-account key not found.
` +
    `  Expected at: ${keyPath}

` +
    `  How to get it (one time):
` +
    `   1. Open https://console.firebase.google.com/project/msu-water-monitoring-system/settings/serviceaccounts/adminsdk
` +
    `   2. Click "Generate new private key" and confirm.
` +
    `   3. Move the downloaded .json file into the worker folder and rename it to serviceAccount.json
` +
    `      (${resolve(WORKER_DIR, 'serviceAccount.json')})
` +
    `   4. Run the check again:  npm run worker:check

` +
    `  Keep this file private. It is already listed in .gitignore.`
  );
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

admin.initializeApp({ credential: admin.credential.applicationDefault(), databaseURL: DATABASE_URL });
const db = admin.database();
const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args);

// ---------------------------------------------------------------------------
// Live state mirrored from the database
// ---------------------------------------------------------------------------

interface RawTank extends Partial<EngineTank> {
  controllerOffline?: boolean;
}

let tanks: Record<string, RawTank> = {};
let config: EngineConfig & { pushEnabled?: boolean } = { ...DEFAULT_CONFIG };
let alerts: Record<string, AlertRecord> = {};
let serverOffset = 0;
let tanksLoaded = false;

const trackers: Record<string, TankTrackers> = {};
const offlineInFlight = new Set<string>();

const serverNow = () => Date.now() + serverOffset;

function toEngineTank(id: string, raw: RawTank): EngineTank {
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `Tank ${id}`,
    enabled: raw.enabled !== false,
    lastUpdate: typeof raw.lastUpdate === 'number' ? raw.lastUpdate : undefined,
    waterLevel: typeof raw.waterLevel === 'number' ? raw.waterLevel : NaN,
    phLevel: typeof raw.phLevel === 'number' ? raw.phLevel : NaN,
    phSensorOk: raw.phSensorOk !== false,
    levelSensorOk: raw.levelSensorOk !== false,
  };
}

// ---------------------------------------------------------------------------
// Notification writes (same transaction plans as the web app)
// ---------------------------------------------------------------------------

async function raiseAlert(fresh: Pick<AlertRecord, 'id' | 'title' | 'message' | 'type' | 'tankId'>): Promise<RaiseOutcome> {
  const now = serverNow();
  let plan: RaisePlan<AlertRecord> | null = null;
  const result = await db.ref(`notifications/${fresh.id}`).transaction((current: AlertRecord | null) => {
    plan = planRaise<AlertRecord>(current, fresh, now);
    return plan.next; // undefined aborts
  });
  const applied = plan as RaisePlan<AlertRecord> | null;
  if (!result.committed || !applied) return 'skipped';

  if (applied.outcome === 'created' && applied.previous) {
    const archive = archiveOf(fresh.id, applied.previous);
    if (archive) await db.ref(`notifications/${archive.id}`).set(archive.record);
  }
  return applied.outcome;
}

async function resolveAlert(id: string): Promise<AlertRecord | null> {
  const now = serverNow();
  let before: AlertRecord | null = null;
  const result = await db.ref(`notifications/${id}`).transaction((current: AlertRecord | null) => {
    const next = planResolve(current, now);
    before = next ? current : null;
    return next;
  });
  return result.committed ? (before as AlertRecord | null) : null;
}

async function addInfoRow(tankId: string, title: string, message: string): Promise<void> {
  const rowRef = db.ref('notifications').push();
  await rowRef.set({
    id: rowRef.key, tankId, title, message, type: 'info',
    timestamp: serverNow(), read: false, acknowledged: true, resolved: true,
  });
}

async function addLog(action: string, details: string, logLevel: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'): Promise<void> {
  const logRef = db.ref('logs').push();
  await logRef.set({ id: logRef.key, action, details, logLevel, performedBy: 'Alert Service', timestamp: serverNow() });
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

async function sendPush(title: string, body: string, tag: string): Promise<void> {
  if (!PUSH_ENABLED || config.pushEnabled === false) return;

  // token -> uid, so dead tokens can be removed from the right user
  const owners = new Map<string, string>();
  const snap = await db.ref('userState').get();
  snap.forEach((user) => {
    const tokens = user.child('fcmTokens').val();
    if (tokens && typeof tokens === 'object' && user.key) {
      Object.keys(tokens).forEach((token) => owners.set(token, user.key as string));
    }
  });
  const tokens = [...owners.keys()];
  if (tokens.length === 0) return;

  const link = APP_URL ? `${APP_URL}/notifications` : undefined;
  // FCM accepts at most 500 tokens per call
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { tag, link: link ?? '' },
      android: { priority: 'high', notification: { tag } },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { tag, icon: '/msu-logo.png', requireInteraction: true },
        ...(link ? { fcmOptions: { link } } : {}),
      },
    });

    const removals: Record<string, null> = {};
    response.responses.forEach((res, index) => {
      if (!res.success && res.error && DEAD_TOKEN_CODES.has(res.error.code)) {
        const token = batch[index];
        removals[`userState/${owners.get(token)}/fcmTokens/${token}`] = null;
      }
    });
    if (Object.keys(removals).length > 0) await db.ref().update(removals);
    log(`push "${title}": ${response.successCount} delivered, ${response.failureCount} failed`);
  }
}

// ---------------------------------------------------------------------------
// Evaluation loop
// ---------------------------------------------------------------------------

async function syncOffline(id: string, tank: EngineTank, offline: boolean, thresholdSec: number): Promise<void> {
  const result = await db.ref(`tanks/${id}/controllerOffline`).transaction((current: boolean | null) => {
    if (offline) return current === true ? undefined : true;
    return current === true ? false : undefined;
  });
  if (!result.committed) return;

  const alertId = alertNotifId(id, 'offline');
  if (offline) {
    const message = `Controller for ${tank.name} went offline (no update in >${thresholdSec}s).`;
    await addLog('CONTROLLER_OFFLINE', `Controller for ${tank.name} went offline (last update older than ${thresholdSec}s).`, 'WARNING');
    const outcome = await raiseAlert({ id: alertId, tankId: id, title: 'Controller Offline', message, type: 'danger' });
    if (outcome === 'created') await sendPush('Controller Offline', message, alertId);
    log(`tank ${id}: controller offline`);
  } else {
    await addLog('CONTROLLER_RECOVERED', `Controller for ${tank.name} recovered and is back online.`, 'INFO');
    await resolveAlert(alertId);
    await addInfoRow(id, 'Controller Back Online', `Controller for ${tank.name} re-established connection and is reporting live.`);
    log(`tank ${id}: controller back online`);
  }
}

async function evaluateAll(): Promise<void> {
  if (!tanksLoaded || config.maintenanceMode) return;
  const thresholdMs = offlineThresholdMs(config);

  for (const [id, raw] of Object.entries(tanks)) {
    const tank = toEngineTank(id, raw);
    if (tank.enabled === false || !tank.lastUpdate) continue; // disabled or planned

    const offline = isControllerOffline(tank.lastUpdate, serverNow(), thresholdMs);
    if (offline !== (raw.controllerOffline === true) && !offlineInFlight.has(id)) {
      offlineInFlight.add(id);
      syncOffline(id, tank, offline, thresholdMs / 1000)
        .catch((err) => log(`offline sync failed for tank ${id}:`, err))
        .finally(() => offlineInFlight.delete(id));
    }
    if (offline) continue; // last readings are stale: never start alerts from them

    const tankTrackers = (trackers[id] ??= createTankTrackers());
    const events = evaluateTank({ tank, config, trackers: tankTrackers, now: Date.now(), getExisting: (notifId) => alerts[notifId] });

    for (const event of events) {
      try {
        if (event.kind === 'recover') {
          const resolved = await resolveAlert(event.notifId);
          if (resolved) await addInfoRow(event.tankId, event.title, event.message);
          log(`tank ${id}: ${event.key} recovered`);
        } else {
          const outcome = await raiseAlert({ id: event.notifId, tankId: event.tankId, title: event.title, message: event.message, type: event.level });
          // Phones are notified when an alert starts, not on every repeat
          if (outcome === 'created') await sendPush(event.title, event.message, event.notifId);
          if (outcome !== 'skipped') log(`tank ${id}: ${event.key} ${outcome}`);
        }
      } catch (err) {
        log(`failed to apply ${event.kind} for ${event.notifId}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

async function purgePath(path: string): Promise<number> {
  const cutoff = serverNow() - RETENTION_DAYS * DAY_MS;
  const snap = await db.ref(path).orderByChild('timestamp').endAt(cutoff).get();
  if (!snap.exists()) return 0;
  const updates: Record<string, null> = {};
  snap.forEach((child) => {
    if (child.key) updates[child.key] = null;
  });
  const count = Object.keys(updates).length;
  if (count > 0) await db.ref(path).update(updates);
  return count;
}

async function runRetention(): Promise<void> {
  try {
    const paths = ['notifications', 'logs', ...Object.keys(tanks).map((id) => `history/tanks/${id}`)];
    let total = 0;
    for (const path of paths) total += await purgePath(path);
    if (total > 0) {
      await addLog('Data Retention', `Removed ${total} record(s) older than ${RETENTION_DAYS} days.`, 'INFO');
      log(`retention: removed ${total} old record(s)`);
    }
  } catch (err) {
    log('retention failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Fails fast on a bad key or wrong database URL
  const probe = await db.ref('tanks').get();
  const tankCount = probe.exists() ? Object.keys(probe.val()).length : 0;
  log(`connected to ${DATABASE_URL} (${tankCount} tank record(s))`);

  if (CHECK_ONLY) {
    log('check passed: credentials and database access are working.');
    process.exit(0);
  }

  db.ref('.info/serverTimeOffset').on('value', (snap) => {
    if (typeof snap.val() === 'number') serverOffset = snap.val();
  });
  db.ref('tanks').on('value', (snap) => {
    tanks = snap.val() ?? {};
    tanksLoaded = true;
    Object.keys(trackers).forEach((id) => { if (!tanks[id]) delete trackers[id]; });
  });
  db.ref('config').on('value', (snap) => {
    config = { ...DEFAULT_CONFIG, ...(snap.val() ?? {}) };
  });
  // Live alert records all share the "alert-" key prefix
  db.ref('notifications').orderByKey().startAt('alert-').endAt('alert-').on('value', (snap) => {
    alerts = snap.val() ?? {};
  });

  // Heartbeat. onDisconnect clears it the moment this process loses its connection,
  // so open dashboards take over alert evaluation without waiting for it to go stale.
  const heartbeatRef = db.ref('system/worker');
  const startedAt = Date.now();
  const beat = () => heartbeatRef.update({ lastSeen: admin.database.ServerValue.TIMESTAMP, startedAt }).catch((err) => log('heartbeat failed:', err));
  db.ref('.info/connected').on('value', (snap) => {
    if (snap.val() === true) {
      heartbeatRef.onDisconnect().remove().then(beat).catch((err) => log('onDisconnect failed:', err));
    }
  });
  // Back up: close the "Alert Service Offline" notice the dashboards raised while it was down
  resolveAlert(ALERT_SERVICE_OFFLINE_ID)
    .then((closed) => { if (closed) log('closed the Alert Service Offline notice'); })
    .catch((err) => log('could not close the Alert Service Offline notice:', err));
  setInterval(beat, HEARTBEAT_MS);

  let running = false;
  let lastLoopAt = Date.now();
  setInterval(() => {
    if (running) return; // never overlap evaluations
    running = true;
    evaluateAll()
      .catch((err) => log('evaluation failed:', err))
      .finally(() => { running = false; lastLoopAt = Date.now(); });
  }, TICK_MS);

  // Health endpoint, only when a host gives us a port (Render web service).
  // Locally PORT is unset and nothing listens.
  const port = Number(process.env.PORT);
  if (port > 0) {
    createServer((req, res) => {
      const ageSec = Math.round((Date.now() - lastLoopAt) / 1000);
      const healthy = ageSec < HEALTH_STALE_SEC;
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: healthy ? 'ok' : 'stalled', lastLoopSecAgo: ageSec, push: PUSH_ENABLED }));
    }).listen(port, () => log(`health endpoint listening on port ${port} (GET /health)`));
  }

  setTimeout(runRetention, 60_000);
  setInterval(runRetention, RETENTION_INTERVAL_MS);

  const shutdown = async () => {
    log('stopping');
    try { await heartbeatRef.remove(); } catch { /* already disconnected */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`alert worker running (push ${PUSH_ENABLED ? 'on' : 'off'})`);
}

main().catch((err) => fail(`Startup failed: ${err?.message ?? err}`));
