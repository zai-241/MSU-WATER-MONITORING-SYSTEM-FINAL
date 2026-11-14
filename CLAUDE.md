# MSU Water Monitoring System: System Map

IoT water level and pH monitoring for up to four reservoir tanks (Tanks 1–4) at the MSU Motor Pool; only Tank 1
(tested on a 200 L drum model of Reservoir Tank No. 1) has hardware. This is also the
capstone thesis project. This file is the single source of truth for how the parts fit together.
**Update it whenever the system design changes** (new part, new database path, new deploy step).

## The five parts

| Part | Where | What it does | How it ships |
|---|---|---|---|
| Firmware | `backend/firmware/esp32_firmware.ino` (Tank 1); `backend/firmware/tank2/`, `tank3/`, `tank4/` (same sketch, `TANK_ID` 2–4) | ESP32 reads level (GPIO 35) and pH (GPIO 34), filters, drives the pump relay (GPIO 32), writes to RTDB over HTTPS REST. Ethernet (LAN8720) first, Wi-Fi as backup. | Arduino IDE upload over USB |
| Database rules | `backend/cloud/database.rules.json`, `firestore.rules` | Role-based access (admin / worker / viewer / device, read from `/roles`) | `npx firebase deploy --only database,firestore` |
| Alert worker | `backend/worker/src/index.ts` | Always-on Node process: evaluates alerts, offline watchdog, push (FCM), 90-day retention, heartbeat to `/system/worker` | Render free Web Service, auto-deploys on push to `main` (key as a Render secret file, kept awake by UptimeRobot on `/health`). Locally: `npm run worker` (needs `backend/worker/.env`). Run only one. |
| Web app | `frontend/` (React 18 + TS + Vite + shadcn/ui) | Dashboard, Admin Panel, Reports, Logs, Notifications | `npm run deploy:hosting` → https://msu-water-monitoring-system.web.app |
| Android app | `mobile/` (Capacitor 8, `com.watersystem.msu`) | Wrapper around the **hosted** web app (`server.url` in `capacitor.config.ts`) | Sideloaded APK only, no Play Store |

Key consequence: because the APK loads the hosted site, **a web deploy updates the Android app too**.
A new APK is only needed for native changes (icons, plugins, push setup, `google-services.json`).

## Data flow

```
Sensors → ESP32 per tank (filter + pump logic) → RTDB /tanks/{TANK_ID}, /logs, /history/tanks/{TANK_ID}
                    ↑ reads /config and commands every 1 s
RTDB → web app / APK (live onValue listeners)
RTDB → alert worker → /notifications + push (FCM)
Firestore /users/{uid} → profiles; RTDB /roles/{uid} → what each account may write
```

The pump decision runs on the ESP32, not in the cloud. The web app only sends commands and config.

## Database paths (RTDB)

| Path | Written by | Contents |
|---|---|---|
| `/tanks/{id}` | ESP32 (one per tank), web app (commands, calibration) | Live level, pH, pump state, sensor health, link info, calibration, `capacityLiters` (set per tank by the admin) |
| `/config` | Admin Panel | Thresholds (low 15 %, overflow 95 %, pH 6.5 to 8.5), maintenance mode, locks |
| `/history/tanks/{id}` | ESP32 | One sample every 10 min |
| `/logs` | ESP32, web app | Audit events (INFO / WARNING / ERROR / CRITICAL). Tank 2–4 controllers add `tankId`; ESP32 entries without it belong to Tank 1 |
| `/notifications` | Worker (or browsers while the worker is down) | Alerts with acknowledgment |
| `/userState` | Web app | Per-user read state and settings |
| `/system` | Worker | Heartbeat (`/system/worker`). If it is gone for 60 s, an open dashboard raises the `alert-service-offline` notice; the worker resolves it on start |
| `/roles/{uid}` | Admin | `admin`, `worker`, `viewer` or `device` |

Tanks 2 to 4 exist in the UI as "Planned - IoT not yet installed" until their controller reports (no `lastUpdate`).
Only Tank 1 has hardware. Their firmware is ready in `backend/firmware/tank2-4/`; each needs its own device account
(Admin Panel → Device Accounts) and `secrets.h`. The web app creates any missing tank 1–4 record (never overwrites one),
and the Admin Panel calibration form has a Tank 1–4 selector. The four-tank limit is not enforced in code.

## Shared logic: change it in one place

- `frontend/src/lib/alertEngine.ts` is imported by **both** the web app and the worker. Alert rules change here only.
- `frontend/src/lib/constants.ts` holds web-app timings, retention (90 days), and the default tank capacity (200 L);
  each tank's own capacity is `tanks/{id}/capacityLiters` and drives the estimated volume in Reports and exports.
- Firmware constants (filter windows, deadbands, pump cooldown 30 s, history 10 min) live at the top of
  `esp32_firmware.ino`. If you change one, also check `docs/Methodology.md` and the thesis.

## Commands (run from the repo root)

```bash
npm run dev            # web app at http://localhost:8080
npm test               # Vitest suites in frontend/src/test
npm run typecheck
npm run lint
npm run deploy:hosting # build + deploy web (also updates the APK's content)
npm run cap:sync       # copy build into mobile/android before an APK build
npm run worker:check   # verify worker credentials and DB access
```

## Secrets (never commit)

`backend/firmware/**/secrets.h` (one per tank folder), `backend/worker/.env`, `backend/worker/serviceAccount*.json`,
`mobile/android/app/google-services.json`, `frontend/.env*`. Templates: `secrets.example.h`, `.env.example`.

## Where things are tracked

| What | Where |
|---|---|
| Requirements | `docs/SRS.md` |
| Architecture and operator manual | `docs/System_Overview.md` (older; no worker section yet) |
| Filtering, calibration math, schemas | `docs/Methodology.md` |
| Chapter 3 diagrams | `docs/diagrams/` |
| Open issues and review status | `WEB_NOTIFICATION_RECOMMENDATIONS.md`, `docs/Code_Cleanup.md` |
| Cloud setup steps (roles, worker, push, App Check) | `PHASE3_SETUP.md` |
| Thesis tooling | `.claude/agents/` (thesis-code-checker, proofreader, etc.), `thesis-review/` |

## Keeping this map current (team)

- Whoever changes how the parts fit together updates this file in the same commit.
- `.githooks/pre-commit` prints a reminder when a commit touches firmware, database rules, the worker,
  `alertEngine.ts`/`constants.ts`, the Firebase config or `capacitor.config.ts` without touching this file.
  It only warns. `npm install` turns it on (the `prepare` script sets `core.hooksPath`).
- Before adviser meetings or the defense, one person checks this map against the code.

## Rules for changes

- When a change touches a number or behavior described in the thesis (thresholds, intervals, filter
  stages, roles), say so, and run the `thesis-code-checker` agent before adviser meetings or the defense.
- Deploy database rules only after the needed `/roles` entries exist, or the ESP32 gets rejected.
- Keep it free: no paid Firebase plan features, no Play Store fees.
