# Web Notification Recommendations and System Review

MSU Water Monitoring System — review date: 2026-11-10

**Scope and method.** This is a read-only review. No source code, firmware, or existing documentation was changed. The ESP32 firmware was read only to learn what it sends; its behavior is treated as fixed. Findings come from reading the code. Nothing was executed: the app was not run, the test suite was not run, and the Firebase console settings were not inspected, so items that depend on console settings are marked "verify in console".

**The most important finding.** There is no server. The "backend" is Firebase (Realtime Database, Firestore, Auth, Hosting), and every alert is computed inside the browser by `SystemMonitor.tsx`. If nobody has the dashboard open, no notification is created, no sound plays, and nobody is told. Most of the recommendations below follow from that.

---

## Part 1 — How the current system works

### 1.1 Data flow: ESP32 → Firebase → web app

```
ESP32 (Tank 1)                    Firebase                         Web app (React + Vite)
───────────────                   ─────────                        ──────────────────────
signs in with email/password ──►  Firebase Auth (ID token)
PATCH /tanks/1.json          ──►  Realtime Database /tanks/1  ──►  useTanks()  onValue listener
POST  /history/tanks/1.json  ──►  /history/tanks/1            ──►  Reports.tsx query (7/14/30 days)
POST  /logs.json             ──►  /logs                       ──►  useLogs()   onValue listener
GET   /tanks/1.json, /config.json ◄── /tanks/1, /config       ◄──  AdminPanel writes thresholds,
                                                                   calibration, pump command
                                  Firestore /users            ──►  AuthContext (role, status)
```

What the ESP32 sends (fixed, from `backend/firmware/esp32_firmware.ino`):

| Write | Path | When | Fields |
|---|---|---|---|
| Live telemetry (PATCH) | `/tanks/1` | On a significant change, at most once per second, and at least every 10 s as a heartbeat (lines 217–218, 1960–2026) | `waterLevel`, `phLevel`, `waterHeight`, `status`, `pumpOn`, `phSensorOk`, `levelSensorOk`, `lowLevelAlert`, `highLevelAlert`, `phAlert`, `rssi`, `wifiConnected`, `firebaseConnected`, `ethConnected`, `lastUpdate` (server timestamp) |
| History sample (POST) | `/history/tanks/1` | Every 10 minutes (line 1479) | `waterLevel`, `phLevel`, `waterHeight` (each `null` if that sensor is faulty), `pumpOn`, `timestamp` |
| Event log (POST) | `/logs` | On events: sensor fault, network loss/recovery, pump command accepted/refused, Firebase errors (line 592–629) | `id` (`"esp32-<millis>"`), `action`, `details`, `performedBy`, `logLevel`, `timestamp` |

The ESP32 also reads `/tanks/1` about once per second (pump command, calibration) and `/config` (thresholds, maintenance mode, pump lock). It runs its own alert state machine and publishes the result in `lowLevelAlert` / `highLevelAlert` / `phAlert` / `status`.

On the web side, `frontend/src/store/useStore.ts` subscribes with `onValue` to `/tanks`, `/config`, `/notifications` and `/logs`. `onValue` uses a WebSocket under the hood, so the UI is already real-time; there is no HTTP polling of the database.

### 1.2 How web notifications work today

**Trigger.** `frontend/src/components/SystemMonitor.tsx` is a headless component mounted in `AppLayout.tsx:68`. Every time tank data, config, or notifications change, it re-evaluates three conditions per tank against `/config`:

| Check | Raises when | Recovers when | Type |
|---|---|---|---|
| Low water | `waterLevel <= lowLevelThreshold` | `> threshold + 2` | `warning` |
| Overflow | `waterLevel >= overflowThreshold` | `< threshold − 2` | `danger` |
| pH | outside `minPh`–`maxPh` | inside the range by 0.15 | `danger` |

A condition must hold for 5 s before it raises and 5 s before it recovers. An unacknowledged active alert repeats every 60 s. This state is kept in a `useRef`, so it lives only in that browser tab.

**Delivery.** The browser that detects the condition writes to `/notifications/alert-<tankId>-<key>` (one fixed ID per tank and condition). Every other open browser receives it through its own `/notifications` listener.

