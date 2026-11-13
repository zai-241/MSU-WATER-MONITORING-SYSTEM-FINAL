# Manuscript Alignment Plan

What has to change in this repository so the system matches the latest capstone manuscript.

| | |
| :-- | :-- |
| **Source of truth** | Google Doc *"…Draft_COMMMENT1_raft_02_on_edit_copy_IOT-BASED WATER LEVEL AND QUALITY MONITORING SYSTEM FOR MSU MOTOR POOL, MAIN CAMPUS MARAWI CITY"* (most recently modified doc in Drive, 2026-11-12) |
| **Compared against** | Branch `claude/adoring-ritchie-n8di3g` at commit `1ae64a5` |
| **Direction** | The manuscript wins. Code and repo docs change to match it, except where section 4 lists a manuscript error. |

**How the comparison was done.** Manuscript sections read in full: Abstract, Chapter 1, 3.2, 3.4–3.6.2, 4.1, 4.2.1 summary and 4.2.1.5, 4.3, Chapter 5. Chapter 2, the usability tables (4.2.2) and the appendices were only keyword-searched. Figures are images and were not inspected. On the code side, constants and call sites were read in the firmware, alert engine, worker, routes, Reports and Logs pages; nothing was compiled, flashed, or run.

---

## 1. Summary

| # | Gap | Severity | Section |
| :- | :-- | :-- | :-- |
| 1 | System controls a pump; manuscript says it does not | **Blocker** | 2.1 |
| 2 | System sends background push (FCM) via an always-on worker; manuscript says in-app alerts only | **Blocker** | 2.2 |
| 3 | Repo docs (`README.md`, `docs/*.md`) describe a "Monitoring & Control" system with pump automation | **Blocker** | 2.3 |
| 4 | Android `minSdkVersion` is 24; manuscript says Android 8.0 / API 26 | Minor | 2.4 |
| 5 | Logs page filters by tab group, not by the four severity levels | Minor | 2.5 |
| 6 | Reports contain pump-activity sections | Follows from #1 | 2.1 |
| 7 | Automated test count is 77 in the repo, 37 in the manuscript | Manuscript or repo docs | 4 |
| 8 | Wi-Fi fallback SSID and password are hard-coded in the firmware source | Security, unrelated to the manuscript | 5 |

Everything in section 3 already matches and needs no work.

---

## 2. Changes required in the system

### 2.1 Remove pump control (Blocker)

**Manuscript.** Section 1.4, *Remote Pump Actuation*: the system "does not control, activate, deactivate, or automatically switch the university's physical water pump motors." Recommendation 5.3 #3 lists pump control as future work. Section 3.6.1 says the 5 V relay is "used only for local visual/audible alert indicators and threshold simulation."

**System today.** The firmware starts the relay at the low threshold and stops it at the overflow threshold, and the dashboard has a manual pump switch.

| Where | What is there now | Action |
| :-- | :-- | :-- |
| `backend/firmware/esp32_firmware.ino:1394` `processAutomaticPumpControl()` and its call at `:1687` | Auto-start at ≤ low threshold, auto-stop at ≥ overflow, 30 s anti-chatter | Remove the function and the call |
| `esp32_firmware.ino:1627` `digitalWrite(RELAY_PIN, …)` | Relay follows desired pump state | Drive the relay from the alert state instead (on while any alert is CRITICAL/WARNING), matching the "local alert indicator" wording |
| `esp32_firmware.ino:1362` `updateFirebasePumpState()`, `:1528` `pumpOn` in the telemetry payload, `:1767–1795` and `:1906` `pumpControlLock` handling, `:195–203` pump globals | Pump state synced to `/tanks/{id}/pumpOn`, remote commands honoured | Remove |
| `frontend/src/pages/Dashboard.tsx:47–213, 300–396` | Pump ON/OFF switch, confirm dialog, `PUMP_ON` / `PUMP_OFF` log entries, "Pump Control Lock" banner | Remove |
| `frontend/src/pages/admin/Configuration.tsx` | Pump Control Lock setting | Remove |
| `frontend/src/store/useStore.ts:50, 97, 152–252, 444, 616` | `pumpOn` on `Tank`, `pumpControlLock` on config | Remove the fields |
| `frontend/src/lib/reportExport.ts:17–38, 104, 153–171, 277, 333–353`, `frontend/src/pages/Reports.tsx`, `frontend/src/hooks/useTankHistory.ts:15, 59` | "Pump Activity" sheet, "Total Pump Cycles" metric, PDF section 3 | Remove. Manuscript 4.1.4 describes reports as water level and pH trend charts and tables only |
| `frontend/src/pages/admin/TankAssignment.tsx:42` | Writes `pumpOn: false` when disabling a tank | Drop the field |
| `frontend/src/test/*` (5 files mention pump) | Fixtures and assertions use `pumpOn` | Update fixtures; delete pump-specific cases |
| RTDB data | Existing `pumpOn` on tanks and history samples, `pumpControlLock` in `/config` | Delete the keys once the new firmware is flashed |

