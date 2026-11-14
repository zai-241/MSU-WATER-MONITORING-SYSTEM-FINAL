# Errors and Bugs: Work List by Group

Checked on 2026-11-14 against `main` at `2c05cd1` (the version deployed to
https://msu-water-monitoring-system.web.app). Every code item was re-checked in the current files.

The app works: 98 tests pass, the build succeeds, and Tank 1 is reporting. The items below are wrong behaviour,
security gaps, or code-quality problems.

**How to use this list:** each group can be done on its own, in any order. Tick the boxes as you go. File
references are `file:line` in the current code. After a group, run `npm test` and `npm run build`.

| Group | Topic | Items | Priority |
|---|---|---|---|
| 1 | Remove the pump simulation | 5 | High |
| 2 | Security and access | 2 | High |
| 3 | Tanks 1–4 consistency | 2 | Medium |
| 4 | Reports correctness | 2 | Medium |
| 5 | Settings and alerting | 3 | **Done** (2026-11-14) |
| 6 | Type-check and lint errors | 6 | **Done** (2026-11-14) |
| 7 | Build, performance and repo | 4 | Low |
| 8 | Thesis (paper, not code) | 8 | Before the defense |

---

## Group 1: Remove the pump simulation (High)

The thesis says the system has **no** pump control (Chapter 1.4 limitation, Chapter 5 recommendation), but the
pump simulation is still live in the app and the firmware still drives the relay. If a relay is wired, a real pump
could switch. Screenshots and exports shown to the panel would also show pump features.

- [ ] **1.1 Dashboard pump switch.** "Pump (Simulation)" toggle on each tank card (`frontend/src/pages/Dashboard.tsx:194`);
  confirm dialog that writes `pumpOn` and logs `PUMP_ON` / `PUMP_OFF` (`Dashboard.tsx:300`, `361`, `374`).
  *Fix:* remove the toggle, the dialog and `handlePumpToggle`.
- [ ] **1.2 Pump Control Lock and maintenance text.** "Pump Control Lock" switch (`frontend/src/pages/admin/Configuration.tsx:542–547`)
  and the maintenance text "Disables all pump controls…" (`Configuration.tsx:529`).
  *Fix:* remove the lock switch; reword maintenance mode to "Suppresses alerts system-wide".
- [ ] **1.3 Reports pump sections.** "Pump System (Simulation)" card (`frontend/src/pages/Reports.tsx:695`),
  "Pump Activity Logs Histogram" (`Reports.tsx:869`), "Total Pump Cycles" (`Reports.tsx:1117`), and the pump-run
  calculation that feeds them.
  *Fix:* remove the card, chart and counter.
- [ ] **1.4 Excel and PDF pump sections.** "Total Pump Cycles" rows (`frontend/src/lib/reportExport.ts:107`, `280`) and the
  "Pump Activity" sheet (`reportExport.ts:157–180`) plus the PDF pump section.
  *Fix:* remove them; update `reportsHistory.test.tsx` if it checks them.
- [ ] **1.5 Firmware pump logic and relay.** `RELAY_PIN 32` (`backend/firmware/esp32_firmware.ino:121`), automatic and manual
  pump control, `digitalWrite(RELAY_PIN, …)` (`:1640`), `pumpOn` written to the tank (`:1386`) and to history samples.
  Same code in `backend/firmware/tank2/`, `tank3/`, `tank4/`.
  *Fix:* remove the pump logic (or keep the relay pin permanently LOW) in all four sketches; re-compile each.

*Check when done:* search the code for `pump` (case-insensitive); only comments or the `pumpOn` field in old data
should remain.

## Group 2: Security and access (High)

- [ ] **2.1 Wi-Fi password in the code.** A fallback SSID and password are hard-coded in all four sketches
  (`backend/firmware/esp32_firmware.ino:16` and `:20`; same lines in `tank2/tank2.ino`, `tank3/tank3.ino`,
  `tank4/tank4.ino`) and are in the GitHub history.
  *Fix:* delete the fallback values so the sketch fails to compile without `secrets.h`, and **change the router's
  Wi-Fi password**, because the old one stays in git history.
- [ ] **2.2 Workers can change tank settings in the database.** The rules let the `worker` role write any field of
  `tanks/{id}`: calibration, capacity and assignment (`backend/cloud/database.rules.json:31`). Only the web page
  stops them.
  *Fix:* allow `worker` to write only the fields it needs (or none, once Group 1 removes pump commands), then
  `npx firebase deploy --only database`. Deploy only while the `/roles` entries exist, or the ESP32 is rejected.

## Group 3: Tanks 1–4 consistency (Medium)

- [x] **3.1 A fifth tank can be added.** Tank Assignment only checks that the ID is new
  (`frontend/src/pages/admin/TankAssignment.tsx:56`), but calibration is fixed to Tanks 1–4
  (`Configuration.tsx:56`) and there is firmware only for 1–4.
  *Fix:* allow IDs 1–4 only (or extend the Configuration selector to every registered tank).
  *Done:* `SUPPORTED_TANK_IDS` in `constants.ts`. "Register New Tank" offers only the missing IDs 1–4 (greyed out when all
  four exist), and `addTank` rejects other IDs. Configuration uses the same list.
- [x] **3.2 A deleted Tank 1–4 comes back.** On every page load an admin or worker browser recreates any missing
  Tank 1–4 (`frontend/src/store/useStore.ts:593`, `addMissingDefaultTanks`).
  *Fix:* disable "Delete" for Tanks 1–4, or seed only once (for example a `/config/tanksSeeded` flag).
  *Done:* Delete is locked for Tanks 1–4 (tooltip says to use Disable), and `deleteTank` rejects them. A stray tank
  with another ID can still be deleted. Tests in `defaultTanks.test.ts`.

## Group 4: Reports correctness (Medium)

- [x] **4.1 Fixed colour cut-offs.** Reports colours a level red below 20% and amber above 90%
  (`frontend/src/pages/Reports.tsx:619–620`, `639–640`, `995`), but the configured thresholds are 15% and 95%.
  A tank at 18% shows red in Reports with no alert.
  *Fix:* use `config.lowLevelThreshold` and `config.overflowThreshold`.
  *Done:* the level dot, the level bar and the history table use the configured thresholds with the alert engine's
  comparisons (`<` low, `>` overflow). The history table now also marks overflow rows amber.
- [x] **4.2 Offline status ignores the admin setting.** Reports always uses the 30-second default
  (`Reports.tsx:139`, `713`); the Dashboard uses the admin's offline threshold (`Dashboard.tsx:449`).
  *Fix:* pass `offlineThresholdMs(config)` as the Dashboard does.
  *Done:* both calls now pass `offlineThresholdMs(config)`.

## Group 5: Settings and alerting (Done 2026-11-14)

**Done:** all three items. **Thesis follow-up:** the Chapter 5 recommendation "Alert Service Health Notice"
says the dashboards *only* take over the checks; they now also show an "Alert Service Offline" notice (push
or email is still not sent). Section 4.1.3 and the Figure 4.9 placeholder describe the toast as a banner with
an icon; it is now also tinted (light red, amber or green).

- [x] **5.1 Misleading setting label.** "Alert Re-evaluation Interval (s) — Interval between alert evaluation passes"
  (`Configuration.tsx:470`, `478`) actually sets how often an **unacknowledged alert is shown again**; evaluation
  runs every 2 seconds.
  *Done:* renamed to "Alert Repeat Interval (s)" — "How often an unacknowledged alert is shown again".
- [x] **5.2 Nobody is told when the Alert Service stops.** Open dashboards take over the checks and the Admin Panel
  shows "Alert service: not running" (`Configuration.tsx:455`), but no push or email is sent. (The thesis lists this
  as a Chapter 5 recommendation.)
  *Done:* an open dashboard raises one "Alert Service Offline" warning after the heartbeat has been gone for 60 s
  (restarts and redeploys stay quiet), and resolves it when the heartbeat returns; the Alert Service also closes it
  when it starts (`SystemMonitor.tsx`, `alertEngine.ts` `ALERT_SERVICE_OFFLINE_ID`, `backend/worker/src/index.ts`;
  tests in `alertServiceNotice.test.tsx`). Push or email is still not sent while the service is down.
- [x] **5.3 Toasts have no colour.** The toast component is mounted without `richColors` (`frontend/src/App.tsx:17`),
  so warnings and critical alerts look the same apart from the icon. The thesis now describes it this way.
  *Done:* `richColors` is on and the toast styles no longer override it, so warnings are amber, critical alerts red and
  recoveries green. The toaster now defaults to the light theme, because the app has no dark mode
  (`App.tsx`, `components/ui/sonner.tsx`). Checked in the browser.

## Group 6: Type-check and lint errors (Done 2026-11-14)

**Now:** `npm run typecheck` 0 errors (was 14); `npm run lint` 0 errors, 0 warnings (was 83 errors, 14 warnings).

- [x] **6.1 Type-check: 14 errors in two old test files.** Fake users are missing fields and one mock has the wrong shape:
  `frontend/src/test/notificationAcknowledgment.test.ts:63, 74, 93, 118, 141, 161` and
  `frontend/src/test/reportsHistory.test.tsx:99, 147, 224, 285, 330, 386, 437, 506`.
  *Done:* fake users have `email` and `createdAt`; the mock and the anchor cast are typed.
- [x] **6.2 Lint: 78 × `no-explicit-any`.** `reportsHistory.test.tsx` 32, `Configuration.tsx` 14, `offlineController.test.ts` 6,
  `TankAssignment.tsx` 5, `AuthContext.tsx` 4, `useStore.ts` 4, `Reports.tsx` 3, `UserManagement.tsx` 3,
  `alertHistory.test.ts` 2, `DeviceAccounts.tsx` 2, `LoginPage.tsx` 2, `Notifications.tsx` 1.
  Most are `e.target.value as any` in form inputs and `catch (err: any)`.
  *Done:* the 19 `catch (err: any)` blocks use `errorMessage()` / `errorCode()` (`lib/utils.ts`); the Configuration
  form state is typed `Editable<…>` (number or typed text); `sanitizeTank` and the notification/log readers take
  `unknown` / `Partial<…>`; chart formatters take `unknown`. The 40 in test files are allowed by an ESLint override for
  `frontend/src/test/` (they mock Firebase functions).
- [x] **6.3 Lint: unnecessary escapes.** `frontend/src/pages/Logs.tsx:52` and `frontend/src/pages/Notifications.tsx:61` (`\/` in a regex).
- [x] **6.4 Lint: empty interfaces.** `frontend/src/components/ui/command.tsx:24`, `frontend/src/components/ui/textarea.tsx:5`
  (shadcn/ui files; use a `type` alias).
- [x] **6.5 Lint: `require()` import.** `frontend/tailwind.config.ts:95`.
- [x] **6.6 Lint warnings (14).** 10 × `react-refresh/only-export-components` in UI files; 2 × `react-hooks/exhaustive-deps`
  in `Configuration.tsx:87`, `93` (intentional: add a comment explaining why); 2 unused `eslint-disable` lines in
  `firebase-messaging-sw.js`.
  *Done:* shadcn/ui files are exempt from `only-export-components`; the Dashboard time helpers moved to
  `lib/formatTime.ts`; AuthContext and the two Configuration effects carry a commented disable; the unused
  directive was removed (the `dist` copy disappears on the next build).

## Group 7: Build, performance and repo (Low)

- [x] **7.1 One 3.26 MB JavaScript file** (905 KB compressed): slow first load on phones.
  *Fix:* load pages with `React.lazy`, and split `exceljs`, `jspdf`, `html2canvas` and `recharts` into separate
  chunks (`build.rollupOptions.output.manualChunks` in `frontend/vite.config.ts`).
  *Done:* pages after login load on first visit (`App.tsx`, with a one-time reload if a page file from before a
  deploy is gone). Reports loads `reportExport` (exceljs, jspdf, html2canvas) only when an export button is clicked;
  recharts goes with the Reports page. React and Firebase have their own chunks. The login screen now loads
  1.12 MB of JavaScript (290 KB compressed). Vite still warns about chunks over 500 kB: Firebase (746 kB, needed on
  every page), Reports and the export libraries (both loaded only when used).
- [x] **7.2 Lint scans the build output.** `eslint.config.js:8` ignores `dist` only at the root, so `frontend/dist` is linted.
  *Fix:* `ignores: ["**/dist"]`.
  *Done.* Lint now reports 83 errors and 13 warnings (one warning came from `frontend/dist`).
- [x] **7.3 Hosting cache in git.** `.firebase/hosting.*.cache` changes after every deploy.
  *Fix (team decision):* add `.firebase/` to `.gitignore` and `git rm --cached` the file, or keep committing it after deploys.
  *Done:* `.firebase/` is ignored and the cache files were removed from git (they stay on each PC). No need to commit after a deploy any more.
- [x] **7.4 Alert Service type check fails on this PC.** `backend/worker` dependencies are not installed here, so `tsc`
  reports `implicit any` at `backend/worker/src/index.ts:370–373`.
  *Fix:* run `npm install` in `backend/worker`, then re-run `npx tsc --noEmit`; it is expected to pass.
  *Done:* after `npm install` in `backend/worker`, `npx tsc --noEmit` passes with no errors. No code change was needed.

## Group 8: Thesis (paper, not code; before the defense)

Paragraph numbers are from `thesis-review/extract-accepted/draft.txt` (the paper with all tracked changes accepted).
In Word, search for the words instead. The full proofreading list (70 items) is in
`thesis-review/proofread-2026-11-14.md`.

- [ ] **8.1 Fill in the 11 open markers** (search Word for "[CHECK" and "[STUDENT"):
  - [p332] calibration values (0.25 V, 1.1 V, 1.5 m) for the 200-liter drum
  - [p886] how the Tank 2–4 controllers will connect to the network
  - [p917], [p993] number of tests at field deployment (37) vs today (98)
  - [p982], [p1693] where the wireless bridge was mounted in the drum-model test
  - [p1157] what the first latency time stamp marked
  - [p1158] low threshold used in the test (20%) vs the default (15%)
  - [p1201] what Trial 6 measured (an Ethernet failover logs, it shows no toast)
  - [p1317] 1–5 m test depths vs a 200-liter drum
  - [p1398] whether a 1-second test build was used
- [ ] **8.2 Numbers that disagree:**
  - grand mean 5.95 in the text ([p41], [p1677], [p1729], [p1733]) vs 5.99 in Table 4.12
  - water-level error 1.82% in the text vs 1.84% from the Table 4.4 rows
  - respondents: 3 engineers + 27 others ([p980]) vs 5 / 15 / 10 in Table 4.7 and [p1729]
  - "random sampling" ([p980]) vs "the entire workforce" ([p1450])
  - Gantt chart dates (Sept–Dec 2025) vs the title page (December 2026)
- [ ] **8.3 Duplicate caption boxes.** Figures 2.12, 3.2, 3.3, 3.4 and 3.11 each have an extra tiny text box with a
  second caption (Rectangles 1, 2, 3, 5, 7). For Figure 2.12 both print side by side. Delete the extra boxes.
- [ ] **8.4 Table of contents and lists.**
  - "References" has no TOC entry (its heading is merged into the first reference).
  - The List of Figures and List of Tables are typed text inside fields: **never press F9 on them**.
  - After accepting the tracked changes, update only the main TOC (right-click → Update Field → Page numbers only).
- [ ] **8.5 APA 7 references.**
  - "(MSU MPWSD Organizational Chart, 2025)" has no reference entry.
  - The Macarambon interview is a personal communication: cite it in text only.
  - The Davis and Rogers quotations need page numbers.
  - DOIs/URLs are missing for Burge, Raghava Rao et al., UKAD, and Pasika & Gandla.
  - Tabs split several URLs.
- [ ] **8.6 Test-condition notes.**
  - The tools list names only the pH 4.0 and 7.0 buffers ([p986]), but Table 4.5 also uses pH 10.01.
  - Tests transmitted every second, while the firmware writes on change or every 10 seconds (see [p1398]).
- [ ] **8.7 Appendix A.** The answer at [p1856] is a word-for-word copy of [p1859]; check against the recording.
- [ ] **8.8 Screenshots and panel questions.**
  - Insert the 9 "[Insert Image/Screenshot: …]" placeholders in 4.3. Crop out the pump simulation controls until Group 1 is done.
  - Be ready to explain that the heartbeat key in the Firebase console is still named `system/worker`.
