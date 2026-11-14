# Phase 3 Setup Guide

MSU Water Monitoring System: alert worker, push notifications, Android push, App Check and API-key restrictions.

The code for all of these is in the repository. Each one also needs a value or a switch that only exists in your Firebase / Google Cloud account, which is what this guide covers. **Until a step is done, that feature stays off and the app behaves as before**: nothing here can break the running system by being skipped.

Do the steps in this order. Steps 1 and 2 are required for the rest.

| Step | What it turns on | Needs |
|---|---|---|
| 1 | Role-based database rules | Firebase console |
| 2 | Alert worker (alerts with no browser open) | Service-account key, always-on machine |
| 3 | Browser push | Web Push key, step 2 |
| 4 | Android push | `google-services.json`, rebuild of the app, step 2 |
| 5 | App Check | reCAPTCHA v3 key |
| 6 | API-key restrictions | Google Cloud console |

---

## 1. Seed roles, then deploy the rules

The rules in `backend/cloud/database.rules.json` only accept writes from accounts that have a role under `/roles`. **Create the roles before deploying**, otherwise the ESP32 is rejected.

1. Firebase console → Authentication → Users. Copy the **User UID** of your admin account and of the ESP32's account.
2. Realtime Database → Data. Create:
   - `roles/<admin UID>` = `"admin"`
   - `roles/<ESP32 UID>` = `"device"`
3. Deploy:

```bash
npx firebase deploy --only database,hosting
```

4. Sign in once as the admin. That copies every existing worker's and viewer's role into `/roles`.
5. Check that the dashboard still shows live readings. If it shows "Controller Offline", the ESP32's UID is missing or wrong in `/roles`. You can also add it later from Admin Panel → Configuration → Controller (ESP32) Accounts.

---

## 2. Alert worker

The worker is a small Node.js program in `backend/worker`. It evaluates alerts, runs the offline watchdog, sends push notifications and applies the 90-day retention policy. It uses the same alert logic as the web app (`frontend/src/lib/alertEngine.ts`).

While it runs, Admin Panel → Configuration shows **"Alert service: running"** and browsers stop evaluating alerts themselves. If it stops, browsers take over again within about 35 seconds, so alerts never silently stop while a dashboard is open.

### Requirements

- A machine that stays on with internet access (lab PC, Raspberry Pi, or a small cloud host).
- Node.js 18 or newer.
- The machine's clock set to update automatically.

### Setup

1. Firebase console → Project settings → Service accounts → **Generate new private key**. Save the file as `backend/worker/serviceAccount.json`.

   This file is a master key to the project. It is listed in `.gitignore`. Never commit it, email it, or put it in the frontend.

2. Create the settings file by copying `backend/worker/.env.example` to `backend/worker/.env`. The defaults are already correct for this project.

3. Install and test the connection. Run this from the project root; it works in PowerShell, Command Prompt and Git Bash:

```bash
npm run worker:setup
```

   `check passed` means the key and database URL are correct.

   Note for Windows PowerShell: commands joined with `&&` (for example `cd backend/worker && npm install`) fail there with "The token '&&' is not a valid statement separator". The `npm run` commands in this guide avoid that.

4. Start it (from the project root):

```bash
npm run worker
```

### Keep it running

```bash
npm install -g pm2
```

```bash
pm2 start npm --name water-worker -- run worker
```

```bash
pm2 save
```

On Linux or a Raspberry Pi, run `pm2 startup` once and follow the command it prints. On Windows, use the `pm2-windows-startup` package or a Task Scheduler entry that runs `pm2 resurrect` at logon.

### Or host it on Render (free, no PC needed)

The worker can run as a free Render **Web Service**. When Render sets `PORT`, the worker answers `GET /health` (200 while the evaluation loop runs, 503 if it stalls). Locally `PORT` is unset and nothing listens.

1. Render → New → **Web Service** → connect this GitHub repo, branch `main`, region Singapore.
2. Root Directory: **empty** (the worker imports `frontend/src/lib/alertEngine.ts`).
3. Build command `npm run worker:install`, start command `npm run worker`, instance type Free.
4. Environment: `DATABASE_URL`, `APP_URL`, `PUSH_ENABLED=true`, `NODE_VERSION=20`, and `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/serviceAccount.json`.
5. Secret File `serviceAccount.json`: paste the whole key file.
6. Free services sleep after about 15 minutes without traffic, so add an UptimeRobot HTTP monitor on `https://<service>.onrender.com/health` every 5 minutes. It also emails you if the worker goes down.
7. Stop any local or pm2 worker once Admin Panel shows "Alert service: running" from Render.

Render redeploys on every push to `main`. One always-on free service uses about 744 of the 750 free hours a month, so keep it the only one.

### Test it

1. Close every dashboard.
2. Unplug the ESP32 for about 40 seconds.
3. Open the dashboard. A "Controller Offline" notification should already be in the history, created while no browser was open.

### Notes

- Run **one** worker only. Two would both be correct (writes are transactions) but each would send its own pushes.
- To stop push notifications without stopping alerts, turn off "Push Notifications" in Admin Panel → Configuration, or set `PUSH_ENABLED=false` in `.env`.