Maintenance Mode stays, but its banner text ("All pumps are disabled…") must lose the pump wording.

### 2.2 Remove background push and the alert worker (Blocker)

**Manuscript.** Section 1.4, *Notification Channels*: alerts appear "only while the web dashboard or Android application is open. The system does not use background push notifications from the operating system, such as Firebase Cloud Messaging." Recommendation 5.3 #7 lists FCM as future work. Sections 3.4.2–3.4.4 say alerts are evaluated by "the ESP32 firmware and the client-side SystemMonitor" — no server process appears in the architecture (3.4.8) or the software list (Table 3-3).

**System today.** Commit `93c0b96` added an always-on Node worker that evaluates alerts, sends FCM pushes, and applies retention; browsers defer to it while its heartbeat is fresh.

| Where | Action |
| :-- | :-- |
| `backend/worker/` (whole folder) | Remove from the deployed system. Recommended: move it to a `future/` branch rather than delete it, since it is exactly recommendation 5.3 #7 |
| `frontend/src/utils/push.ts`, `frontend/public/firebase-messaging-sw.js` | Remove |
| Push enable/disable UI (search `enablePush`, `getPushStatus`) | Remove |
| `@capacitor/push-notifications` in `package.json`; `google-services` / FCM entries under `mobile/android` | Remove, then `npm run cap:sync` |
| `frontend/src/components/SystemMonitor.tsx`, `frontend/src/lib/constants.ts` (`WORKER_STALE_MS`) | Make the browser the only evaluator; delete the "worker is alive, stand down" path |
| `backend/cloud/database.rules.json` `/system`, `/userState` (push tokens) | Remove the nodes that only the worker or push used |
| Root `package.json` scripts `worker`, `worker:check`, `worker:install`, `worker:setup` | Remove |
| `PHASE3_SETUP.md`, `WEB_NOTIFICATION_RECOMMENDATIONS.md` | Move to the same `future/` branch or delete |

**Keep:** the pure state machine in `frontend/src/lib/alertEngine.ts` (5 s persistence, 60 s repeat, NORMAL/WARNING/CRITICAL/RECOVERED) — the manuscript describes exactly this. Retention must still happen without the worker: the admin-triggered 90-day cleanup already in `Reports.tsx:166–200` covers history; confirm notifications and logs have an equivalent client path.

**App Check** (`frontend/src/config/firebase.ts`) is not mentioned in the manuscript. It is a security hardening with no user-visible behaviour, so keeping it does not contradict anything. No action.

### 2.3 Rewrite the repository docs (Blocker)

`README.md`, `docs/SRS.md`, `docs/System_Overview.md` and `docs/Methodology.md` were harmonised with the *old* codebase and now contradict the manuscript.

