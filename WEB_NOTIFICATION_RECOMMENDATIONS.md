# Web Notification Recommendations and System Review: Status

MSU Water Monitoring System. Original review: 2026-11-10. Updated 2026-11-13: open items first,
finished items at the end under **Done (implemented)**.

Everything else from the original review has been implemented (listed in **Done** at the end): role-based database rules and
validation, no stored passwords, de-duplicated alerts that keep their acknowledgment, the
server-side alert worker, controller-offline and sensor-fault alerts, alert levels matching the
firmware, notification history with per-user read state, maintenance mode, sound controls,
notification settings, browser and Android push, data sanitizing, limited queries with indexes,
90-day retention, shared listeners, the server clock, App Check support, and the code cleanups.

---

## Still open

| ID | Severity | Item | Notes |
|---|---|---|---|
| S5 | Medium | Deleting a user removes the Firestore profile and the role, but not the Firebase Auth account. | Contained: without a role the account has no database access. Full fix: delete the Auth user from the worker with the Admin SDK, or deactivate instead of delete. |
| S6 | Medium | Any signed-in role, including viewer, can write an acknowledgment directly to the database. The UI hides the button. | Partly fixed: `acknowledgedByUid` must equal the writer's own UID, so a name cannot be faked. Remaining fix: restrict notification writes to admin and worker in `database.rules.json`. |
| S7 | Low | Any signed-in user can read every user profile (including email addresses) in Firestore. | Allow users to read their own profile and admins to read all; the dashboard only needs names. |
| E4 | Medium | Some writes still don't report failure: the dashboard's pump toggle calls `updateTank` without `await`/`catch`, so a failed write shows no error. | Partly fixed: acknowledgment + log is now one multi-path `update()`. Remaining fix: `await` the pump toggle and show an error toast on failure. |
| Q7 | Low | `any` types remain, mainly in `pages/admin/Configuration.tsx` (form state). | Partly fixed (Dashboard has none). Type the form state as strings and parse on save. See `docs/Code_Cleanup.md`. |
| Q1 | Low | `frontend/src/pages/Reports.tsx` is still large (about 1,200 lines). | Extract the chart and summary calculations into hooks or helpers. Cleanup only. |
| R10 | Future | Telegram alerts sent by the worker. | Not built. |
| R11 | Future | Email summaries and SMS for critical alerts. | Not built. Listed in the paper's recommendations (GSM/SMS). |

## Firmware (outside the web app)

- `backend/firmware/esp32_firmware.ino` contains a fallback Wi-Fi network name and password, and
  the file is in git. If the repository is public, treat that password as exposed and change it.
- The ESP32 uses `setInsecure()` for HTTPS, so it does not verify Firebase's certificate. The
  traffic is still encrypted.

---

## Done (implemented)

These are the original review items that are finished. Text is as written in the original review on 2026-11-10; each was checked against the code on 2026-11-13.

### Recommendations R1–R9

#### ✅ Done: R1 — One server-side alert evaluator (Must-have, Medium)

**What and why.** Today each open browser runs its own alert state machine. That causes three problems: no alerts when no browser is open, duplicates and overwrites when several are open (see issues B1–B3), and no possible push/Telegram/email because nothing runs when the tab is closed. Move the logic of `SystemMonitor.tsx` into a single process that watches `/tanks` and writes `/notifications`. The browser then only displays.

**Two ways to host it:**

| Option | Pros | Cons |
|---|---|---|
| **Cloud Functions for Firebase** (Realtime Database trigger + scheduled function) | Lives inside the existing Firebase project; no machine to keep on | Requires the Blaze (pay-as-you-go) plan and a billing card. Usage at this scale should sit inside the free quota, but confirm current pricing before committing. |
| **Small Node.js worker** using `firebase-admin`, run on any always-on machine (lab PC, Raspberry Pi, free-tier host) | Works on the free Spark plan; easy to demo and explain | You must keep it running; the service-account key must never be committed |

For a capstone, the Node worker is the lower-risk choice. The evaluator code is the same either way.

**Simplification available because the firmware is fixed:** the ESP32 already publishes debounced alert states (`lowLevelAlert`, `highLevelAlert`, `phAlert`, `phSensorOk`, `levelSensorOk`). The evaluator can simply react to changes in those fields instead of re-implementing thresholds, which also removes the severity mismatch in issue B6.