**UI.**
- Toast (`sonner`), 15 s, only in the browser that detected it.
- Bell icon with popover (`NotificationCenter.tsx`): red count of unacknowledged alerts, blue dot for unread, list with time, click to mark read, **Acknowledge** button (admin and worker), **Clear all** (admin and worker).
- Sound (`utils/alertSound.ts`): a two-tone Web Audio chime every 4 s while any warning/danger notification is unacknowledged.
- Acknowledging writes `acknowledged`, `acknowledgedBy`, `acknowledgedAt` and adds a log entry; other dashboards stop their sound through the listener.

**Offline detection.** `Dashboard.tsx:337–354` compares `lastUpdate` with Firebase server time. After 30 s without an update it sets `tanks/<id>/controllerOffline` in a transaction and writes a `CONTROLLER_OFFLINE` log. It shows a banner and a "Controller Offline" badge. It does not create a notification, a toast, or a sound, and it only runs while the Dashboard page is open.

**What does not exist yet:** browser push, service worker, any server-side evaluation, per-user read state, a history page for notifications, user-configurable sound, email/SMS/Telegram.

---

## Part 2 — Web notification recommendations

Summary table (details follow):

| # | Recommendation | Difficulty | Priority |
|---|---|---|---|
| R1 | Move alert evaluation to one server-side evaluator | Medium | Must-have |
| R2 | Keep Firebase listeners as the real-time channel (no Socket.IO/SSE) | Easy | Must-have |
| R3 | Device-offline alerts as real notifications | Easy–Medium | Must-have |
| R4 | Alert levels and de-duplication model | Medium | Must-have |
| R5 | Notification history page with per-user read state | Medium | Must-have |
| R6 | Sensor-fault and "bad data" notifications | Easy | Must-have |
| R7 | Sound and visual alert controls | Easy | Nice-to-have |
| R8 | Threshold and notification settings from the web | Easy–Medium | Nice-to-have |
| R9 | Browser push (FCM + service worker) | Hard | Nice-to-have |
| R10 | Telegram channel | Easy (after R1) | Nice-to-have |
| R11 | Email and SMS | Medium | Optional |

### R1 — One server-side alert evaluator (Must-have, Medium)

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

### R2 — Real-time delivery: keep Firebase listeners (Must-have, Easy)

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

### R3 — Device-offline alerts (Must-have, Easy–Medium)

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

### R4 — Alert levels and a de-duplication model (Must-have, Medium)

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

### R5 — Notification history page with per-user read state (Must-have, Medium)

**What and why.** The popover is the only view, it is not filterable, and **Clear all** deletes the record for everyone. For a monitoring system the alert history is evidence, and panels usually ask "when did this happen and who responded?". Also, `read` is currently one shared flag, so one operator opening a notification marks it read for every user.

- Add a `/notifications` page (route in `App.tsx`, link in `AppLayout.tsx`) with filters for level, tank, date range, and acknowledged/unacknowledged, plus pagination. The `Logs.tsx` layout can be reused.
- Per-user read state: store one number, `userState/{uid}/notificationsLastReadAt`. A notification is unread when `timestamp > lastReadAt`. "Mark all as read" becomes a single write. This is far simpler than a read flag per user per notification.
- Replace **Clear all** with retention: keep 90 days (the same policy `Reports.tsx` uses for history), and restrict deletion to admins.
- Show full date, not only the time. `NotificationCenter.tsx:33–36` formats time only, so yesterday's alert looks like today's.

**Files.** New `frontend/src/pages/Notifications.tsx`; `frontend/src/App.tsx`; `frontend/src/components/AppLayout.tsx`; `frontend/src/components/NotificationCenter.tsx`; `frontend/src/store/useStore.ts`; `backend/cloud/database.rules.json`.

```json
"userState": { "$uid": { ".read": "auth.uid === $uid", ".write": "auth.uid === $uid" } }
```

### R6 — Sensor-fault and bad-data notifications (Must-have, Easy)

**What and why.** The ESP32 already reports `phSensorOk` and `levelSensorOk`, and the dashboard shows a small "FAULT" tag, but no notification is raised. Worse, `SystemMonitor.tsx:154–190` keeps evaluating the level and pH values while a sensor is faulty, so a broken sensor can produce a false "Low Water Level" alert. Raise a `danger` "Sensor Fault" notification when either flag turns `false`, and skip threshold checks for that sensor while it is faulty. Also ignore values that are not finite numbers or are outside physical range (level 0–100, pH 0–14); the firmware uses `-999` as an internal "no reading yet" value (lines 226–228).

