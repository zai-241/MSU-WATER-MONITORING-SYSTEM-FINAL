# MSU Water Monitoring System: System Map

IoT water level and pH monitoring for reservoir tanks at the MSU Motor Pool (Tanks 1–4 built in, more can be added); only Tank 1
(the Pilot Test Tank, a 200 L drum) has hardware. This is also the capstone thesis project.
This file is the single source of truth for how the parts fit together.
**Update it whenever the system design changes** (new part, new database path, new deploy step).

Two phases, and the paper must keep them apart:
- **Pilot testing (done):** the 200 L drum (0.90 m high) on an elevated stand (to simulate a gravity-fed reservoir) in Brgy. Datu Saber, Marawi City, is Tank 1 in
  the system (dashboard name "Pilot Test Tank"). Sensor calibration (level and pH) and hardware debugging were done
  on it, for safety and controlled testing. Every measured result in the paper comes from this drum.
- **Actual deployment (target):** the system is designed for real-time monitoring of Reservoir Tank No. 1, the
  elevated water tank of the MSU Motor Pool on 3rd Street behind CICS: 16,852.25 US gal (about 63,793 L), about 4.0 m
  water height. Nothing is installed there yet. Moving there means setting tank height 4.0 m and `capacityLiters`
  63793 in the Admin Panel and recalibrating Vmin/Vmax and the level calibration table. With Tank 1's current HW-685 setting (0.600 V empty, about
  0.84 V per m) the reading would pass the 3.25 V fault limit above about 3.2 m, so SPAN must be turned down until
  4.0 m reads at most 3.0 V (`docs/Level_Sensor_Zero_Span_Calibration.md`, C2).

## The five parts