**Files.** New `backend/worker/` (or `backend/cloud/functions/`); `frontend/src/components/SystemMonitor.tsx` shrinks to toast + sound only; `backend/cloud/database.rules.json` (only the server may create notifications); `.gitignore` (service-account key).

```js
// backend/worker/index.js (sketch)
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.applicationDefault(), databaseURL: process.env.DB_URL });
const db = admin.database();
const last = {};                       // tankId -> previous alert states

db.ref('tanks').on('child_changed', async (snap) => {
  const t = snap.val(), id = snap.key, prev = last[id] ?? {};
  for (const key of ['lowLevelAlert', 'highLevelAlert', 'phAlert']) {
    if (t[key] === prev[key]) continue;                       // only act on transitions
    if (t[key] === 'WARNING' || t[key] === 'CRITICAL') await raise(id, key, t);
    if (t[key] === 'RECOVERED' || t[key] === 'NORMAL')        await resolve(id, key, t);
  }
  last[id] = { lowLevelAlert: t.lowLevelAlert, highLevelAlert: t.highLevelAlert, phAlert: t.phAlert };
});
```

#### ✅ Done: R2 — Real-time delivery: keep Firebase listeners (Must-have, Easy)

**What and why.** The question "WebSocket, SSE, or polling?" is already answered by the stack: the Firebase Realtime Database SDK keeps a WebSocket open and pushes changes, with automatic reconnect and offline queueing. Adding Socket.IO or SSE would require building and hosting a server that duplicates this. Polling would be slower and cost more reads. **Recommendation: keep `onValue`, but narrow it.**

Improvements to the existing listeners:
- Limit `/notifications` and `/logs` to the most recent N entries (see issue P1).
- Use `onChildAdded` on `/notifications` to detect "this is new" and fire the toast, instead of the current approach where only the detecting browser shows a toast.
- Subscribe to `.info/connected` and show a "You are offline — data may be stale" banner. Today, if the browser loses its connection the dashboard silently shows old values.

**Files.** `frontend/src/store/useStore.ts` (`useNotifications`, `useLogs`, new `useConnectionState`), `frontend/src/components/AppLayout.tsx` (banner).

```ts
// useStore.ts
const q = query(ref(database, 'notifications'), orderByChild('timestamp'), limitToLast(100));
onValue(q, ...);

export function useConnectionState() {
  const [online, setOnline] = useState(true);
  useEffect(() => onValue(ref(database, '.info/connected'), s => setOnline(s.val() === true)), []);
  return online;
}
```

#### ✅ Done: R3 — Device-offline alerts (Must-have, Easy–Medium)

**What and why.** "ESP32 hasn't reported in X seconds" is the most valuable alert in a monitoring system, because a silent controller looks the same as a healthy one. The heartbeat is every 10 s, so the current 30 s threshold (three missed heartbeats) is reasonable. What is missing is turning the event into a real notification with sound, and detecting it when the Dashboard is not open.

- **Short term (no server):** move the offline check from `Dashboard.tsx:337–354` into `SystemMonitor.tsx` so it runs on every page, and in `syncTankOfflineState` (`useStore.ts:324–374`) also write a `danger` notification when the transaction commits, plus an `info` "back online" notification on recovery. The existing transaction already prevents duplicates between browsers.
- **With R1:** the worker runs a 15 s timer and compares `Date.now()` with each tank's `lastUpdate`. This is the only version that works with every browser closed.
- Add a second stage for long outages, e.g. re-notify at 10 minutes and 1 hour, rather than every 60 s.
- Make the threshold configurable (`config/offlineThresholdSec`), clamped to a minimum of 20 s so it can never be lower than two heartbeats.

**Files.** `frontend/src/components/SystemMonitor.tsx`, `frontend/src/store/useStore.ts`, `frontend/src/pages/Dashboard.tsx` (remove the duplicate effect), later `backend/worker/`.

```js
// worker: offline watchdog
setInterval(async () => {
  const tanks = (await db.ref('tanks').get()).val() ?? {};
  for (const [id, t] of Object.entries(tanks)) {
    if (!t.lastUpdate || t.enabled === false) continue;        // planned or disabled
    const offline = Date.now() - t.lastUpdate > 30_000;
    if (offline !== !!t.controllerOffline) {
      await db.ref(`tanks/${id}/controllerOffline`).set(offline);
      offline ? await raise(id, 'offline', t) : await resolve(id, 'offline', t);
    }
  }
}, 15_000);
```

