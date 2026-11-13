# Manuscript Alignment Plan

What to change in this repository so the system matches the latest capstone manuscript.

- **Manuscript:** the Google Doc draft last modified 2026-11-12 (*IoT-Based Water Level and Quality Monitoring System for MSU Motor Pool, Main Campus Marawi City*).
- **Rule:** the manuscript wins. The code and repo docs change to match it.
- **Exception:** a few manuscript errors are listed in [Part 3](#part-3--fixes-needed-in-the-manuscript) for the authors to fix.

## At a glance

| # | What is wrong | Priority |
| :-: | :-- | :-- |
| 1 | The system controls a pump. The manuscript says it does not. | High |
| 2 | The system sends background push notifications. The manuscript says alerts are in-app only. | High |
| 3 | The repo docs still describe pump control. | High |
| 4 | Android minimum version is API 24. The manuscript says API 26. | Low |
| 5 | The Logs page cannot filter by a single severity level. | Low |
| 6 | Wi-Fi password is hard-coded in the firmware. | Security |

---

## Part 1 — Changes to the system

### 1. Remove pump control

**Manuscript (1.4, 5.3):** the system does not control, activate, or switch pump motors. Pump control is future work. The relay is only a local alert indicator.

**System now:** the firmware starts the pump at the low threshold and stops it at the overflow threshold. The dashboard has a manual pump switch.

**Firmware** — `backend/firmware/esp32_firmware.ino`

- [ ] Remove `processAutomaticPumpControl()` and the place it is called.
- [ ] Remove `updateFirebasePumpState()` and the `pumpOn` field in the telemetry payload.
- [ ] Remove the `pumpControlLock` handling and the pump variables.
- [ ] Make the relay follow the alert state (on while an alert is active).

**Web app** — `frontend/src/`

- [ ] `pages/Dashboard.tsx`: remove the pump switch, its confirm dialog, and the "Pump Control Lock" banner.
- [ ] `pages/admin/Configuration.tsx`: remove the Pump Control Lock setting.
- [ ] `store/useStore.ts`: remove `pumpOn` and `pumpControlLock`.
- [ ] `pages/admin/TankAssignment.tsx` and `hooks/useTankHistory.ts`: drop `pumpOn`.
- [ ] `lib/reportExport.ts` and `pages/Reports.tsx`: remove the "Pump Activity" sheet, the PDF pump section, and "Total Pump Cycles".
- [ ] Reword the Maintenance Mode banner so it no longer mentions pumps.
- [ ] Update the tests that use `pumpOn`.

**Database**

- [ ] After flashing the new firmware, delete `pumpOn` from tanks and history, and `pumpControlLock` from `/config`.

### 2. Remove background push and the alert worker

**Manuscript (1.4, 5.3):** alerts appear only while the web dashboard or Android app is open. Firebase Cloud Messaging is not used and is listed as future work. Alerts are checked by the ESP32 and by the app itself; there is no server process.

**System now:** an always-on Node worker checks alerts and sends push notifications. The app steps back while the worker is running.

- [ ] Take `backend/worker/` out of the system. Keep it on a separate branch, since it is the future work the manuscript recommends.
- [ ] Remove `frontend/src/utils/push.ts` and `frontend/public/firebase-messaging-sw.js`.
- [ ] Remove the push on/off controls from the app.
- [ ] Remove `@capacitor/push-notifications` from `package.json`, then run `npm run cap:sync`.
- [ ] `components/SystemMonitor.tsx`: make the app the only alert checker. Remove the "worker is alive" path and `WORKER_STALE_MS`.
- [ ] `backend/cloud/database.rules.json`: remove `/system` and the push-token part of `/userState`.
- [ ] Remove the `worker*` scripts from the root `package.json`.
- [ ] Move `PHASE3_SETUP.md` and `WEB_NOTIFICATION_RECOMMENDATIONS.md` to the same branch as the worker.

**Keep:**

- `lib/alertEngine.ts`. Its 5-second check and 60-second cooldown are exactly what the manuscript describes.
- App Check. The manuscript does not mention it, and it changes nothing the user sees.

**Check:** the worker also deleted records older than 90 days. History cleanup already runs from the Reports page. Confirm logs and notifications are still cleaned up without the worker.

### 3. Rewrite the repo docs

Files: `README.md`, `docs/SRS.md`, `docs/System_Overview.md`, `docs/Methodology.md`.

- [ ] Use the manuscript title. Drop "& Control".
- [ ] Delete every pump section, the pump requirements in the SRS (FR-02), and `pumpOn` / `pumpControlLock` in the JSON examples.
- [ ] Describe the relay as a local alert indicator.
- [ ] Add the limitations from manuscript section 1.4.
- [ ] Fix `docs/SRS.md`: Viewers can open the notifications page (read-only).
- [ ] Update the test count once the code changes are done.

### 4. Android minimum version

- [ ] `mobile/android/variables.gradle`: change `minSdkVersion` from `24` to `26` (Android 8.0).

### 5. Logs page severity filter

**Manuscript (4.1.4):** users filter logs by INFO, WARNING, ERROR, or CRITICAL.

**System now:** `pages/Logs.tsx` has four tabs (All, Alerts, System, Errors) that group severities together.

- [ ] Add a filter with the four severity levels.

### 6. Hard-coded Wi-Fi password

Not a manuscript issue, but it should be fixed. The firmware has a Wi-Fi name and password as fallback values near the top of `esp32_firmware.ino`, and they are in git history.

- [ ] Replace the fallbacks with empty strings.
- [ ] Change the password on the access point.

---

## Part 2 — Already matching

No work needed here. These were checked against the code.

**Sensor filtering**
- Sample every 20 ms, process every 200 ms.
- Median filter of 5 samples, moving average of 10.
- Sensor fault at ≤ 0.05 V or ≥ 3.25 V for 10 seconds; recovery after 3 seconds.
- Sudden jumps of 1.5 pH or 15% ignored until confirmed over 15 samples.
- Deadband of 2% level and 0.15 pH.

**Alerts**
- Thresholds: 15% low, 95% overflow, pH 6.5–8.5.
- Alerts clear at 17% and 93%.
- 5-second persistence check and 60-second cooldown.
- States: NORMAL, WARNING, CRITICAL, RECOVERED.
- Low level and pH are "danger"; overflow is "warning".
- Looping chime that stops on acknowledge.

**Network**
- Wi-Fi retries after 15, 30, then 60 seconds.
- 90-second network watchdog.
- 20 log entries buffered while offline.
- Duplicate logs suppressed for 5 minutes.

**Data and reports**
- History saved every 10 minutes and kept for 90 days.
- Report ranges of 7, 14, and 30 days.
- Export to PDF, Excel, CSV, and print.
- Four log severity levels, with keyword search and highlighting.
- User profiles in Firestore; everything else in Realtime Database.

**Access**
- Roles: Admin, Worker, Viewer.
- Reports and Logs for Admin and Worker only; Admin Panel for Admin only.
- Only Admin and Worker can acknowledge. The name, time, and a log entry are recorded.

---

## Part 3 — Fixes needed in the manuscript

These cannot be solved in code.

| Section | Problem | Fix |
| :-- | :-- | :-- |
| 4.1.3 | Low-level threshold is written as 20%. It is 15% everywhere else. | Change to 15%. |
| 4.1.4 | Log examples use thresholds that do not exist in the system (20%, 85%, 10%, pH 4.0, pH 10.0). | Rewrite using 15%, 95%, and pH 6.5–8.5. |
| 3.6.1 and 5.1 | Respondents are "3 engineers + 27 others" in one section and "15 / 10 / 5" in the other. | Use the true breakdown in both. |
| 4.2.1.5 | Says telemetry was sent every second (86,400 packets). The firmware sends on change or every 10 seconds. | Confirm how the test was run and reword. |
| 3.4.8 | Says Wi-Fi turns on only when Ethernet fails. The firmware keeps Wi-Fi connected as a standby, as 4.1.1 describes. | Match 4.1.1. |
| Table 3-3, 3.6.1 | Says 37 automated tests. The repo has 77, and the number will change after Part 1. | Run `npm test` after the changes and use that number. |
| 4.3.1 | "gllons" | Typo. |
| 4.3 | Figures 4.1–4.9 are still placeholders. | Take screenshots after Part 1, so no pump switch appears. |

---

## Order of work

1. **Firmware** — sections 1 and 6. Flash and confirm alerts still fire.
2. **App** — sections 1, 2, 4, 5. Run `npm run typecheck`, `npm run lint`, `npm test`.
3. **Database** — deploy the new rules and delete the unused keys.
4. **Repo docs** — section 3.
5. **Manuscript** — give Part 3 to the authors and take the screenshots.

## What was not checked

- The measured results in Chapter 4 (latency, accuracy, uptime, failover time). These are field measurements.
- Hardware details such as the enclosure, cabling, and bridge setup.
- The diagrams, which are images.
- Chapter 2, the usability tables, and the appendices, which were only keyword-searched.
- Reviewer comments. The Google Doc export contained none.
- Nothing was compiled, flashed, or run. The test count was read from the source files.