- Rename "MSU Water Monitoring **& Control** System" to the manuscript title.
- Delete: README "Automatic Pump Control" and "Automated Pump Protection" sections, the relay row in the hardware table ("220V AC pump power switching"), SRS FR-02 (all of 3.2), the "Offline Operation … pump refill" requirement, the pump column of the role matrix, `pumpOn` / `pumpControlLock` in the JSON examples in `Methodology.md`.
- Add the limitations from manuscript 1.4 (single-tank hardware pilot, no UPS, in-app alerts only, pH only, no pump actuation).
- Describe the relay as a local alert indicator.
- Fix the test count (see section 4).
- `docs/SRS.md:64` says Viewers cannot view notifications; the app routes Viewers to `/notifications` read-only, which matches the manuscript. Correct the SRS line.

### 2.4 Android minimum version (Minor)

Manuscript Table 3-4 and the README both say Android 8.0 (API 26). `mobile/android/variables.gradle:2` has `minSdkVersion = 24`. Set it to `26`.

### 2.5 Logs page severity filter (Minor)

Manuscript 4.1.4: users "filter diagnostic records … by severity level (INFO, WARNING, ERROR, or CRITICAL)." `frontend/src/pages/Logs.tsx:82` offers four tabs — `all`, `alerts`, `system`, `errors` — which group severities rather than select one. Replace the tabs with (or add) a four-value severity filter. Keyword search with highlighting already matches.

### 2.6 Database entities (Minor, after 2.1 and 2.2)

Manuscript 3.4.7 names six entities: TANKS, USERS, HISTORY_TANKS, LOGS, NOTIFICATIONS, CONFIG. The Realtime Database also has `/roles`, `/userState` and `/system`. After 2.2, `/system` and the push part of `/userState` disappear. `/roles` (used by the security rules, including the `device` role for the ESP32 account) remains and is not in the ERD — either add it to Figure 3.12 or leave it as an implementation detail of USERS.

Extra fields that exist but are not listed in 3.4.7, and are harmless: notifications `acknowledgedByUid`, `resolved`, `lastRepeatedAt`; config `maintenanceMode`, `repeatIntervalSec`, `offlineThresholdSec`.

---

## 3. Already aligned — no change

| Manuscript claim | Verified in |
| :-- | :-- |
| Median filter 5 samples, moving average 10 | `esp32_firmware.ino:208–209` |
| Sample every 20 ms, process every 200 ms | `:235`, `:263` |
| Fault at ≤ 0.05 V or ≥ 3.25 V for 10 s; recovery after 3 s | `:1078`, `:1156`, `:306`, `:1131`, `:1231` |
| Spike rejection: 1.5 pH / 15 % until 15 consecutive samples | `:303–305` |
| Deadband 2 % level, 0.15 pH | `:211–212` |
| Thresholds 15 % / 95 %, pH 6.5–8.5 | `:320–323`, worker and app defaults |
| Clear at 17 % / 93 % (2 % hysteresis) | `alertEngine.ts:23–24` |
| 5 s persistence, 60 s repeat cooldown | `esp32_firmware.ino:334–336`, `alertEngine.ts:17–19` |
| Alert states NORMAL / WARNING / CRITICAL / RECOVERED | `alertEngine.ts:28` |
| Low level and pH = danger, overflow = warning | `alertEngine.ts:10–13` |
| Wi-Fi retry 15 s → 30 s → 60 s; 90 s network watchdog | `esp32_firmware.ino:1277–1283`, `:273` |
| 20-entry RAM log buffer; duplicate logs suppressed 5 min | `:478`, `:370` |
| History snapshot every 10 min; 90-day retention | `:1479`, `constants.ts:21` |
| Default tank height 5.0 m; remote calibration fields | `:286–292`, `:1817–1830` |
| Log levels INFO / WARNING / ERROR / CRITICAL; "Network Alert", "Network Recovery", "Sensor Fault" actions | `:358–364`, `:727`, `:1299`, `:1097` |
| Roles admin / worker / viewer; Reports and Logs for admin + worker; Admin Panel admin-only | `frontend/src/App.tsx:21–25` |
| Only admin and worker can acknowledge; acknowledgment writes name, time and an "Alert Acknowledged" log | `NotificationCenter.tsx:47–49`, `useStore.ts:785` |
| Report ranges 7 / 14 / 30 days; hourly averages for 7, daily for 14 and 30 | `Reports.tsx:48, 212–216` |
| Export to PDF (jsPDF), Excel (ExcelJS), CSV, and browser print | `reportExport.ts:8–10`, `Reports.tsx:397–419` |
| Looping chime from the Web Audio API | `frontend/src/utils/alertSound.ts` |
| Firestore holds user profiles only; everything else in RTDB | `backend/cloud/*`, `useStore.ts` |