#### ✅ Done: R4 — Alert levels and a de-duplication model (Must-have, Medium)

**What and why.** The types `info | warning | danger` exist, but the web and the firmware disagree on which condition is which (issue B6), and one record is used for both "current state" and "history", which is the root of the overwrite bugs. Split them:

- `/alerts/{tankId}_{key}` — **current state**, one record per tank and condition. Fields: `level`, `state` (`active | acknowledged | resolved`), `since`, `lastValue`, `acknowledgedBy`, `acknowledgedAt`. The fixed key is the de-duplication key: an alert that is already `active` or `acknowledged` is never raised again.
- `/notifications/{pushId}` — **history**, append-only events: raised, escalated, acknowledged, resolved. Created with `push()` and a server timestamp.

Suggested level mapping, to be agreed with the adviser and then used everywhere:

| Level | Conditions |
|---|---|
| critical (`danger`) | pH out of range, overflow, controller offline, sensor fault |
| warning | low water, weak signal for a sustained period |
| info | recovered, back online, acknowledged, configuration changed |

Anti-spam rules: raise only on a state transition; the acknowledged state silences repeats until the condition resolves; unacknowledged criticals escalate on a widening schedule (1 min, 5 min, 15 min) instead of a flat 60 s; and maintenance mode suppresses new alerts, as the UI already promises.

**Files.** `frontend/src/store/useStore.ts` (types, hooks), `frontend/src/components/SystemMonitor.tsx`, `frontend/src/components/NotificationCenter.tsx`, `backend/cloud/database.rules.json`, worker.

```ts
// raise(): transaction on the alert state makes it idempotent across browsers and restarts
const res = await runTransaction(ref(database, `alerts/${tankId}_${key}`), cur =>
  cur && cur.state !== 'resolved' ? undefined            // already active: abort, no duplicate
      : { level, state: 'active', since: serverTimestamp(), lastValue });
if (res.committed) push(ref(database, 'notifications'), { tankId, key, level, event: 'raised', title, message, timestamp: serverTimestamp() });
```

#### ✅ Done: R5 — Notification history page with per-user read state (Must-have, Medium)

**What and why.** The popover is the only view, it is not filterable, and **Clear all** deletes the record for everyone. For a monitoring system the alert history is evidence, and panels usually ask "when did this happen and who responded?". Also, `read` is currently one shared flag, so one operator opening a notification marks it read for every user.

- Add a `/notifications` page (route in `App.tsx`, link in `AppLayout.tsx`) with filters for level, tank, date range, and acknowledged/unacknowledged, plus pagination. The `Logs.tsx` layout can be reused.
- Per-user read state: store one number, `userState/{uid}/notificationsLastReadAt`. A notification is unread when `timestamp > lastReadAt`. "Mark all as read" becomes a single write. This is far simpler than a read flag per user per notification.
- Replace **Clear all** with retention: keep 90 days (the same policy `Reports.tsx` uses for history), and restrict deletion to admins.
- Show full date, not only the time. `NotificationCenter.tsx:33–36` formats time only, so yesterday's alert looks like today's.

**Files.** New `frontend/src/pages/Notifications.tsx`; `frontend/src/App.tsx`; `frontend/src/components/AppLayout.tsx`; `frontend/src/components/NotificationCenter.tsx`; `frontend/src/store/useStore.ts`; `backend/cloud/database.rules.json`.

```json
"userState": { "$uid": { ".read": "auth.uid === $uid", ".write": "auth.uid === $uid" } }
```

#### ✅ Done: R6 — Sensor-fault and bad-data notifications (Must-have, Easy)

**What and why.** The ESP32 already reports `phSensorOk` and `levelSensorOk`, and the dashboard shows a small "FAULT" tag, but no notification is raised. Worse, `SystemMonitor.tsx:154–190` keeps evaluating the level and pH values while a sensor is faulty, so a broken sensor can produce a false "Low Water Level" alert. Raise a `danger` "Sensor Fault" notification when either flag turns `false`, and skip threshold checks for that sensor while it is faulty. Also ignore values that are not finite numbers or are outside physical range (level 0–100, pH 0–14); the firmware uses `-999` as an internal "no reading yet" value (lines 226–228).

**Files.** `frontend/src/components/SystemMonitor.tsx` (or the worker), `frontend/src/store/useStore.ts` (a `sanitizeTank()` helper used by `useTanks`).