**Files.** `frontend/src/components/SystemMonitor.tsx` (or the worker), `frontend/src/store/useStore.ts` (a `sanitizeTank()` helper used by `useTanks`).

```ts
const validLevel = tank.levelSensorOk !== false && Number.isFinite(tank.waterLevel) && tank.waterLevel >= 0 && tank.waterLevel <= 100;
const validPh    = tank.phSensorOk    !== false && Number.isFinite(tank.phLevel)    && tank.phLevel >= 0    && tank.phLevel <= 14;
if (validLevel) { /* low + overflow checks */ }
if (validPh)    { /* pH check */ }
```

### R7 — Sound and visual alert controls (Nice-to-have, Easy)

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

### R8 — Threshold and notification settings from the web (Nice-to-have, Easy–Medium)

**What and why.** The four thresholds are already editable in Admin Panel → Configuration and the ESP32 already reads them, so this works. Improvements, all web-side:
- Validate before saving (issue E2): ranges, `low < overflow`, `minPh < maxPh`.
- Add notification settings under `/config/notifications`: offline threshold, repeat/escalation interval, quiet hours for non-critical levels, which levels play sound, and channel toggles for R9–R11. These are new keys the firmware does not read, so they cannot affect the ESP32.
- Keep per-user preferences (mute, push on/off) under `userState/{uid}`.
- Log every threshold change with old and new values; the current save does not write a log entry.

Constraint: the hysteresis margins (2 % and 0.15 pH) and the level/overflow comparison are hard-coded in the firmware, so the web should display them as fixed, not offer to edit them.

**Files.** `frontend/src/pages/AdminPanel.tsx` (`Configuration`), `frontend/src/store/useStore.ts` (`SystemConfig`), `backend/cloud/database.rules.json` (`.validate`).

### R9 — Browser push with FCM and a service worker (Nice-to-have, Hard)

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

### R10 — Telegram channel (Nice-to-have, Easy once R1 exists)

**What and why.** A Telegram bot is the most practical "reach my phone" channel for a capstone: free, no approval process, works on any phone, and it is one HTTPS call from the worker. Create a bot with BotFather, add it to an operators group, and send on `raise`/`resolve`. Keep the bot token on the server only; it must never be in the frontend bundle or in git.

**Files.** Worker only, plus an on/off toggle in `AdminPanel.tsx`.

```js
await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text: `🔴 ${title}\n${message}` }),
});
```

### R11 — Email and SMS (Optional, Medium)

- **Email:** send from the worker with `nodemailer` and an SMTP account, or use the Firebase "Trigger Email" extension (Blaze plan). Best used for a daily summary and for criticals that stay unacknowledged for 15 minutes, since email is slow for live alerts.
- **SMS:** works without internet on the receiving phone, which matters for field staff, but every message costs money and needs a paid gateway account. Treat it as future work unless the panel specifically asks for it, and limit it to critical alerts with a strict rate limit.

**Files.** Worker only; recipient list under `/config/notifications`.

---

## Part 3 — System issues that need fixing

Severity: **Critical** = exploitable or unsafe now; **High** = wrong behavior users will hit; **Medium** = wrong in some situations or a growing cost; **Low** = cleanup.

Firmware items are listed separately at the end as observations only, since firmware code is out of scope.

### 3.1 Security