---

## 4. Manuscript problems to raise with the authors

These cannot be fixed in code. Either the manuscript is internally inconsistent, or changing the system to match would make it worse.

| Manuscript location | Problem | Suggested fix |
| :-- | :-- | :-- |
| 4.1.3, "5-Second Anomaly Persistence" | Gives the low-level alert threshold as "< 20.0 %". Everywhere else it is 15 %. | Change to 15 % |
| 4.1.4, WARNING and CRITICAL examples | Lists log triggers at < 20 %, > 85 %, pH 6.4 / 8.6, < 10 %, pH < 4.0 / > 10.0. None of these thresholds exist in the firmware or app; only 15 / 95 and 6.5 / 8.5 do. | Rewrite the examples using the real thresholds, or add these tiers to the system (new work, not currently planned) |
| 3.6.1 vs 5.1 | Respondents are "3 Division Engineers and 27 Water Controllers and Administrative/Support Staff" in one place and "15 Water Controllers, 10 Administrative Staff, 5 Division Engineers" in the other. | Pick the true breakdown |
| 4.2.1.5 | States telemetry was sent at 1-second intervals, 86,400 packets in 24 h. The firmware writes on a deadband change (at most once per second) or a 10-second heartbeat, so a stable tank produces about 8,640 writes a day. | Confirm how the test build was configured and reword, or state the heartbeat was set to 1 s for the test |
| 3.4.8 | Says Wi-Fi "activates only if the Ethernet link is disrupted." The firmware joins Wi-Fi at boot and keeps it as a standing backup (`esp32_firmware.ino:2137`), which is what 4.1.1 describes. | Align 3.4.8 with 4.1.1 |
| Table 3-3, 3.6.1 | "37 automated unit and integration tests." The repo has 77 test cases in 11 files (counted from source, not executed), and the number will change again after 2.1 and 2.2. | Re-run `npm test` after the code changes and put the real number in the manuscript and README |
| 4.3.1 | "16,852.25 gllons" | Typo |
| 4.3 | Figures 4.1–4.9 are still "[Insert Image…]" placeholders. | Take the screenshots **after** 2.1 and 2.2 so they show no pump switch and no push prompt |

---

## 5. Found in passing

`backend/firmware/esp32_firmware.ino:15–21` hard-codes a real-looking Wi-Fi SSID and password as fallbacks when `secrets.h` is missing. They are in git history. Replace the fallbacks with empty strings (as the Firebase ones already are) and change the access-point password.

---

## 6. Suggested order of work

1. **Firmware** — 2.1 firmware rows, section 5. Flash and bench-test that alerts still raise and the relay now follows alert state.
2. **Web and mobile app** — 2.1 app rows, 2.2, 2.4, 2.5. Run `npm run typecheck`, `npm run lint`, `npm test`, then `npm run cap:sync`.
3. **Database** — deploy the trimmed rules, delete the orphaned keys (2.1 last row, 2.6).
4. **Repo docs** — 2.3, using the final test count.
5. **Manuscript** — hand section 4 to the authors; capture the Chapter 4 screenshots from the aligned build.

## 7. Not verified

- Measured results in Chapter 4 (2.34 s latency, 1.48 s load, ±1.82 %, ±0.16 pH, failover under 3 s). These are field measurements; code can't confirm them.
- Hardware claims (IP65 enclosure, 4–20 mA sensor with shunt, Cat6 cable, CPE210 configuration).
- Diagram contents (use case, activity, ERD, architecture, network figures).
- Chapter 2, section 4.2.2 tables, and Appendices A–D beyond keyword search.
- Reviewer comments on the Google Doc: the export returned no comment threads, so if "COMMENT1" refers to feedback kept elsewhere, it is not reflected here.