```ts
const validLevel = tank.levelSensorOk !== false && Number.isFinite(tank.waterLevel) && tank.waterLevel >= 0 && tank.waterLevel <= 100;
const validPh    = tank.phSensorOk    !== false && Number.isFinite(tank.phLevel)    && tank.phLevel >= 0    && tank.phLevel <= 14;
if (validLevel) { /* low + overflow checks */ }
if (validPh)    { /* pH check */ }
```

#### ✅ Done: R7 — Sound and visual alert controls (Nice-to-have, Easy)

**What and why.**
- **Autoplay.** Browsers block audio until the user interacts with the page. `alertSound.ts:26–36` handles this by silently doing nothing, so after a page reload a critical alert can be completely silent with no indication. Show an "Enable alert sound" prompt until the audio context is running.
- **Mute/snooze.** Viewers cannot acknowledge (`NotificationCenter.tsx:20–22`) but still hear the chime every 4 s with no way to stop it. Add a per-device mute and a 15-minute snooze, stored in `localStorage`.
- **Different sounds per level**, and play the continuous chime only for critical; warnings get a single chime.
- **Visual cues that work in a background tab:** flash the page title (`(2) ALERT — MSU Water`), swap the favicon for a red one, and use the Web Notifications API (`new Notification(...)`) while the tab is open but hidden. This needs only a permission prompt, no service worker and no server, and it is a cheap first step toward R9.

**Files.** `frontend/src/utils/alertSound.ts`, `frontend/src/components/SystemMonitor.tsx`, `frontend/src/components/NotificationCenter.tsx`, `frontend/public/` (alert favicon).

```ts
if (document.hidden && Notification.permission === 'granted') {
  new Notification(title, { body: message, tag: notifId, requireInteraction: level === 'danger' });
}
// `tag` makes the browser replace, not stack, repeats of the same alert
```

#### ✅ Done: R8 — Threshold and notification settings from the web (Nice-to-have, Easy–Medium)

**What and why.** The four thresholds are already editable in Admin Panel → Configuration and the ESP32 already reads them, so this works. Improvements, all web-side:
- Validate before saving (issue E2): ranges, `low < overflow`, `minPh < maxPh`.
- Add notification settings under `/config/notifications`: offline threshold, repeat/escalation interval, quiet hours for non-critical levels, which levels play sound, and channel toggles for R9–R11. These are new keys the firmware does not read, so they cannot affect the ESP32.
- Keep per-user preferences (mute, push on/off) under `userState/{uid}`.
- Log every threshold change with old and new values; the current save does not write a log entry.

Constraint: the hysteresis margins (2 % and 0.15 pH) and the level/overflow comparison are hard-coded in the firmware, so the web should display them as fixed, not offer to edit them.

**Files.** `frontend/src/pages/AdminPanel.tsx` (`Configuration`), `frontend/src/store/useStore.ts` (`SystemConfig`), `backend/cloud/database.rules.json` (`.validate`).

#### ✅ Done: R9 — Browser push with FCM and a service worker (Nice-to-have, Hard)

**What and why.** Push is the only way to reach an operator whose browser tab is closed. It needs three parts: a service worker (`firebase-messaging-sw.js`), a permission prompt that stores each device's FCM token under `userState/{uid}/fcmTokens`, and a **server-side sender**, which is why R1 is a prerequisite. The browser cannot send pushes to other users by itself.

Things to know before committing time to it:
- Requires HTTPS (Firebase Hosting provides it) and a VAPID key from the Firebase console.
- On iPhone/iPad, web push works only after the user adds the site to the Home Screen, which requires a web app manifest. The project has no manifest today.
- **The Android app will not receive web push.** `mobile/capacitor.config.ts` loads the hosted site inside a WebView, and Android WebView does not support the Push API. The Android app would need the `@capacitor/push-notifications` plugin (native FCM) instead. This is a separate piece of work.
- Token cleanup is needed: remove tokens that FCM reports as unregistered.

**Files.** New `frontend/public/firebase-messaging-sw.js`, new `frontend/public/manifest.webmanifest`, `frontend/index.html`, `frontend/src/config/firebase.ts`, new `frontend/src/utils/push.ts`, worker (sender), rules.

```ts
// frontend/src/utils/push.ts
const token = await getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FCM_VAPID_KEY });
await set(ref(database, `userState/${uid}/fcmTokens/${token}`), true);

// worker, inside raise():
await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body: message },
  webpush: { fcmOptions: { link: 'https://<your-site>/dashboard' } } });
```