| ID | Severity | File:line | Problem | Suggested fix |
|---|---|---|---|---|
| S1 | **Critical** | `backend/cloud/database.rules.json:5–22` | Every path is `auth != null` for read and write. Roles are enforced only in React (`ProtectedRoute.tsx`, button visibility). A `viewer` account can, with the browser console or a REST call, change thresholds, switch `tanks/1/pumpOn`, delete all logs and notifications, or alter history. Role checks in the UI are not security. | Enforce roles in the rules. Realtime Database rules cannot read Firestore, so mirror the role to `/roles/{uid}` in the Realtime Database (writable by admins only) or use custom claims set from a server. Example below. |
| S2 | **Critical** (verify in console) | Firebase Auth settings + S1 | The web API key is public by design, and Firebase's sign-up endpoint is open by default. If "Enable create (sign-up)" is still on in Authentication → Settings → User actions, anyone on the internet can create an account and immediately gets full read/write on the database because of S1. The app signs out users without a profile (`AuthContext.tsx:59–63`), but that is client-side only. | Turn off user sign-up in the console if possible (admin-created accounts via `registerOperator` use the same endpoint, so test this; otherwise fixing S1 is the real protection). Fix S1 so an account with no role has no access. |
| S3 | **High** | `frontend/src/pages/LoginPage.tsx:89` (read back at `:29`) | "Remember me" stores the password in plain text in `localStorage`. Any script on the page, browser extension, or person at the computer can read it. | Remove the password storage. Remember only the email. Firebase Auth already keeps the session; use `setPersistence(browserLocalPersistence / browserSessionPersistence)` for the "remember me" choice. Also add a one-time `localStorage.removeItem('wm_remembered_password')` to clean existing browsers. |
| S4 | **High** | `backend/cloud/database.rules.json` (whole file) | No `.validate` rules. Any authenticated client, including a malfunctioning ESP32, can write any shape or type: strings for numbers, a 500 % water level, huge blobs. | Add `.validate` for telemetry and config. Example below. Do not validate so strictly that the existing firmware payload is rejected: the device writes with PATCH and its payload is listed in Part 1. |
| S5 | **Medium** | `frontend/src/services/authService.ts:102–110` | "Deleting" a user removes only the Firestore profile. The Firebase Auth account still exists and can still sign in, which, with S1, still grants database access. | After S1 this is contained (no role, no access). Prefer deactivating (`status: 'inactive'`) over deleting, or delete the Auth user from the server-side worker with the Admin SDK. |
| S6 | **Medium** | `frontend/src/store/useStore.ts:524–530`, `NotificationCenter.tsx:29` | `acknowledgedBy` is whatever name the client sends, so the audit trail can be forged, and a viewer can acknowledge through the console. | Store `acknowledgedByUid` and add a rule: `newData.child('acknowledgedByUid').val() === auth.uid`, plus the role check from S1. |
| S7 | **Low** | `backend/cloud/firestore.rules:13` | Any signed-in user can read every user profile, including email addresses. | Allow a user to read their own document; allow admins to read all. The Dashboard needs only names for "Assigned", which can be denormalised onto the tank. |
| S8 | **Low** | `frontend/src/config/firebase.ts:7–15` | The Firebase config is hard-coded. This is **not** a leaked secret: Firebase web API keys are meant to be public, and security comes from rules (S1). It is still good practice to restrict the key. | In Google Cloud Console, restrict the key to the site's HTTP referrers and to the Firebase APIs it needs. Consider Firebase App Check for the web app. Moving the values to `VITE_` env variables is tidy but does not hide them. |
| S9 | **Low** | `mobile/capacitor.config.ts:9` | `cleartext: true` allows unencrypted HTTP although the configured URL is HTTPS. | Set to `false`. |

Example rules for S1 and S4 (a starting point, to be tested with the Firebase Rules Playground and the real ESP32 before deploying):

```json
{
  "rules": {
    "roles": { ".read": "auth != null",
               ".write": "root.child('roles').child(auth.uid).val() === 'admin'" },
    "config": {
      ".read": "auth != null",
      ".write": "root.child('roles').child(auth.uid).val() === 'admin'",
      "lowLevelThreshold": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100" },
      "overflowThreshold": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100" },
      "minPh": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 14" },
      "maxPh": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 14" }
    },
    "tanks": {
      ".read": "auth != null",
      "$tankId": {
        ".write": "root.child('roles').child(auth.uid).val() === 'admin' || root.child('roles').child(auth.uid).val() === 'worker' || root.child('roles').child(auth.uid).val() === 'device'",
        "phLevel": { ".validate": "newData.isNumber()" },
        "waterLevel": { ".validate": "newData.isNumber()" }
      }
    },
    "logs": { ".read": "root.child('roles').child(auth.uid).val() !== null", ".indexOn": ["timestamp"],
              "$id": { ".write": "root.child('roles').child(auth.uid).val() !== null && (!data.exists() || root.child('roles').child(auth.uid).val() === 'admin')" } },
    "notifications": { ".read": "root.child('roles').child(auth.uid).val() !== null", ".indexOn": ["timestamp"] }
  }
}
```

The ESP32's own account gets the role `device`, which needs: write on `/tanks/1`, `/history/tanks/1`, `/logs`; read on `/tanks/1` and `/config`. Nothing about the firmware changes; only the account's permissions do.

### 3.2 Bugs and logic errors

