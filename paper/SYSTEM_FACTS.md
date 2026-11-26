# System Fact Sheet (source of truth for the paper)

Built 26 Nov 2026 from the code at commit `d1c4af6` (main). Every line names the file that proves it.
`CLAUDE.md` is the fuller system map; this sheet is the short list the paper is checked against.
Update it in the same commit as any change to firmware, rules, worker, web app or app (Paper Sync Rule).

## 1. Name and description

- **Code/docs name:** MSU Water Monitoring System (`CLAUDE.md`, `docs/SRS.md`).
- **Paper title (from the paper, not the code):** IoT-Based Water Level and Quality Monitoring System for MSU Motor Pool.
- **One sentence:** an ESP32 per tank reads water level and pH, runs automatic pump control on the tank, and sends the
  readings to Firebase, where a web dashboard and an Android app show them and a cloud alert service raises alerts and push notifications.

## 2. Two phases (the paper must keep them apart)

| | Pilot testing (done) | Actual deployment (target, not installed) |
|---|---|---|
| Tank | 200 L drum, 0.90 m high, on an elevated stand, Brgy. Datu Saber, Marawi City | Reservoir Tank No. 1, MSU Motor Pool, 3rd Street behind CICS |
| Size | 200 L (`DEFAULT_TANK_CAPACITY_LITERS`, `frontend/src/lib/constants.ts:66`) | 16,852.25 US gal (about 63,793 L), about 4.0 m water height |
| In the system | Tank 1, dashboard name "Pilot Test Tank" | Needs tank height 4.0 m, `capacityLiters` 63793, new calibration, SPAN lowered |
| Results | Every measured result in the paper comes from here | None |

## 3. Hardware (Tank 1 only; Tanks 2–4 have no hardware)

| Part | Detail | Proof |
|---|---|---|
| Microcontroller | ESP32 Dev Module (ESP32-WROOM-32, dual-core 240 MHz), one per tank | `docs/SRS.md`, `esp32_firmware.ino` |
| Level sensor | Submersible hydrostatic (pressure) level sensor, 4–20 mA → HW-685 current-to-voltage module → GPIO 35 | `docs/Level_Sensor_Zero_Span_Calibration.md:7`, `esp32_firmware.ino:161` |
| Level input filter | RC filter + 100 kΩ pull-down on GPIO 35 (built on Tank 1, 20 Nov 2026) | `docs/Level_Sensor_RC_Filter_Wiring.md` |
| pH sensor | PH-4502C analog pH module → GPIO 34 | `esp32_firmware.ino:160`, `docs/Methodology.md` |
| Pump | Relay module on GPIO 32 (HIGH = ON, LOW at boot) switching a small refill pump on the drum. Does **not** control MSU's real reservoir pumps | `esp32_firmware.ino:158-159` (`PUMP_RELAY_ENABLED 1`) |
| Network | W5500 Ethernet over SPI (SCK 18, MISO 19, MOSI 23, CS 5, INT 4, RST 14) primary; ESP32 Wi-Fi hot-standby backup | `esp32_firmware.ino:88-95` |
| Tanks in software | Tanks 1–4 built in; any ID 1–999 can be added; no limit | `constants.ts:35,42` |

## 4. Software