### 3.1 Security

| Status | ID | Severity | File:line (at review time) | Problem | Fix applied as suggested |
|---|---|---|---|---|---|
| ✅ Done | S1 | **Critical** | `backend/cloud/database.rules.json:5–22` | Every path is `auth != null` for read and write. Roles are enforced only in React (`ProtectedRoute.tsx`, button visibility). A `viewer` account can, with the browser console or a REST call, change thresholds, switch `tanks/1/pumpOn`, delete all logs and notifications, or alter history. Role checks in the UI are not security. | Enforce roles in the rules. Realtime Database rules cannot read Firestore, so mirror the role to `/roles/{uid}` in the Realtime Database (writable by admins only) or use custom claims set from a server. Example below. |
| ✅ Done | S2 | **Critical** (verify in console) | Firebase Auth settings + S1 | The web API key is public by design, and Firebase's sign-up endpoint is open by default. If "Enable create (sign-up)" is still on in Authentication → Settings → User actions, anyone on the internet can create an account and immediately gets full read/write on the database because of S1. The app signs out users without a profile (`AuthContext.tsx:59–63`), but that is client-side only. | Turn off user sign-up in the console if possible (admin-created accounts via `registerOperator` use the same endpoint, so test this; otherwise fixing S1 is the real protection). Fix S1 so an account with no role has no access. |
| ✅ Done | S3 | **High** | `frontend/src/pages/LoginPage.tsx:89` (read back at `:29`) | "Remember me" stores the password in plain text in `localStorage`. Any script on the page, browser extension, or person at the computer can read it. | Remove the password storage. Remember only the email. Firebase Auth already keeps the session; use `setPersistence(browserLocalPersistence / browserSessionPersistence)` for the "remember me" choice. Also add a one-time `localStorage.removeItem('wm_remembered_password')` to clean existing browsers. |
| ✅ Done | S4 | **High** | `backend/cloud/database.rules.json` (whole file) | No `.validate` rules. Any authenticated client, including a malfunctioning ESP32, can write any shape or type: strings for numbers, a 500 % water level, huge blobs. | Add `.validate` for telemetry and config. Example below. Do not validate so strictly that the existing firmware payload is rejected: the device writes with PATCH and its payload is listed in Part 1. |
| ✅ Done | S8 | **Low** | `frontend/src/config/firebase.ts:7–15` | The Firebase config is hard-coded. This is **not** a leaked secret: Firebase web API keys are meant to be public, and security comes from rules (S1). It is still good practice to restrict the key. | In Google Cloud Console, restrict the key to the site's HTTP referrers and to the Firebase APIs it needs. Consider Firebase App Check for the web app. Moving the values to `VITE_` env variables is tidy but does not hide them. |
| ✅ Done | S9 | **Low** | `mobile/capacitor.config.ts:9` | `cleartext: true` allows unencrypted HTTP although the configured URL is HTTPS. | Set to `false`. |

### 3.2 Bugs and logic errors