| ID | Severity | File:line | Problem | Suggested fix |
|---|---|---|---|---|
| B1 | **High** | `frontend/src/components/SystemMonitor.tsx:60–192` | Alerts are evaluated only inside an open browser tab. With no dashboard open there are no notifications at all; with five open there are five independent state machines. | R1 (server-side evaluator). Short term: accept the limitation and state it in the manuscript. |
| B2 | **High** | `SystemMonitor.tsx:93–105` with `useStore.ts:508–517` | A browser that has just loaded starts every tracker at `NORMAL`. If a condition is already active, 5 s later it calls `addNotification` with the fixed ID, and `set()` overwrites the record with `acknowledged: false, read: false`. Result: any page reload or new login **un-acknowledges an alert an operator already acknowledged**, and the alarm sound restarts on every dashboard. The acknowledged check exists only in the `WARNING/CRITICAL` branch (`:129`), not in `NORMAL`. | Before raising, check whether an unresolved notification with that ID already exists and adopt its state instead of overwriting. Best: the transaction pattern in R4. |
| B3 | **Medium** | `SystemMonitor.tsx:124`, `useStore.ts:509` | Recovery notifications get the ID `Date.now()`, so each open browser writes its own "Recovered" entry: N browsers, N duplicates. The original alert record is also never marked resolved; it stays unacknowledged and keeps the sound going until someone acknowledges an alert that is already over. | Mark the alert `resolved` (stop sound) and write one recovery event guarded by the same transaction. |
| B4 | **Medium** | `SystemMonitor.tsx` (no `maintenanceMode` check); promised at `Dashboard.tsx:410` and `AdminPanel.tsx:1077` | The UI states that maintenance mode suppresses alerts system-wide. The web alert code never reads `config.maintenanceMode`, so alerts, toasts, and sound continue. | Return early from evaluation when `config.maintenanceMode` is true; show a muted indicator on the bell. |
| B5 | **High** | `Dashboard.tsx:337–354`, `useStore.ts:352–367` | Offline detection runs only while the Dashboard page is mounted, and it writes only a log entry. No notification, toast, or sound is produced when the controller goes offline. | R3. |
| B6 | **Medium** | `SystemMonitor.tsx:154–190` vs firmware `1978–1984`, `1603–1614` | The web and the firmware classify the same conditions differently. Firmware: low water → `CRITICAL`/`danger`, overflow → `WARNING`. Web notifications: low water → `warning`, overflow → `danger`. Boundaries differ too (`<=` / `>=` on the web, `<` / `>` on the device). The tank card badge follows the firmware while the notification follows the web, so one event can show "Danger" on the card and a yellow warning in the bell, or the reverse. | Since the firmware is fixed, make the web follow it: derive notification level from `lowLevelAlert` / `highLevelAlert` / `phAlert` (see R1), and document the mapping. |
| B7 | **Medium** | `SystemMonitor.tsx:154–190` | Sensor health flags are ignored. A faulty level sensor can raise a false low-water alert, and no "sensor fault" notification exists. | R6. |
| B8 | **Medium** | `frontend/src/pages/AdminPanel.tsx:758–762` | `tank1` is a new object every time the ESP32 reports (at least every 10 s), so this effect resets `localTank1` and **discards calibration values the admin is still typing**. | Initialise the local form once (or only when not dirty), not on every telemetry update. |
| B9 | **Medium** | `AdminPanel.tsx:797–807` | Saving calibration spreads the entire cached tank object (`...localTank1`) into `update()`. That writes back stale `waterLevel`, `phLevel`, `status`, `lastUpdate`, and `pumpOn` along with the calibration. It can briefly overwrite live telemetry, push `lastUpdate` backwards, and re-send an old pump command. | Send only the seven calibration fields. |
| B10 | **Medium** | `useStore.ts:576`, `:532`, `:509` | IDs come from `Date.now()`. Two writes in the same millisecond, from two users or from one burst, overwrite each other. | Use `push()` keys. |
| B11 | **Medium** | `useStore.ts:561` and `frontend/src/pages/Logs.tsx:304` | ESP32 log entries carry `id: "esp32-<millis>"`, which restarts from zero on every reboot, so IDs repeat. `Logs.tsx` uses `log.id` as the React key; duplicate keys cause rows to be dropped or duplicated, especially with `AnimatePresence`. | Use the database key as the ID: `Object.entries(data).map(([key, v]) => ({ ...v, id: key }))`. |
| B12 | **Medium** | `useStore.ts:396`, `:465`, defaults at `:128–157` | If `/tanks` or `/config` is empty, any client writes defaults. The default Tank 1 has `waterLevel: 75`, `pumpOn: true`, and `lastUpdate: Date.now()`, so after a database reset the dashboard shows a healthy, live, 75 % tank that no device reported. | Do not seed fake telemetry. Seed only name and calibration, without `lastUpdate`, and restrict seeding to admins (or do it once by hand). |
| B13 | **Medium** | `useStore.ts:520–522`, `NotificationCenter.tsx:91` | `read` is a single shared flag: one user reading a notification marks it read for everyone. | R5 (per-user `lastReadAt`). |
| B14 | **Medium** | `NotificationCenter.tsx:70`, `useStore.ts:544–546` | **Clear all** deletes every notification for every user, including active unacknowledged alerts, with no confirmation, and workers can do it. | Confirmation dialog, admin only, and prefer retention over deletion (R5). |
| B15 | **Low** | `useStore.ts:377`, `:453` | Tanks and config are first rendered from `localStorage`. Until Firebase responds, the dashboard shows the last cached reading as if current. | Show a loading or "cached" state until the first snapshot arrives. |
| B16 | **Low** | `Dashboard.tsx:315–325`, `:461` | The connection banner reflects only the first non-planned tank, and "Device ID: ESP32-WROOM-32" is hard-coded. Fine for one device, wrong when a second tank goes live. | Per-tank status, or label the banner with the tank name. |
| B17 | **Low** | `AppLayout.tsx:101`, `useStore.ts:593–604` | The header says "System Server Clock" but shows the browser clock. | Add the existing `serverTimeOffset`, or rename the label. |
| B18 | **Low** | `useStore.ts:512`, `:525`, `:581` | Timestamps use the browser clock, so a PC with a wrong clock produces misordered notifications and logs. The ESP32 correctly uses server timestamps. | Use `serverTimestamp()`. |
| B19 | **Low** | `Dashboard.tsx:374–378` (passed at `:478`, declared at `:49`, `:66`) | `getStatus` is passed to every `TankCard` and never used, and contains a hard-coded `80`. | Delete it. |