| Layer | Technology | Proof |
|---|---|---|
| Firmware | Arduino C++ on ESP32 (Arduino core 3.x), FreeRTOS tasks; uploaded over USB | `backend/firmware/` |
| Firmware → cloud | HTTPS REST to Firebase Realtime Database (5 s read timeout, 10 s TLS handshake limit) | `esp32_firmware.ino:397-398` |
| Database | Firebase Realtime Database (live data, config, history, logs, notifications, roles); Cloud Firestore (user profiles, name directory) | `backend/cloud/database.rules.json`, `firestore.rules` |
| Auth / security | Firebase Authentication; role-based rules (admin, worker, viewer, device); Firebase App Check (reCAPTCHA v3) on the web app | `database.rules.json`, `frontend/src/config/firebase.ts:3,37` |
| Web app | React 18 + TypeScript 5.8 + Vite 5 + Tailwind CSS 3 + shadcn/ui; Recharts; React Router 6; TanStack Query 5; ExcelJS, jsPDF (exports) | root `package.json` |
| Hosting | Firebase Hosting, https://msu-water-monitoring-system.web.app | `firebase.json` |
| Alert Service (worker) | Node.js + TypeScript (`tsx`), `firebase-admin` 13; on Render free Web Service, kept awake by UptimeRobot and cron-job.org | `backend/worker/` |
| Push | Firebase Cloud Messaging (FCM), sent by the Alert Service | `backend/worker/src/index.ts:226` |
| Android app | Capacitor 8 (`com.watersystem.msu`) wrapping the hosted web app; push, filesystem, share, splash plugins; sideloaded APK, no Play Store; no iOS app | `mobile/`, `capacitor.config.ts` |
| Tests | Vitest: 41 files, **309 tests**, all passing (run 26 Nov 2026) | `frontend/src/test/` |
| Cost | Free tiers only (no paid Firebase plan, no Play Store fee) | `CLAUDE.md` |

## 5. Data flow

Sensors → ESP32 (filter + pump logic) → RTDB `/tanks/{id}`, `/logs`, `/history/tanks/{id}`; ESP32 reads `/config` and
commands every 1 s → web app / APK listen live → Alert Service writes `/notifications` and sends FCM push.
The pump decision runs on the ESP32, not in the cloud.

## 6. Numbers (thresholds, intervals, units)

| Item | Value | Proof |
|---|---|---|
| Low level (pump auto start, alert) | 15 % (shared default; per-tank override allowed) | `esp32_firmware.ino:523`, `/config` |
| Overflow / high level (pump stop, alert) | 95 % | `esp32_firmware.ino:524` |
| Safe pH range | 6.5 to 8.5 | `esp32_firmware.ino:525-526` |
| Per-tank thresholds | `tanks/{id}/thresholds`, all four or none, else shared `/config` | `applyThresholds()`, `alertEngine.ts tankThresholds()` |
| Raw sampling | every 20 ms (50 Hz), each sample = 16 ADC conversions | `esp32_firmware.ino:322,1189` |
| Processing | every 200 ms; median window 5, moving average 10 | `esp32_firmware.ino:295-296,350` |
| Deadbands | level 2 %, pH 0.15 | `esp32_firmware.ino:298-299` |
| Spike rejection | pH 1.50, level 15 %; 15 stabilization samples | `esp32_firmware.ino:487-489` |
| Sensor fault | after 10 s out of range; level 0.20–3.25 V (0.30 V until 25 Nov 2026), pH 0.05–3.25 V; level also faulty if it swings ≥ 25 % within 30 s | `esp32_firmware.ino:490,497-498,507` |
| Sensor upload | on change (min 1 s apart), heartbeat every 10 s | `esp32_firmware.ino:304-305` |
| Command/config poll | every 1 s | `esp32_firmware.ino:301` |
| History sample | every 10 min (also during faults, flagged) | `esp32_firmware.ino:2527` |
| Pump anti-chatter | 30 s minimum OFF time | `esp32_firmware.ino:245` |
| Safe start after restart (Tank 1 only, 26 Nov 2026) | level calibration and pump switches kept in flash; no automatic start until they are known; relay opened within 200 ms on overflow or level fault | `saveSafetySettings()`, `loadSafetySettings()`, `sensorTask` |
| Dry-run guard | stop if level has not risen 3 % in 10 min, or after 60 min; fault kept in flash (NVS) until a manual ON | `esp32_firmware.ino:255-257`, `savePumpFault()` |
| Local alert validation | 5 s to raise, 5 s to recover, 60 s cooldown | `esp32_firmware.ino:569-571` |
| Duplicate log suppression | 5 min for an entry identical to the previous one | `esp32_firmware.ino:605` |
| Controller offline | 30 s without updates (admin can change) | `alertEngine.ts:22` |
| Alert Service | checks every 2 s, heartbeat every 10 s; dashboard flags it offline after 60 s | `worker/src/index.ts:58-59` |
| Pump command timeout (UI) | 15 s | `constants.ts:83` |
| Live calibration view | 1 reading/s, 10 min per Start, 30 min max | `constants.ts:93-94`, `esp32_firmware.ino:475` |
| Level calibration table | 2 to 20 points, 0.20–3.25 V, piecewise-linear; else Vmin/Vmax line | `esp32_firmware.ino:444-448` |
| Level formula | depth from calibration, clamped to 0…tank height; % = depth ÷ tank height × 100 | `esp32_firmware.ino:1816-1924` |
| pH formula | pH = 7.0 + (V_neutral − V_raw) / slope + offset (defaults 2.50 V, 0.18 V/pH) | `esp32_firmware.ino:1567` |
| Night watch | 10 PM–3 AM Philippine time (UTC+8); 5 % drop in 30 min → "Possible Leak or Open Faucet" (danger, push); 3 % total → "Possible Slow Leak" (warning) | `alertEngine.ts evaluateNight()` |
| Network failover | Ethernet → Wi-Fi on unplug or 3 failed/slow (> 4 s) polls; Ethernet retried every 60 s; Wi-Fi re-joined if no reply in 10 s | `esp32_firmware.ino:140-142,365-368` |
| Self-restart | no cloud contact for 3 min (doubles to 24 min max), never while pump is ON; ESP32 watchdog 30 s | `esp32_firmware.ino:54,416-417` |
| Data retention | 90 days | `worker/src/index.ts:64` |
| Units | level in % and m, volume in L, pH (unitless), voltage in V, Philippine time | |