| Status | ID | Severity | File:line (at review time) | Problem | Fix applied as suggested |
|---|---|---|---|---|---|
| ✅ Done | B1 | **High** | `frontend/src/components/SystemMonitor.tsx:60–192` | Alerts are evaluated only inside an open browser tab. With no dashboard open there are no notifications at all; with five open there are five independent state machines. | R1 (server-side evaluator). Short term: accept the limitation and state it in the manuscript. |
| ✅ Done | B2 | **High** | `SystemMonitor.tsx:93–105` with `useStore.ts:508–517` | A browser that has just loaded starts every tracker at `NORMAL`. If a condition is already active, 5 s later it calls `addNotification` with the fixed ID, and `set()` overwrites the record with `acknowledged: false, read: false`. Result: any page reload or new login **un-acknowledges an alert an operator already acknowledged**, and the alarm sound restarts on every dashboard. The acknowledged check exists only in the `WARNING/CRITICAL` branch (`:129`), not in `NORMAL`. | Before raising, check whether an unresolved notification with that ID already exists and adopt its state instead of overwriting. Best: the transaction pattern in R4. |
| ✅ Done | B3 | **Medium** | `SystemMonitor.tsx:124`, `useStore.ts:509` | Recovery notifications get the ID `Date.now()`, so each open browser writes its own "Recovered" entry: N browsers, N duplicates. The original alert record is also never marked resolved; it stays unacknowledged and keeps the sound going until someone acknowledges an alert that is already over. | Mark the alert `resolved` (stop sound) and write one recovery event guarded by the same transaction. |
| ✅ Done | B4 | **Medium** | `SystemMonitor.tsx` (no `maintenanceMode` check); promised at `Dashboard.tsx:410` and `AdminPanel.tsx:1077` | The UI states that maintenance mode suppresses alerts system-wide. The web alert code never reads `config.maintenanceMode`, so alerts, toasts, and sound continue. | Return early from evaluation when `config.maintenanceMode` is true; show a muted indicator on the bell. |
| ✅ Done | B5 | **High** | `Dashboard.tsx:337–354`, `useStore.ts:352–367` | Offline detection runs only while the Dashboard page is mounted, and it writes only a log entry. No notification, toast, or sound is produced when the controller goes offline. | R3. |
| ✅ Done | B6 | **Medium** | `SystemMonitor.tsx:154–190` vs firmware `1978–1984`, `1603–1614` | The web and the firmware classify the same conditions differently. Firmware: low water → `CRITICAL`/`danger`, overflow → `WARNING`. Web notifications: low water → `warning`, overflow → `danger`. Boundaries differ too (`<=` / `>=` on the web, `<` / `>` on the device). The tank card badge follows the firmware while the notification follows the web, so one event can show "Danger" on the card and a yellow warning in the bell, or the reverse. | Since the firmware is fixed, make the web follow it: derive notification level from `lowLevelAlert` / `highLevelAlert` / `phAlert` (see R1), and document the mapping. |
| ✅ Done | B7 | **Medium** | `SystemMonitor.tsx:154–190` | Sensor health flags are ignored. A faulty level sensor can raise a false low-water alert, and no "sensor fault" notification exists. | R6. |
| ✅ Done | B8 | **Medium** | `frontend/src/pages/AdminPanel.tsx:758–762` | `tank1` is a new object every time the ESP32 reports (at least every 10 s), so this effect resets `localTank1` and **discards calibration values the admin is still typing**. | Initialise the local form once (or only when not dirty), not on every telemetry update. |
| ✅ Done | B9 | **Medium** | `AdminPanel.tsx:797–807` | Saving calibration spreads the entire cached tank object (`...localTank1`) into `update()`. That writes back stale `waterLevel`, `phLevel`, `status`, `lastUpdate`, and `pumpOn` along with the calibration. It can briefly overwrite live telemetry, push `lastUpdate` backwards, and re-send an old pump command. | Send only the seven calibration fields. |
| ✅ Done | B10 | **Medium** | `useStore.ts:576`, `:532`, `:509` | IDs come from `Date.now()`. Two writes in the same millisecond, from two users or from one burst, overwrite each other. | Use `push()` keys. |
| ✅ Done | B11 | **Medium** | `useStore.ts:561` and `frontend/src/pages/Logs.tsx:304` | ESP32 log entries carry `id: "esp32-<millis>"`, which restarts from zero on every reboot, so IDs repeat. `Logs.tsx` uses `log.id` as the React key; duplicate keys cause rows to be dropped or duplicated, especially with `AnimatePresence`. | Use the database key as the ID: `Object.entries(data).map(([key, v]) => ({ ...v, id: key }))`. |
| ✅ Done | B12 | **Medium** | `useStore.ts:396`, `:465`, defaults at `:128–157` | If `/tanks` or `/config` is empty, any client writes defaults. The default Tank 1 has `waterLevel: 75`, `pumpOn: true`, and `lastUpdate: Date.now()`, so after a database reset the dashboard shows a healthy, live, 75 % tank that no device reported. | Do not seed fake telemetry. Seed only name and calibration, without `lastUpdate`, and restrict seeding to admins (or do it once by hand). |
| ✅ Done | B13 | **Medium** | `useStore.ts:520–522`, `NotificationCenter.tsx:91` | `read` is a single shared flag: one user reading a notification marks it read for everyone. | R5 (per-user `lastReadAt`). |
| ✅ Done | B14 | **Medium** | `NotificationCenter.tsx:70`, `useStore.ts:544–546` | **Clear all** deletes every notification for every user, including active unacknowledged alerts, with no confirmation, and workers can do it. | Confirmation dialog, admin only, and prefer retention over deletion (R5). |
| ✅ Done | B15 | **Low** | `useStore.ts:377`, `:453` | Tanks and config are first rendered from `localStorage`. Until Firebase responds, the dashboard shows the last cached reading as if current. | Show a loading or "cached" state until the first snapshot arrives. |
| ✅ Done | B16 | **Low** | `Dashboard.tsx:315–325`, `:461` | The connection banner reflects only the first non-planned tank, and "Device ID: ESP32-WROOM-32" is hard-coded. Fine for one device, wrong when a second tank goes live. | Per-tank status, or label the banner with the tank name. |
| ✅ Done | B17 | **Low** | `AppLayout.tsx:101`, `useStore.ts:593–604` | The header says "System Server Clock" but shows the browser clock. | Add the existing `serverTimeOffset`, or rename the label. |
| ✅ Done | B18 | **Low** | `useStore.ts:512`, `:525`, `:581` | Timestamps use the browser clock, so a PC with a wrong clock produces misordered notifications and logs. The ESP32 correctly uses server timestamps. | Use `serverTimestamp()`. |
| ✅ Done | B19 | **Low** | `Dashboard.tsx:374–378` (passed at `:478`, declared at `:49`, `:66`) | `getStatus` is passed to every `TankCard` and never used, and contains a hard-coded `80`. | Delete it. |