### 3.3 Performance

| ID | Severity | File:line | Problem | Suggested fix |
|---|---|---|---|---|
| P1 | **Medium** | `useStore.ts:487`, `:555` | `/notifications` and `/logs` are downloaded in full, and re-sorted in full on every change. Logs have no retention; the ESP32 and the web both append forever. Download size and bandwidth cost grow without bound. | `query(ref, orderByChild('timestamp'), limitToLast(200))`, pagination for older entries, and `".indexOn": ["timestamp"]` for both paths in `database.rules.json` (currently only `/history` is indexed). Add 90-day retention for logs. |
| P2 | **Low** | `useStore.ts:376`, `:483`, `:551` | Every component that calls `useTanks` / `useNotifications` / `useLogs` creates its own listener and its own copy of the state (for example `SystemMonitor`, `NotificationCenter`, and the page each hold one). The SDK shares the connection, but parsing, sorting and `localStorage` writes are repeated per instance. | Put each subscription in one React context provider and read from it. |
| P3 | **Low** | `useStore.ts:394` | The whole tank list is written to `localStorage` on every telemetry update (about once per second while values change), once per hook instance. | Throttle, or drop the cache (see B15). |
| P4 | **Low** | `Dashboard.tsx:304–311`, `AppLayout.tsx:10` | Two one-second timers re-render the layout and dashboard every second. `TankCard` is memoised, so the cost is small. | Isolate the clock in its own small component. |
| P5 | **Low** | `frontend/src/pages/Reports.tsx:229–272` | History cleanup runs in the browser, only when an admin opens Reports, and "already done this month" is remembered per browser in `localStorage`. If no admin opens Reports, nothing is ever deleted. | Move retention to the worker (R1). |

There is no heavy HTTP polling on the web side; listeners are push-based. (The once-per-second polling is on the ESP32 and is out of scope.)

### 3.4 Error handling gaps