## 7. Alerts (all in `frontend/src/lib/alertEngine.ts`, plus Controller Offline in the worker)

Low Water Level · High Water Level · Unsafe pH Level · Level Sensor Fault · pH Sensor Fault ·
Pump Stopped: Check Water Supply (dry-run) · Controller Offline · Possible Leak or Open Faucet · Possible Slow Leak ·
Night Water Loss Stopped (info). A sensor fault does not stop monitoring: readings keep coming, flagged.
Maintenance Mode (system-wide or per tank) pauses a tank's alerts, night watch and offline notice and stops its pump.

## 8. User roles and screens

| Screen (route) | Admin | Worker | Viewer | Proof |
|---|---|---|---|---|
| Login | ✓ | ✓ | ✓ | `App.tsx:53` |
| Dashboard (live tank cards, gauges, pump switch) | ✓ | ✓ (pump on assigned tank only, when lock off) | ✓ (read only) | `App.tsx:54`, rules |
| Notifications (acknowledge) | ✓ | ✓ | view | `App.tsx:58` |
| Reports (history, charts, Predictive Analytics, Pump Activity Log, Excel/PDF/CSV export) | ✓ | ✓ | – | `App.tsx:55` |
| Logs | ✓ | ✓ | – | `App.tsx:57` |
| Admin Panel: Configuration (thresholds, Pump System, pump mode, lock, maintenance, night watch), calibration (live readings, level table), Tank Assignment, User Management (with online status), Device Accounts | ✓ | – | – | `App.tsx:56`, `pages/admin/` |

Device role: one account per ESP32, writes only its own tank.

## 9. Partial or NOT implemented (the paper must not claim these as done)

- Tanks 2–4 (and added tanks): software and firmware ready, **no hardware installed** ("Planned - IoT not yet installed").
- Real Reservoir Tank No. 1: **nothing installed**; no results from it.
- Control of MSU's real submersible or inlet pumps: **not done**; only a small pump on the drum.
- pH temperature compensation, turbidity, TDS, temperature, chlorine or any other water-quality sensor: **none** (pH only).
- SMS or e-mail alerts: **none** (in-app, browser and FCM push only).
- iOS app, Play Store release: **none** (sideloaded Android APK).
- Firebase certificate check on the ESP32: **not done** (`setInsecure()`; traffic still encrypted).
- Push notifications go to every registered device, not filtered by role or tank.
- Orange Pi or any second controller: **not used**.
- Firmware with the 0.20 V limit and the stored dry-run fault (`d1c4af6`): committed; on 25 Nov it was not yet uploaded to Tank 1 and the 0.20 V database rules were not deployed (**to confirm**).
- `docs/SRS.md` and `docs/System_Overview.md` still show some old values (e.g. 0.05 V level limit); the code above wins.