### 3.3 Performance

| Status | ID | Severity | File:line (at review time) | Problem | Fix applied as suggested |
|---|---|---|---|---|---|
| ✅ Done | P1 | **Medium** | `useStore.ts:487`, `:555` | `/notifications` and `/logs` are downloaded in full, and re-sorted in full on every change. Logs have no retention; the ESP32 and the web both append forever. Download size and bandwidth cost grow without bound. | `query(ref, orderByChild('timestamp'), limitToLast(200))`, pagination for older entries, and `".indexOn": ["timestamp"]` for both paths in `database.rules.json` (currently only `/history` is indexed). Add 90-day retention for logs. |
| ✅ Done | P2 | **Low** | `useStore.ts:376`, `:483`, `:551` | Every component that calls `useTanks` / `useNotifications` / `useLogs` creates its own listener and its own copy of the state (for example `SystemMonitor`, `NotificationCenter`, and the page each hold one). The SDK shares the connection, but parsing, sorting and `localStorage` writes are repeated per instance. | Put each subscription in one React context provider and read from it. |
| ✅ Done | P3 | **Low** | `useStore.ts:394` | The whole tank list is written to `localStorage` on every telemetry update (about once per second while values change), once per hook instance. | Throttle, or drop the cache (see B15). |
| ✅ Done | P4 | **Low** | `Dashboard.tsx:304–311`, `AppLayout.tsx:10` | Two one-second timers re-render the layout and dashboard every second. `TankCard` is memoised, so the cost is small. | Isolate the clock in its own small component. |
| ✅ Done | P5 | **Low** | `frontend/src/pages/Reports.tsx:229–272` | History cleanup runs in the browser, only when an admin opens Reports, and "already done this month" is remembered per browser in `localStorage`. If no admin opens Reports, nothing is ever deleted. | Move retention to the worker (R1). |

### 3.4 Error handling gaps

| Status | ID | Severity | File:line (at review time) | Problem | Fix applied as suggested |
|---|---|---|---|---|---|
| ✅ Done | E1 | **High** | `useStore.ts:388–392`, `SystemMonitor.tsx:154–190` | Data from the device is trusted as-is. `useTanks` spreads the raw value and casts it to `Tank`. A missing `waterLevel` becomes `undefined` (comparisons are false, so no alert, silently); `null` compares as `0` and raises a low-water alert; an out-of-range value raises a false alert. The display path is guarded (`useUIStabilization.ts:104–106`) but the alert path is not. | One `sanitizeTank()` in `useTanks` that checks type and range and marks a field invalid; R6 for how alerts treat invalid fields; S4 to reject bad writes at the database. |
| ✅ Done | E2 | **Medium** | `AdminPanel.tsx:786–794`, inputs at `:837–873` | Thresholds are saved with `Number(...)` and no validation. An empty field saves `0`. Nothing prevents `low >= overflow` or `minPh >= maxPh`, which would put the web and the ESP32 into permanent alert. The firmware accepts any number it reads. | Validate with `zod` (already a dependency): finite, in range, ordered. Disable Save until valid. Back it with S4. |
| ✅ Done | E3 | **Medium** | `useStore.ts:399–401`, `:468`, `:501`, `:568` | Listener errors, including permission errors, go only to `console.error`. The user sees an empty or stale screen with no explanation. | Expose an `error` state and show a banner; add the `.info/connected` banner from R2. |
| ✅ Done | E5 | **Low** | `frontend/src/utils/alertSound.ts:26–36`, `:55–57` | Sound failure is silent (see R7). | Surface an "enable sound" prompt. |
| ✅ Done | E6 | **Low** | `frontend/src/config/firebase.ts:21` | `getAnalytics` is called without `isSupported()`; it can throw in environments without cookies or IndexedDB, at import time. | `isSupported().then(ok => ok && getAnalytics(app))`, or remove Analytics if unused. |
| ✅ Done | E7 | **Low** | `Dashboard.tsx:289–296` | The Firestore `users` listener has no error callback. | Add one. |