| Part | Where | What it does | How it ships |
|---|---|---|---|
| Firmware | `backend/firmware/esp32_firmware.ino` (Tank 1); `backend/firmware/tank2/`, `tank3/`, `tank4/` (same sketch, `TANK_ID` 2–4); a sketch for Tank 5+ is made with `npm run firmware:new-tank -- <id>` | ESP32 reads level (GPIO 35) and pH (GPIO 34), filters, runs the pump logic and drives the pump relay on GPIO 32 (`PUMP_RELAY_ENABLED 1`; HIGH = ON, LOW at boot), writes to RTDB over HTTPS REST. Ethernet (W5500 over SPI: SCK 18, MISO 19, MOSI 23, CS 5, INT 4, RST 14; needs ESP32 Arduino core 3.x) first, Wi-Fi as hot-standby backup. Ethernet is the default route whenever it is up; traffic moves to Wi-Fi on cable unplug or after 3 failed/slow (>4 s) polls on Ethernet, and back to Ethernet when it returns (retried every 60 s). Wi-Fi is re-joined if it gets no reply within 10 s of a switch. After a re-plug the W5500 is restarted if it has no IP within 3 s; after any switch the sensor upload goes first. If nothing reaches Firebase for 3 min (any link) the ESP32 restarts itself, but never while the pump is ON (wait doubles to 24 min max while the internet stays down); each start logs its reset reason ("System Power Tracker"). Firebase requests: 5 s read timeout, 10 s TLS handshake limit, sensor upload on the keep-alive poll connection; only HTTP 2xx counts as success. Dry-run guard: a running pump is stopped if the level has not risen 3 % in 10 min or after 60 min (`PUMP_NO_RISE_TIMEOUT_MS`, `PUMP_MAX_RUN_MS`), which sets `tanks/{id}/pumpFault` and blocks auto starts until a manual ON; the fault is kept in flash (NVS, `savePumpFault()`), so a restart or power cut does not clear it (`docs/Methodology.md` 4.1). Tank 1 only (26 Nov 2026): the level calibration and the pump-blocking switches are also kept in flash (NVS `safety`) and automatic starts wait until they are known; the sensor task opens the relay at once on overflow, level fault, maintenance or Pump System off (`docs/Methodology.md` 4.1 item 5). Pump and local alert thresholds: the tank's own `tanks/{id}/thresholds` (read with the 1 s command poll) when all four are valid, else the shared ones in `/config` (`applyThresholds()`, all sketches). Failover details and measured times: `docs/Methodology.md` 4.2. | Arduino IDE upload over USB |
| Database rules | `backend/cloud/database.rules.json`, `firestore.rules` | Role-based access (admin / worker / viewer / device, read from `/roles`). On `tanks/{id}` a worker may write only `pumpOn`, on an assigned tank, while the pump lock is off. Only admin and worker may write `/notifications`. Firestore `users/{uid}` is readable by its owner and admins only; `directory/{uid}` holds names only for everyone | `npx firebase deploy --only database,firestore` |
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
Firestore /users/{uid} → profiles (own or admin); /directory/{uid} → names only (Dashboard "assigned to"); RTDB /roles/{uid} → what each account may write
```

The pump decision runs on the ESP32, not in the cloud. The web app only sends commands and config.
A sensor fault never suspends monitoring: after the 10 s fault check the ESP32 keeps sending the live (clamped)
reading with `levelSensorOk` / `phSensorOk = false`, and `alertEngine.ts` keeps checking thresholds on it (the
message says the reading may be inaccurate). Only the pump is held off while the level sensor is faulty.
Besides out-of-range voltage, the level sensor is also flagged faulty when its reading swings 25 % or more within
30 s (a floating GPIO 35 from a disconnected sensor stays in range but wanders); see `LEVEL_UNSTABLE_RANGE`.
Tank 1 has an RC filter + 100 kΩ pull-down on GPIO 35 (`docs/Level_Sensor_RC_Filter_Wiring.md`), so a disconnected
HW-685 output reads 0 V (the ADC reports about 0.14 V). The level voltage fault limit is therefore 0.20 V
(`LEVEL_MIN_VALID_VOLTAGE`, all four sketches; 0.30 V until 25 Nov 2026, lowered because the empty drum reads only
about 0.39 V); pH stays at 0.05 V. Keep the limit above about 0.20 V so a disconnected sensor is still caught.
ZERO should still put an empty tank well above the limit (0.50 V recommended).
The pump UI no longer says "demo"; the Admin Panel switch is called "Pump System" (DB key still `pumpDemoMode`).
Maintenance works system-wide (`config/maintenanceMode`, "Maintenance Mode (all tanks)") or per tank
(`tanks/{id}/maintenanceMode`, Admin Panel → Tank Maintenance, admin only in the rules). Either one pauses that tank's alerts,
night watch and offline notice (`isTankInMaintenance()` in `alertEngine.ts`), and its ESP32 (read with the 1 s command poll)
stops the pump and refuses ON commands (`refused-maintenance`). The Dashboard card shows "Under Maintenance". All four sketches have it.
All four sketches have `PUMP_RELAY_ENABLED 1`: GPIO 32 drives the pump relay (HIGH = ON). Set it to 0 to run the pump logic without switching a pin.
Live sensor readings (Admin Panel → calibration, `LiveCalibrationPanel.tsx`) replace the USB Serial Monitor for calibration:
an admin writes `tanks/{id}/calibrationUntil` (server ms, 10 min per Start/+10 min, 30 min max, also enforced by the rules), and while it is in
the future the ESP32 adds `tanks/{id}/calibrationLive` (filtered level V, unclamped height, %, pH V) to its normal sensor upload once per second.
No extra request, one record overwritten, no history. The firmware stops by itself at that time, after 30 min (`CALIB_LIVE_MAX_MS`), or while
its NTP clock is unset. "Use as Vmin/Vmax/pH neutral" only fills the form; Save applies it. All four sketches have it.

Multi-point level calibration: a tank may have `tanks/{id}/levelCalPoints`, 2 to 20 `{depthM, volts}` points from 0 m
to `tankHeight` (±5 mm), depths and voltages strictly increasing, voltages 0.20–3.25 V (Admin Panel → Calibration →
Level calibration table, `LevelCalibrationTable.tsx`; "Use live reading" fills a row from the live readings; Save applies).
Vmin/Vmax stay as the fallback: while the table has rows they are shown under "Fallback" (not editable) and Save sets them to
the table's first and last voltage; the live panel's "Use as Vmin/Vmax" buttons are hidden then.
The ESP32 reads it with the 1 s command poll, checks the same rules (`levelCalProblem()`) and interpolates linearly between the
two points around the voltage (`levelHeightFromVoltage()`; outside the table the end segment is extended, then clamped as before,
so below the first point 0 % and above the last 100 %). No list or an invalid one = the Vmin/Vmax line, exactly as before (an invalid
one logs one WARNING). Fault limits, deadband, pump logic and history are unchanged. `calibrationLive.calPoints` says which one
the controller uses (0 = Vmin/Vmax). Web math and checks: `frontend/src/lib/levelCalibration.ts`; method: `docs/Methodology.md` 3.1.1.
All four sketches have it (Tank 4 is the new-tank template).

Night watch (leak detection): no water is used at night, so between 10 PM and 3 AM (Philippine time, UTC+8;
Admin Panel → Night Watch) a falling level means a leak or an open faucet. Admin Panel → Night Watch → "Tanks to watch" picks the tanks it covers
(`config/nightWatchTanks/{id}`, only `false` leaves a tank out, so a new tank is watched; `isNightWatchedTank()`;
unticking a tank closes its open night alerts). `evaluateNight()` in `alertEngine.ts`
(worker, or a dashboard while the worker is down) raises "Possible Leak or Open Faucet" (`alert-{id}-nightDrain`,
danger, push) for a 5 % drop within 30 min, and "Possible Slow Leak" (`alert-{id}-nightLeak`, warning) at the end of
the window for 3 % in total. Pump-on, sensor-fault and calibration readings are ignored. Thresholds are at least 3 %
because the firmware level deadband is 2 %. No firmware change; details in `docs/Methodology.md` 4.3.

## Database paths (RTDB)

| Path | Written by | Contents |
|---|---|---|
| `/tanks/{id}` | ESP32 (one per tank), web app (commands, calibration) | Live level, pH, pump state, sensor health, link info, calibration, `capacityLiters` (set per tank by the admin), `levelCalPoints` (admin, optional multi-point level calibration; missing = `levelVmin`/`levelVmax`), `maintenanceMode` (per-tank maintenance, admin), `thresholds` (admin, optional: this tank's own `lowLevelThreshold`, `overflowThreshold`, `minPh`, `maxPh`; all four or none, set in Admin Panel → Reservoir Settings → Tank N; used by alerts, Dashboard, Reports and the tank's controller instead of the shared `/config` values, `tankThresholds()` in `alertEngine.ts`). `pumpOn` is the pump command: the ESP32 writes it only when it changes the pump itself or refuses a command, never in its regular sensor upload (that overwrote commands). It acknowledges each command with `pumpCommandAt` + `pumpCommandResult`; the dashboard shows a spinner until then (15 s timeout, `PUMP_COMMAND_TIMEOUT_MS`). After a reboot the ESP32 writes its own state (OFF) before reading commands. `pumpFault` (`no-rise` / `max-run`) is set by the dry-run guard and raises `alert-{id}-pumpFault`; a manual ON clears it |
| `/config` | Admin Panel | Shared thresholds (low 15 %, overflow 95 %, pH 6.5 to 8.5; a tank may override them in `tanks/{id}/thresholds`), `pumpControlLock` (the ESP32 refuses every dashboard pump command, admins included, and the Dashboard greys out the switch for everyone), night watch (`nightWatchEnabled`, `nightStartHour`/`nightEndHour`, `nightFastDropPercent`, `nightSlowDropPercent`, `nightWatchTanks`), maintenance mode, locks, `pumpDemoMode` (shown as "Pump System"; missing = on: shows the pump UI and lets the ESP32 run the pump), `pumpMode` (`"auto"` / `"manual"`, admin-only; missing = auto; manual skips the low-level auto start, safety stops stay; all sketches) |
| `/history/tanks/{id}` | ESP32 | One sample every 10 min, also during a sensor fault (with `levelSensorOk` / `phSensorOk` flags; Reports marks those "Fault") |
| `/logs` | ESP32, web app | Audit events (INFO / WARNING / ERROR / CRITICAL). Tank 2–4 controllers add `tankId`; ESP32 entries without it belong to Tank 1. Dashboard pump commands (`PUMP_ON` / `PUMP_OFF`) carry `tankId` and `performedByRole`; Reports → Pump Activity Log pairs them with the controller's accepted/refused entry (`buildPumpEvents` in `reportLogs.ts`) |
| `/notifications` | Worker (or admin/worker browsers while the worker is down; a viewer's page only shows alerts) | Alerts with acknowledgment |
| `/userState` | Web app | Per-user read state and settings |
| `/system` | Worker | Night watch state per tank (`/system/nightWatch`, saved at most once a minute and reloaded on start, so a restart at night keeps the slow-leak total). Heartbeat (`/system/worker`). If it is gone for 60 s, an open dashboard raises the `alert-service-offline` notice, but only while that page is visible, connected and awake for 10 s, and only after re-reading the heartbeat from the server (`fetchWorkerLastSeen`); a sleeping tab or backgrounded APK used to raise false ones. The worker resolves it on start and whenever it sees it open while running. While it is gone, browsers run the offline watchdog, but mark a controller offline only after their own connection has been up and the page awake for 10 s (`OFFLINE_CHECK_SETTLE_MS`), so a resumed tab or APK does not raise a false offline |
| `/roles/{uid}` | Admin | `admin`, `worker`, `viewer` or `device` |
| `/presence/{uid}` | Web app (each signed-in tab or APK) | Online status for Admin Panel → User Management (`lib/presence.ts`): one `connections/{id}` entry (`since`, `app` web/android) per open connection, removed by the server when it drops (`onDisconnect`), and `lastSeen`. Online = at least one entry. Removed before sign-out, which does not close the connection. Only admins can read it; each user writes only their own |

Tanks 2 to 4 (and any added tank) exist in the UI as "Planned - IoT not yet installed" until their controller reports
(no `lastUpdate`). Only Tank 1 has hardware. Firmware for Tanks 2–4 is ready in `backend/firmware/tank2-4/`; each needs its
own device account (Admin Panel → Device Accounts) and `secrets.h`. Tanks 1–4 are built in (`DEFAULT_TANK_IDS` in
`constants.ts`): the web app creates any missing one (never overwrites one), and they cannot be deleted (disable them instead).
There is no tank limit: Tank Assignment registers any free whole-number ID from 1 to 999 (`isValidTankId`, `MAX_TANK_ID`;
the ID becomes the sketch's `TANK_ID`), and an added tank can be deleted (that also deletes its history and closes its open alerts; remove its device account too, or a powered controller recreates it). Everything per tank follows the registered tanks:
Dashboard cards, calibration tabs, Tank Maintenance switches, Reports, alerts, night watch and the offline watchdog (worker
and browser). The database rules accept any tank ID. For a new tank's controller: `npm run firmware:new-tank -- <id>`
copies the Tank 4 sketch to `backend/firmware/tank<id>/` with that `TANK_ID`, then device account, `secrets.h`, upload.

## Shared logic: change it in one place

- `frontend/src/lib/alertEngine.ts` is imported by **both** the web app and the worker. Alert rules change here only.
- `frontend/src/lib/predictive.ts` (web app only) turns the 10-minute history into peak hours, peak day of the week,
  expected use today, time until the low threshold and the pH trend (Reports → Predictive Analytics, also in the
  Excel sheet, PDF section and CSV blocks via `buildPredictiveReport()`; not on the Dashboard). Philippine time; skips pump-on, fault, gap and glitch intervals. Details: `docs/Methodology.md` 4.4.
- `frontend/src/lib/levelCalibration.ts` (web app only) is the multi-point level math and validation; the four sketches
  repeat it in C++ (`levelHeightFromVoltage()`, `levelCalProblem()`). Change both together. The Dashboard, Reports and
  alerts use the level % the ESP32 sends, so they compute no level from voltage themselves.
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
| Level sensor hardware: HW-685 ZERO/SPAN and multimeter tests; RC filter + pull-down on GPIO 35 (built on Tank 1, 20 Nov 2026) | `docs/Level_Sensor_Zero_Span_Calibration.md`, `docs/Level_Sensor_RC_Filter_Wiring.md` |
| Chapter 3 diagrams | `docs/diagrams/` |
| Open bugs, errors and manual steps (current list: "Open now" at the top) | `docs/Bugs_and_Errors.md` |
| Older review records (open items mirror the list above) | `WEB_NOTIFICATION_RECOMMENDATIONS.md`, `docs/Code_Cleanup.md` (all done) |
| Cloud setup steps (roles, worker, push, App Check) | `PHASE3_SETUP.md` |
| Thesis tooling | `.claude/agents/` (thesis-code-checker, proofreader, etc.), `thesis-review/` |
| System facts for the paper; paper status, open issues and change log | `paper/SYSTEM_FACTS.md`, `paper/PAPER_TRACKER.md` (committed) |
| What to change in the paper after a system change | `thesis-review/paper-changes-YYYY-MM-DD.md` (local only: `thesis-review/` is git-ignored) (one per batch; 2026-11-19: live calibration, night watch, predictive analytics; 2026-11-24: multi-point level calibration), facts in `thesis-review/Paper_Facts.md` |

## Keeping this map current (team)

- Whoever changes how the parts fit together updates this file in the same commit.
- `.githooks/pre-commit` prints a reminder when a commit touches firmware, database rules, the worker,
  `alertEngine.ts`/`constants.ts`, the Firebase config or `capacitor.config.ts` without touching this file.
  It only warns. `npm install` turns it on (the `prepare` script sets `core.hooksPath`).
- Before adviser meetings or the defense, one person checks this map against the code.

## Rules for changes

- When a change touches a number or behavior described in the thesis (thresholds, intervals, filter
  stages, roles), say so, and run the `thesis-code-checker` agent before adviser meetings or the defense.
- Paper edits go into the Google Doc (Drive: "FINAL_CAPSTONE_PAPER_2026-11-24", since 23 Nov 2026; not the 11-19 Doc) as **suggestions**. Never edit or save
  a capstone paper .docx on a local machine; local .docx files are for reading only.
- **Paper Sync Rule:** whenever code, firmware, hardware config, schema or a feature is added, changed or removed:
  1. Update `paper/SYSTEM_FACTS.md`.
  2. Find every paper section it affects (scope, objectives, architecture, requirements, methodology, results,
     screenshots, abstract, conclusions, recommendations) and write the new wording in `paper/PAPER_TRACKER.md` →
     Misalignment Log. It goes into the Google Doc as a suggestion only after the team approves it in chat.
  3. A removed feature still in the paper is removed or moved to Recommendations.
  4. Re-check the cross-chapter chain (objective → method → result → conclusion) for those sections.
  5. Add a row to `PAPER_TRACKER.md` → Change Log and update its Chapter Status Dashboard.
  6. Name the affected paper sections in the commit message.
  At the start of a session, run `git log` since the last Change Log entry and sync anything missed (teammates' pushes too).
- Deploy database rules only after the needed `/roles` entries exist, or the ESP32 gets rejected.
- Keep it free: no paid Firebase plan features, no Play Store fees.
