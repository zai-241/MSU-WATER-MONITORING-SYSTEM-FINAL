# MSU Water Monitoring System: System Map

IoT water level and pH monitoring for up to four reservoir tanks (Tanks 1–4) at the MSU Motor Pool; only Tank 1
(tested on a 200 L drum model of Reservoir Tank No. 1) has hardware. This is also the
capstone thesis project. This file is the single source of truth for how the parts fit together.
**Update it whenever the system design changes** (new part, new database path, new deploy step).

## The five parts

| Part | Where | What it does | How it ships |
|---|---|---|---|
| Firmware | `backend/firmware/esp32_firmware.ino` (Tank 1); `backend/firmware/tank2/`, `tank3/`, `tank4/` (same sketch, `TANK_ID` 2–4) | ESP32 reads level (GPIO 35) and pH (GPIO 34), filters, runs the pump logic and drives the pump relay on GPIO 32 (`PUMP_RELAY_ENABLED 1`; HIGH = ON, LOW at boot), writes to RTDB over HTTPS REST. Ethernet (W5500 over SPI: SCK 18, MISO 19, MOSI 23, CS 5, INT 4, RST 14; needs ESP32 Arduino core 3.x) first, Wi-Fi as hot-standby backup. Ethernet is the default route whenever it is up; traffic moves to Wi-Fi on cable unplug or after 3 failed/slow (>4 s) polls on Ethernet, and back to Ethernet when it returns (retried every 60 s). Wi-Fi is re-joined if it gets no reply within 10 s of a switch. After a re-plug the W5500 is restarted if it has no IP within 3 s; after any switch the sensor upload goes first. If nothing reaches Firebase for 3 min (any link) the ESP32 restarts itself, but never while the pump is ON (wait doubles to 24 min max while the internet stays down); each start logs its reset reason ("System Power Tracker"). Firebase requests: 5 s read timeout, 10 s TLS handshake limit, sensor upload on the keep-alive poll connection. Failover details and measured times: `docs/Methodology.md` 4.2. | Arduino IDE upload over USB |
| Database rules | `backend/cloud/database.rules.json`, `firestore.rules` | Role-based access (admin / worker / viewer / device, read from `/roles`). On `tanks/{id}` a worker may write only `pumpOn`, on an assigned tank, while the pump lock is off | `npx firebase deploy --only database,firestore` |
| Alert worker | `backend/worker/src/index.ts` | Always-on Node process: evaluates alerts, offline watchdog, night watch (leak / open faucet), push (FCM), 90-day retention, heartbeat to `/system/worker` | Render free Web Service, auto-deploys on push to `main` (key as a Render secret file, kept awake by UptimeRobot and cron-job.org, both pinging `/health`; Render's Auto-Deploy setting must be "On Commit"). Locally: `npm run worker` (needs `backend/worker/.env`). Run only one. |
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
A sensor fault never suspends monitoring: after the 10 s fault check the ESP32 keeps sending the live (clamped)
reading with `levelSensorOk` / `phSensorOk = false`, and `alertEngine.ts` keeps checking thresholds on it (the
message says the reading may be inaccurate). Only the pump is held off while the level sensor is faulty.
Besides out-of-range voltage, the level sensor is also flagged faulty when its reading swings 25 % or more within
30 s (a floating GPIO 35 from a disconnected sensor stays in range but wanders); see `LEVEL_UNSTABLE_RANGE`.
The pump UI no longer says "demo"; the Admin Panel switch is called "Pump System" (DB key still `pumpDemoMode`).
All four sketches have `PUMP_RELAY_ENABLED 1`: GPIO 32 drives the pump relay (HIGH = ON). Set it to 0 to run the pump logic without switching a pin.
Live sensor readings (Admin Panel → calibration, `LiveCalibrationPanel.tsx`) replace the USB Serial Monitor for calibration:
an admin writes `tanks/{id}/calibrationUntil` (server ms, 10 min per Start/+10 min, 30 min max, also enforced by the rules), and while it is in
the future the ESP32 adds `tanks/{id}/calibrationLive` (filtered level V, unclamped height, %, pH V) to its normal sensor upload once per second.
No extra request, one record overwritten, no history. The firmware stops by itself at that time, after 30 min (`CALIB_LIVE_MAX_MS`), or while
its NTP clock is unset. "Use as Vmin/Vmax/pH neutral" only fills the form; Save applies it. All four sketches have it.

Night watch (leak detection): no water is used at night, so between 10 PM and 3 AM (Philippine time, UTC+8;
Admin Panel → Night Watch) a falling level means a leak or an open faucet. `evaluateNight()` in `alertEngine.ts`
(worker, or a dashboard while the worker is down) raises "Possible Leak or Open Faucet" (`alert-{id}-nightDrain`,
danger, push) for a 5 % drop within 30 min, and "Possible Slow Leak" (`alert-{id}-nightLeak`, warning) at the end of
the window for 3 % in total. Pump-on, sensor-fault and calibration readings are ignored. Thresholds are at least 3 %
because the firmware level deadband is 2 %. No firmware change; details in `docs/Methodology.md` 4.3.

## Database paths (RTDB)

| Path | Written by | Contents |
|---|---|---|
| `/tanks/{id}` | ESP32 (one per tank), web app (commands, calibration) | Live level, pH, pump state, sensor health, link info, calibration, `capacityLiters` (set per tank by the admin). `pumpOn` is the pump command: the ESP32 writes it only when it changes the pump itself or refuses a command, never in its regular sensor upload (that overwrote commands). It acknowledges each command with `pumpCommandAt` + `pumpCommandResult`; the dashboard shows a spinner until then (15 s timeout, `PUMP_COMMAND_TIMEOUT_MS`). After a reboot the ESP32 writes its own state (OFF) before reading commands |
| `/config` | Admin Panel | Thresholds (low 15 %, overflow 95 %, pH 6.5 to 8.5), night watch (`nightWatchEnabled`, `nightStartHour`/`nightEndHour`, `nightFastDropPercent`, `nightSlowDropPercent`), maintenance mode, locks, `pumpDemoMode` (shown as "Pump System"; missing = on: shows the pump UI and lets the ESP32 run the pump), `pumpMode` (`"auto"` / `"manual"`, admin-only; missing = auto; manual skips the low-level auto start, safety stops stay; Tank 1 sketch only so far) |
| `/history/tanks/{id}` | ESP32 | One sample every 10 min, also during a sensor fault (with `levelSensorOk` / `phSensorOk` flags; Reports marks those "Fault") |
| `/logs` | ESP32, web app | Audit events (INFO / WARNING / ERROR / CRITICAL). Tank 2–4 controllers add `tankId`; ESP32 entries without it belong to Tank 1. Dashboard pump commands (`PUMP_ON` / `PUMP_OFF`) carry `tankId` and `performedByRole`; Reports → Pump Activity Log pairs them with the controller's accepted/refused entry (`buildPumpEvents` in `reportLogs.ts`) |
| `/notifications` | Worker (or browsers while the worker is down) | Alerts with acknowledgment |
| `/userState` | Web app | Per-user read state and settings |
| `/system` | Worker | Heartbeat (`/system/worker`). If it is gone for 60 s, an open dashboard raises the `alert-service-offline` notice; the worker resolves it on start. While it is gone, browsers run the offline watchdog, but mark a controller offline only after their own connection has been up and the page awake for 10 s (`OFFLINE_CHECK_SETTLE_MS`), so a resumed tab or APK does not raise a false offline |
| `/roles/{uid}` | Admin | `admin`, `worker`, `viewer` or `device` |

Tanks 2 to 4 exist in the UI as "Planned - IoT not yet installed" until their controller reports (no `lastUpdate`).
Only Tank 1 has hardware. Their firmware is ready in `backend/firmware/tank2-4/`; each needs its own device account
(Admin Panel → Device Accounts) and `secrets.h`. The web app creates any missing tank 1–4 record (never overwrites one),
and the Admin Panel calibration form has a Tank 1–4 selector. The four-tank limit is enforced in the web app
(`SUPPORTED_TANK_IDS` in `constants.ts`): Tank Assignment registers only IDs 1–4, and Tanks 1–4 cannot be deleted
(disable them instead). The database rules do not enforce it.

## Shared logic: change it in one place

- `frontend/src/lib/alertEngine.ts` is imported by **both** the web app and the worker. Alert rules change here only.
- `frontend/src/lib/predictive.ts` (web app only) turns the 10-minute history into peak hours, peak day of the week,
  expected use today, time until the low threshold and the pH trend (Reports → Predictive Analytics, also in the
  Excel sheet, PDF section and CSV blocks via `buildPredictiveReport()`; Dashboard "Est. time to 15%"). Philippine time; skips pump-on, fault, gap and glitch intervals. Details: `docs/Methodology.md` 4.4.
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
npm run deploy:hosting # build + deploy web (also updates the APK's content); stops if frontend/.env has no VITE_FCM_VAPID_KEY (browser push)
npm run cap:sync       # copy build into mobile/android before an APK build
npm run worker:check   # verify worker credentials and DB access
```

## Secrets (never commit)

`backend/firmware/**/secrets.h` (one per tank folder), `backend/worker/.env`, `backend/worker/serviceAccount*.json`,
`mobile/android/app/google-services.json`, `frontend/.env*`. Templates: `secrets.example.h`, `.env.example`.
The sketches have no fallback credentials: a build without all five values in `secrets.h` stops with an `#error`.

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