### 3.5 Code quality and maintainability

| Status | ID | Severity | File:line (at review time) | Problem | Fix applied as suggested |
|---|---|---|---|---|---|
| ✅ Done | Q2 | **Low** | `frontend/src/config/firebase.ts:23–35`; `authService.ts:115–134` | Unused example functions. `listenToTank` never unsubscribes; `updateTankData` uses `set()`, which would wipe a tank's calibration if anyone called it. `seedInitialAdmin` is unused and would fail under the current Firestore rules. | Delete. |
| ✅ Done | Q3 | **Low** | `frontend/src/App.tsx:21–22` | Two toast systems are mounted (shadcn `Toaster` and `sonner`); only `sonner` is used by the pages reviewed. | Keep one. |
| ✅ Done | Q4 | **Low** | `App.tsx:4`, `:15`, `:18` | `@tanstack/react-query` is set up but no query uses it. | Remove, or use it. |
| ✅ Done | Q5 | **Low** | `App.tsx:25` | After login the app does `window.location.href = '/dashboard'`, a full page reload, although `LoginPage.tsx:38–42` already navigates. | Remove the reload. |
| ✅ Done | Q6 | **Low** | `LoginPage.tsx:66–69`, `AuthContext.tsx:156–158`, `AdminPanel.tsx:115–118` | A username without `@` silently gets `@gmail.com` appended, in three separate places. A password-reset for a mistyped username goes to a stranger's Gmail address. | Require a full email, or put the rule in one shared function with a project-specific domain. |
| ✅ Done | Q8 | **Low** | `useStore.ts:31–38` vs `authService.ts:15–23` | Two user types (`User` with an optional `password`, and `UserProfile`). | Keep `UserProfile` only. |
| ✅ Done | Q9 | **Low** | `SystemMonitor.tsx:7–9`, `useStore.ts:285`, `Dashboard.tsx:325` | Timing constants are scattered, and the 30 s offline threshold is written twice. | One `constants.ts`. |
| ✅ Done | Q10 | **Low** | `frontend/src/test/` | Tests exist for acknowledgement and offline logic (not run in this review). The alert state machine in `SystemMonitor.tsx`, where B2 and B3 live, is inside a React effect and hard to test. | Extract it into a pure function `(state, reading, now) => (state, events)` and unit-test it. The same function can then be shared with the worker in R1. |

### Firmware observations

- ✅ Done: ESP32 log IDs (`esp32-<millis>`) repeat after a reboot. Handled on the web by B11 (database keys are used as IDs).
- ✅ Done: thresholds read from `/config` had no range checks. Handled on the web by E2 (form validation) and S4 (database `.validate` rules).

### Action plan status

| Phase | Items | Status |
|---|---|---|
| Phase 1: fix first | S3, S1/S2/S4, B2, B3, B8, B9, E1, E2, B7/R6, B4, B11, B10 | ✅ Done |
| Phase 2: add next | R3, R4 (B6), R5 (B13, B14), R2/P1/E3, R7, R8 | ✅ Done |
| Phase 3: if time allows | R1 (B1, B5, P5), R9 | ✅ Done |
| Phase 3: if time allows | R10 Telegram | Open |
| Optional / future | Native Android push, App Check and API-key guidance (S8) | ✅ Done |
| Optional / future | R11 email/SMS | Open |
| Optional / future | Cleanup Q1–Q10, P2–P4, low-severity bugs | ✅ Done, except Q1 and Q7 (partly) |