---

## 3. Browser push notifications

Push reaches a browser even when the site is closed. The worker (step 2) is the sender.

1. Firebase console → Project settings → Cloud Messaging → Web configuration → **Generate key pair**. Copy the key.
2. Create `frontend/.env` from `frontend/.env.example` and set:

```
VITE_FCM_VAPID_KEY=<the key pair value>
```

3. Rebuild and deploy:

```bash
npm run deploy:hosting
```

4. On each device: open the site, click the bell, click **Enable Push**, and allow notifications.

Things to know:

- The button only appears when the browser supports push and the key above is set.
- iPhone and iPad: push works only after the site is added to the Home Screen (Share → Add to Home Screen), then opened from that icon.
- Signing out removes that device's registration, so a signed-out device stops receiving alerts.
- `frontend/public/firebase-messaging-sw.js` loads Firebase version 12.9.0. If you upgrade the `firebase` package, change the version in that file to match.

---

## 4. Android app push

The Android app shows the hosted site inside a WebView, and WebView cannot receive browser push. The app therefore uses native push through `@capacitor/push-notifications`, which is already installed and registered in the Android project.

1. Firebase console → Project settings → Your apps → **Add app** → Android. Package name: `com.watersystem.msu`.
2. Download `google-services.json` and place it at `mobile/android/app/google-services.json`.
3. Build the web app, sync, and build the APK:

```bash
npm run build
```

```bash
npm run cap:sync
```

```bash
npm run cap:open
```

   Then build and install from Android Studio.

4. In the app: bell → **Enable Push** → allow notifications.

Because the app loads the hosted site, the site must be deployed (step 3) for the app to show the Enable Push button. Without `google-services.json` the app still works; only push is unavailable.

---

## 5. Firebase App Check

App Check proves that requests come from your web app and not from a script that copied the public config.

1. Firebase console → App Check → Apps → your web app → register with **reCAPTCHA v3**. Copy the site key.
2. Add to `frontend/.env`:

```
VITE_RECAPTCHA_SITE_KEY=<site key>
```

3. Rebuild and deploy. Without this key App Check stays off.

### Enforcement: read before switching anything on

| Product | Enforce? | Why |
|---|---|---|
| **Realtime Database** | **No. Leave unenforced.** | The ESP32 writes over REST and cannot send App Check tokens. Enforcing here blocks the controller. |
| Cloud Firestore | Yes, after a few days | Only the web app uses Firestore (user profiles). |
| Authentication | Leave as is | The ESP32 also signs in. |

Leave everything in monitoring mode for a few days first. The App Check page shows the share of verified requests; enforce Firestore once it is near 100 %.

The alert worker uses the Admin SDK and is not affected by App Check.

For local development, the browser console prints a debug token on first load. Register it under App Check → Apps → Manage debug tokens, or put it in `VITE_APPCHECK_DEBUG_TOKEN`.

---

## 6. API-key restrictions

The web API key in `frontend/src/config/firebase.ts` is public by design. Restricting it limits what a copied key can be used for. This is done only in Google Cloud console; there is no code for it.

**The ESP32 uses a Firebase API key too** (in its `secrets.h`) to sign in. A browser-only restriction on that same key would lock the controller out. Use two keys:

1. Google Cloud console → APIs & Services → Credentials.
2. **Web key** (the existing "Browser key"):
   - Application restrictions → Websites. Add:
     - `https://msu-water-monitoring-system.web.app/*`
     - `https://msu-water-monitoring-system.firebaseapp.com/*`
     - `http://localhost:8080/*` (development)
   - API restrictions → restrict the key to the Firebase APIs the site calls. Start with: Identity Toolkit API, Token Service API, Firebase Installations API, FCM Registration API, Firebase App Check API and Cloud Firestore API. If something stops working afterwards, the browser console names the blocked API; add it to the list.
3. **Device key**: create a second key for the ESP32.
   - Application restrictions → None (a microcontroller has no website or fixed address).
   - API restrictions → Identity Toolkit API and Token Service API only.
   - Put this key in the ESP32's `secrets.h` as `FIREBASE_API_KEY` and re-flash. This changes a value in the untracked secrets file, not the firmware source.

If you would rather not re-flash the ESP32, skip the website restriction on the existing key and apply only the API restrictions in step 2. That is still an improvement.

After changing restrictions, wait about five minutes, then check that login works, the dashboard updates, and the ESP32 is still reporting.

---

## What was verified, and what was not

Verified on the development machine:

- Web app: unit tests pass, TypeScript check is clean for application code, production build succeeds.
- Worker: installs, type-checks, and exits with a clear message when settings are missing.
- Android: the push plugin is registered in the Gradle project by `cap sync`.

Not verified, because they need your accounts and devices:

- The worker against the live database, and real push delivery.
- The Android app build and push on a phone.
- App Check and API-key restrictions.
- The database rules against the real ESP32 (use the Rules Playground in the console, then watch the dashboard after deploying).