| ID | Severity | File:line | Problem | Suggested fix |
|---|---|---|---|---|
| E1 | **High** | `useStore.ts:388–392`, `SystemMonitor.tsx:154–190` | Data from the device is trusted as-is. `useTanks` spreads the raw value and casts it to `Tank`. A missing `waterLevel` becomes `undefined` (comparisons are false, so no alert, silently); `null` compares as `0` and raises a low-water alert; an out-of-range value raises a false alert. The display path is guarded (`useUIStabilization.ts:104–106`) but the alert path is not. | One `sanitizeTank()` in `useTanks` that checks type and range and marks a field invalid; R6 for how alerts treat invalid fields; S4 to reject bad writes at the database. |
| E2 | **Medium** | `AdminPanel.tsx:786–794`, inputs at `:837–873` | Thresholds are saved with `Number(...)` and no validation. An empty field saves `0`. Nothing prevents `low >= overflow` or `minPh >= maxPh`, which would put the web and the ESP32 into permanent alert. The firmware accepts any number it reads. | Validate with `zod` (already a dependency): finite, in range, ordered. Disable Save until valid. Back it with S4. |
| E3 | **Medium** | `useStore.ts:399–401`, `:468`, `:501`, `:568` | Listener errors, including permission errors, go only to `console.error`. The user sees an empty or stale screen with no explanation. | Expose an `error` state and show a banner; add the `.info/connected` banner from R2. |
| E4 | **Medium** | `useStore.ts:526–530`, `:583`, `:587`; `SystemMonitor.tsx:104`, `:124`, `:139`; `Dashboard.tsx:395` | Writes are not awaited and failures are not caught. A pump command, an acknowledgement, or a notification can fail silently, and the UI behaves as if it succeeded. | `await` and `try/catch`, with an error toast. Make acknowledge + log a single multi-path `update()` so both succeed or both fail. |
| E5 | **Low** | `frontend/src/utils/alertSound.ts:26–36`, `:55–57` | Sound failure is silent (see R7). | Surface an "enable sound" prompt. |
| E6 | **Low** | `frontend/src/config/firebase.ts:21` | `getAnalytics` is called without `isSupported()`; it can throw in environments without cookies or IndexedDB, at import time. | `isSupported().then(ok => ok && getAnalytics(app))`, or remove Analytics if unused. |
| E7 | **Low** | `Dashboard.tsx:289–296` | The Firestore `users` listener has no error callback. | Add one. |

### 3.5 Code quality and maintainability

| ID | Severity | File:line | Problem | Suggested fix |
|---|---|---|---|---|
| Q1 | **Low** | `frontend/src/pages/Reports.tsx` (1,660 lines), `AdminPanel.tsx` (1,095 lines) | Very large files mixing data access, calculations, export, and UI. Hard to test and to explain in a defense. | Extract hooks (`useHistory`) and helpers (export, aggregation) into separate files. |
| Q2 | **Low** | `frontend/src/config/firebase.ts:23–35`; `authService.ts:115–134` | Unused example functions. `listenToTank` never unsubscribes; `updateTankData` uses `set()`, which would wipe a tank's calibration if anyone called it. `seedInitialAdmin` is unused and would fail under the current Firestore rules. | Delete. |
| Q3 | **Low** | `frontend/src/App.tsx:21–22` | Two toast systems are mounted (shadcn `Toaster` and `sonner`); only `sonner` is used by the pages reviewed. | Keep one. |
| Q4 | **Low** | `App.tsx:4`, `:15`, `:18` | `@tanstack/react-query` is set up but no query uses it. | Remove, or use it. |
| Q5 | **Low** | `App.tsx:25` | After login the app does `window.location.href = '/dashboard'`, a full page reload, although `LoginPage.tsx:38–42` already navigates. | Remove the reload. |
| Q6 | **Low** | `LoginPage.tsx:66–69`, `AuthContext.tsx:156–158`, `AdminPanel.tsx:115–118` | A username without `@` silently gets `@gmail.com` appended, in three separate places. A password-reset for a mistyped username goes to a stranger's Gmail address. | Require a full email, or put the rule in one shared function with a project-specific domain. |
| Q7 | **Low** | `Dashboard.tsx:282`, `:290`; `useStore.ts:388`; `AdminPanel.tsx:838–873` (`as any`) | `any` hides exactly the type problems described in E1 and E2. | Type the form state as strings and parse on save; type Firestore users as `UserProfile`. |
| Q8 | **Low** | `useStore.ts:31–38` vs `authService.ts:15–23` | Two user types (`User` with an optional `password`, and `UserProfile`). | Keep `UserProfile` only. |
| Q9 | **Low** | `SystemMonitor.tsx:7–9`, `useStore.ts:285`, `Dashboard.tsx:325` | Timing constants are scattered, and the 30 s offline threshold is written twice. | One `constants.ts`. |
| Q10 | **Low** | `frontend/src/test/` | Tests exist for acknowledgement and offline logic (not run in this review). The alert state machine in `SystemMonitor.tsx`, where B2 and B3 live, is inside a React effect and hard to test. | Extract it into a pure function `(state, reading, now) => (state, events)` and unit-test it. The same function can then be shared with the worker in R1. |

### 3.6 Firmware observations (no change requested, for awareness only)

These are in firmware code, which is out of scope for changes. They are listed because they affect how the web side should be designed or because they are a risk the team should know about.

- `backend/firmware/esp32_firmware.ino:16` and `:20` contain a real-looking WiFi network name and password as fallback values, and the file is committed to git. If the repository is or becomes public, treat that WiFi password as exposed. Changing the password on the router and in the untracked `secrets.h` does not require editing the firmware source.
- The device uses `setInsecure()` for TLS (for example `:534`, `:2020`), so it does not verify Firebase's certificate.
- Log IDs are `esp32-<millis>` (`:592`) and repeat after a reboot. Handled on the web by B11.
- Thresholds read from `/config` are accepted without range checks (`:1883–1901`). Handled on the web by E2 and S4.

---

## Part 4 — Prioritized action plan

Sized for a capstone timeline. Each phase leaves the system in a working, demonstrable state. No phase requires touching the firmware.

### Phase 1 — Fix first (about one week; correctness and security)

| Order | Item | Why first |
|---|---|---|
| 1 | **S3** — stop storing the password in `localStorage` | Small change, removes the most visible security flaw |
| 2 | **S1 / S2 / S4** — role-based database rules, `.validate`, check sign-up setting | The current rules make every role check cosmetic. Test with the real ESP32 account before deploying so telemetry keeps flowing |
| 3 | **B2, B3** — stop un-acknowledging and duplicating alerts | Directly visible in a demo with two browsers open |
| 4 | **B8, B9** — calibration form reset and stale-field overwrite | Admin form is currently unreliable while the device is online |
| 5 | **E1, E2, B7 / R6** — sanitise device data, validate thresholds, sensor-fault alerts | Removes false alarms |
| 6 | **B4** — make maintenance mode suppress alerts as the UI says | Behavior matches the documentation |
| 7 | **B11, B10** — database keys as IDs | Fixes log list glitches |

### Phase 2 — Add next (one to two weeks; the notification features a panel will look for)

| Order | Item |
|---|---|
| 1 | **R3** — offline alerts as real notifications, checked on every page |
| 2 | **R4** — alert levels aligned with the firmware (fixes **B6**), alert-state/history split, de-duplication |
| 3 | **R5** — notification history page, per-user read state, retention instead of Clear all (fixes **B13**, **B14**) |
| 4 | **R2 / P1 / E3** — limited queries, indexes, connection-lost banner |
| 5 | **R7** — enable-sound prompt, mute/snooze, tab title and in-page browser notifications |
| 6 | **R8** — notification settings in the Admin Panel |

### Phase 3 — If time allows (one to two weeks; removes the "browser must be open" limitation)

| Order | Item |
|---|---|
| 1 | **R1** — server-side evaluator (Node worker on the free plan, or Cloud Functions on Blaze). Fixes **B1** and **B5** properly and moves retention off the browser (**P5**) |
| 2 | **R10** — Telegram alerts from the worker (largest benefit for the least work once R1 exists) |
| 3 | **R9** — browser push with FCM and a service worker |

### Optional / future work (good material for the manuscript's recommendations chapter)

- **R11** email summaries and SMS for critical alerts.
- Native push for the Android app via `@capacitor/push-notifications`.
- Firebase App Check and API-key restrictions (**S8**).
- Refactoring and cleanup items **Q1–Q10**, **P2–P4**, and the Low-severity bugs.

### If only three things get done

1. Fix the database rules and the stored password (**S1–S4**).
2. Fix the alert overwrite and duplicate bugs and add offline notifications (**B2**, **B3**, **R3**).
3. Add the notification history page with per-user read state (**R5**).

If the server-side evaluator (R1) is not built, state the limitation plainly in the manuscript: alerts are generated only while at least one dashboard is open.
