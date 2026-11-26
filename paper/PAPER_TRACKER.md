# Paper Tracker

Paper: Google Doc "FINAL_CAPSTONE_PAPER_2026-11-24" (ID `1yEXorLOUeRNF9dIx8yQFLRsXXZQ6-aAuk8KJrlxgDGw`).
Edits go into the Doc as **suggestions**, and only after the wording has been approved in chat. No local .docx is edited.
System reference: [`SYSTEM_FACTS.md`](SYSTEM_FACTS.md). Paragraph numbers `[pN]` refer to the 26 Nov 2026 text export
(`thesis-review/extract-1126/draft.txt`, local only; re-export before using them, because they shift with every edit).

Last full check: **26 Nov 2026**, Doc revision `AHj4eMS5…`, code at `d1c4af6`. All 146 earlier suggestions in the Doc
had been resolved (139 accepted, 7 rejected); none were pending.

## A. Chapter Status Dashboard

| Chapter | Status | Aligned with System | Aligned with Other Chapters | Open Issues | Last Updated |
|---|---|---|---|---|---|
| Front matter (title, TOC, List of Figures/Tables) | 👤 Waiting on Us | ✅ | ✅ (List of Figures entries now match the captions) | 2 (column widths; page numbers + TOC refresh) | 2026-11-26 |
| Abstract | ✅ Done | ✅ | ✅ | 0 | 2026-11-26 |
| Ch 1 Introduction | ✅ Done | ✅ | ✅ | 0 | 2026-11-26 |
| Ch 2 Review of Related Literature and Systems | ✅ Done | ✅ | ✅ | 0 | 2026-11-26 |
| Ch 3 Methodology | ✅ Done | ✅ | ✅ | 0 | 2026-11-26 |
| Ch 4 Results and Discussion | 👤 Waiting on Us | ✅ | ✅ | 1 (D-01 pH test date) | 2026-11-26 |
| Ch 5 Summary, Conclusion, Recommendations | 👤 Waiting on Us | ✅ | ✅ | 1 (M-04, after D-01) | 2026-11-26 |
| References | ✅ Done | n/a | ✅ (every citation listed, every entry cited) | 0 | 2026-11-26 |
| Appendices | ✅ Done | ✅ | ✅ | 0 | 2026-11-26 |

Structure note: the paper follows its own CICS capstone template (Ch 1 = Project Context, Purpose and Description,
Objectives, Scope and Limitations, Significance; Ch 2 = Related Concepts, Theories, Systems, Technical Background).
It has no Statement of the Problem, Conceptual Framework or Definition of Terms. These were **not** added; ask the
adviser only if the template requires them.

## B. Done Log

**Abstract**
- Checked against `SYSTEM_FACTS.md`: hardware, pilot drum vs Reservoir Tank No. 1, alerts, results (0.21 s, 2.64/1.36 s,
  ±0.16 pH, 4.8 %, 144/144, 0.7 s and 1.6–8.3 s failover, USE means). All match Ch 4 and Ch 5.

**Ch 1**
- 1.1–1.5 checked: four built-in tanks + admin can add (IDs 1–999), only Tank 1 has hardware, relay pump on the drum
  only, 30 s offline default, 15 %/95 % pump thresholds, dry-run guard (3 % in 10 min, 60 min), night watch 10 PM–3 AM,
  no SMS/iOS/ML, pH only. All match the code.
- Each of the 5 specific objectives has a method in Ch 3, a result in Ch 4 and a conclusion in Ch 5.

**Ch 2**
- Every in-text citation has a reference entry and every reference is cited.
- Research gap (Table 2.1, 2.3) matches what the system does (hydrostatic sensor vs ultrasonic, Ethernet + Wi-Fi failover, no SMS).

**Ch 3**
- Filter pipeline numbers (median 5, average 10, 16-sample oversampling, 10 s fault, 3 s recovery, 1.5 pH / 15 % spike,
  25 %/30 s instability, 2 % / 0.15 pH deadband, 10 s heartbeat, ≤ 1 write/s) match the firmware, except M-01.
- Respondents (N = 30, total enumeration) and the USE Questionnaire match Ch 4.
- Test suite count (309 tests) matches `npm test` on 26 Nov 2026.

**Ch 4**
- Network failover, self-restart (3 min, doubling to 24 min, never while the pump runs), pump rules and logs match the firmware.
- Figure and table captions are numbered in order and every one is referred to in the text.

**Ch 3 / Ch 4 / Ch 5 (26 Nov)**
- M-01–M-03 accepted: level fault limit now 0.20 V in 3.4.2 and 4.1.1, matching the firmware; 5.2 brackets merged.

**Ch 5**
- Recommendations list only features the system does not have (reservoir deployment, Tanks 2–4 hardware, solar,
  real pump control, turbidity/TDS/temperature, ML and flow meters, GSM SMS, iOS).

**Ch 2 (26 Nov)**
- S-01 closed: the Rogers (1995) quote is on p. 5 of the 4th edition, as cited.

**References**
- All 37 entries checked on 26 Nov 2026: every DOI is registered (doi.org handle API) and every URL loads, except
  sites that block automated checks (see F).

**Earlier work (before this tracker):** 23–25 Nov 2026 section-by-section and code checks; fixes A1–A16 accepted.
Records in `thesis-review/final-check-2026-11-25.md` and `thesis-review/paper-review-progress-2026-11-24.md` (local).

## C. Misalignment Log

| ID | Chapter/Section | What the paper says | What the system/other chapter says | Fix applied or proposed | Status |
|---|---|---|---|---|---|
| M-01 | Ch 3, 3.4.2 System Data Processing Algorithm [p755] | Fault when the input "stays at or below 0.30V for the level sensor" | `LEVEL_MIN_VALID_VOLTAGE = 0.20` in all four sketches since `d1c4af6` (25 Nov 2026) | "at or below **0.30V** for the level sensor" → "at or below **0.20V** for the level sensor" | ✅ Done: accepted in the Doc 26 Nov 2026 (verified) |
| M-02 | Ch 4, 4.1.1 [p1012] | "level readings at or below 0.30 V … are treated as invalid"; "For this reason the lower limit for the level sensor is 0.30 V, while an empty drum reads about 0.389 V." | Same as M-01 | "level readings at or below **0.30 V**" → "**0.20 V**"; "the lower limit for the level sensor is **0.30 V**, while an empty drum reads about 0.389 V" → "the lower limit for the level sensor is **0.20 V**, **above the 0.14 V of a disconnected sensor and below the 0.389 V of an empty drum**" | ✅ Done: accepted in the Doc 26 Nov 2026 (verified) |
| M-03 | Ch 5, 5.2 [p1688] | "…in all 70 recorded measurements (push notifications were switched off during the test) (the longest was 0.33 seconds)." | Grammar: two parentheses in a row | → "…in all 70 recorded measurements (the longest was 0.33 seconds; push notifications were switched off during the test)." | ✅ Done: accepted in the Doc 26 Nov 2026 (verified) |
| M-04 | Ch 5, 5.2 [p1689] | "and subject to the results still to be confirmed" | The pH results are reported as final (±0.16 pH) in the Abstract, 4.2.1 and 5.1 | Delete the phrase once D-01 is filled in | Waiting on D-01 |
| M-06 | Ch 3, 3.4.2 System Data Processing Algorithm; Ch 4, 4.1 (pump control) | Check whether the pump control text says what happens after a restart | Tank 1 firmware (26 Nov 2026): calibration and pump switches kept in flash; no automatic start until they are known; the sensor task cuts the relay on overflow or level fault without waiting for the network | Proposed (optional) sentence after the overflow shutoff: "The calibration and the pump settings are also kept in the controller's flash memory, so after a power interruption the pump uses the same values even without internet, and the relay is switched off at once when the overflow level is reached." | Proposed, waiting for team approval |
| M-05 | List of Figures [p151–p189] | Figure 3.1 "Agile Methodology Cycle…"; 3.12 "Entity-Relationship Diagram (ERD)"; 3.13–3.16 shifted by one | Captions: 3.1 "Iterative and Incremental Agile Methodology Cycle…"; 3.12 Data Model…; 3.13 Data Model of the Realtime Database…; 3.14 Architectural Design; 3.15 Network Design Topology; there is no 3.16 | ✅ Done: plain table accepted 26 Nov 2026; all 36 entries match the captions (verified) |

## D. Manual Intervention Needed (with solutions)

| ID | Chapter/Section | Problem | Why Claude can't do it | Recommended solution / steps for us | Priority |
|---|---|---|---|---|---|
| MI-01 | List of Figures | Rebuilt as a borderless 2-column table (accepted 26 Nov 2026, verified: 36 entries match the captions, old generated list gone, no stray page break). Still open: the columns are split evenly, and the page numbers were carried over from the old list | Column widths cannot be set as a suggestion, and a direct edit was blocked; page numbers need the rendered pages | (1) Click inside the table → Format → Table → Table properties → Columns: column 1 = 5.94 in, column 2 = 0.56 in; (2) check page numbers in print preview, especially Figures 3.12–3.15 and Ch 4; (3) refresh the Table of Contents | High |
| MI-02 | Ch 3 Figures 3.7, 3.8, 3.9, 3.13, 3.14 | Were the 25 Nov redrawn images swapped in? | — | ✅ **Done (checked 26 Nov 2026):** the images in the Doc were downloaded and compared with `docs/diagrams/images/` and `thesis-review/figures-2026-11-25/`. All five match the new versions (calibration table, `levelCalPoints`, relay and pump photos); 3.14 is byte-identical to the 25 Nov file | — |
| MI-03 | Tank 1 hardware | The paper will describe the 0.20 V limit and the stored dry-run fault; on 25 Nov the new firmware was not on the Tank 1 ESP32 and the 0.20 V database rules were not deployed | Needs the physical board and the Firebase login | Upload `backend/firmware/esp32_firmware.ino` over USB (ESP32 core 3.x), then `npx firebase deploy --only database,firestore` | High |
| MI-04 | Signatures / approval sheet | Not checked here | Requires signatures | Collect adviser, panel and dean signatures on the approval sheet before submission | Medium |

## E. Human Data Needed

| ID | Chapter/Section | Data needed | How to collect it (instrument, respondents, procedure) | Where it goes in the paper | Placeholder tag |
|---|---|---|---|---|---|
| D-01 | Ch 4, 4.2.1 [p1092] | Date of the pH accuracy test | From the pH test record sheet (`thesis-review/pH_Sensor_Test_Record.xlsx`) or the team's notes / photo timestamps | Replace the placeholder; then remove the phrase in M-04 | `[NEEDS DATA: date of the pH accuracy test]` (already in the Doc) |
| D-02 | Appendix A, question 16 [p1807–p1808] | The real answer to "Do you think students, faculty, and staff should also have limited access to water supply information…" (it was a copy of the answer to question 17) | Supplied by the team on 26 Nov 2026 | ✅ Done: accepted in the Doc 26 Nov 2026 (verified; the copied text is gone) | none |

## F. Sources Needed / Verified

All 37 references were checked on 26 Nov 2026. ✅ = DOI registered or URL loads.

| ID | Claim in the paper | Source (APA 7th, as in the paper) | DOI/URL | Verified ✅/❌ |
|---|---|---|---|---|
| S-01 | Rogers' definition of diffusion, quoted "(p. 5)" in 2.2.2 [p359] | Rogers, E. M. (1995). *Diffusion of innovations* (4th ed.). Free Press. | book (4th ed., ISBN 0-02-926671-8; Internet Archive scan diffusionofinnov00roge_0) | ✅ Page 5 confirmed by the team in the 4th edition on 26 Nov 2026; the paper was already correct |
| S-02 | 2.1.6 wireless bridge | Mitchell, B. (2020). Wi-Fi wireless bridging explained. Lifewire. | https://www.lifewire.com/what-is-a-wireless-bridge-816540 | 🟡 Site refused the automated check (HTTP 402); open it in a browser once |
| S-03 | USE Questionnaire | Lund, A. M. (2001). Measuring usability with the USE questionnaire. *Usability Interface, 8*(2), 3–6. | no DOI (newsletter) | ✅ Standard citation for the instrument |
| S-04 | Journal articles | Dai et al. (2025), Davis (1989), Davis et al. (1989), Gubbi et al. (2013), Larman & Basili (2003), López et al. (2026), Andaya et al. (2025), Mehrotra & Musolesi (2017), Pasika & Gandla (2020), Raghava Rao et al. (2018) | DOIs in the reference list | ✅ All DOIs registered |
| S-05 | Web and documentation sources | Department of Health (2017), Espressif (2024), Firebase (n.d.-a, n.d.-b), Google Developers (2023), Flinders & Smalley, Susnjara & Smalley, Guttadauro (2026), Hoffmann (2023), Holykell, Longvista, Ionic (2023), IoT Analytics (2024), McDermand (2013), Moozakis & Kerner (2023), ThingsBoard, TP-Link (2024), USGS (2019), WHO (2023), Yasar (2024), Yasar & Gillis (2025), Abrajano et al. (2024) | URLs in the reference list | ✅ (USGS and ResearchGate block automated checks but the pages exist) |
| S-06 | PH-4502C datasheet (was open on 25 Nov) | No longer cited in the paper | n/a | ✅ Closed: no claim depends on it |

## G. Change Log

| Date | Commit/Change in system | Paper sections updated | Notes |
|---|---|---|---|
| 2026-11-24 | `200f498` multi-point level calibration | 1.4, 2.1.2, 2.1.10, 3.4.2, 4.1.1, 4.1.2, 5.3 | Done as suggestions A4–A6, A15 (25 Nov), accepted |
| 2026-11-25 | `1407143` Vmin/Vmax shown as fallback | none needed | Admin Panel detail, not described in the paper |
| 2026-11-25 | `b50ce69` Chapter 3 figures redrawn | Figures 3.7, 3.8, 3.9, 3.13, 3.14 | Image swap is manual (MI-02) |
| 2026-11-25 | `d1c4af6` dry-run fault kept in flash; level fault limit 0.30 V → 0.20 V | 3.4.2 [p755], 4.1.1 [p1012] | Dry-run wording already correct; 0.20 V proposed as M-01, M-02 |
| 2026-11-26 | (no code change) tracker and fact sheet created | none | First run of the finalization prompt |
| 2026-11-26 | (paper only) M-01–M-03 suggested in the Doc | 3.4.2, 4.1.1, 5.2 | 0.30 V → 0.20 V (3 places), 5.2 brackets; verified as suggestions |
| 2026-11-26 | (paper only) M-01–M-03 accepted by the team | 3.4.2, 4.1.1, 5.2 | Re-read the Doc: no pending suggestions, no "0.30 V" left |
| 2026-11-26 | (paper only) Appendix A question 16 answer replaced (D-02) | Appendix A | Answer text supplied by the team; suggested and accepted 26 Nov 2026 |
| 2026-11-26 | (paper only) S-01 closed | none | Rogers (1995) quote is on p. 5 of the 4th edition, as the paper says |
| 2026-11-26 | (paper only) List of Figures rebuilt as a plain table (MI-01, M-05) | Front matter | Suggested; column widths and page numbers left to the team |
| 2026-11-26 | (paper only) MI-02 checked | Ch 3 figures | Figures 3.7, 3.8, 3.9, 3.13, 3.14 in the Doc are already the redrawn versions from `b50ce69` |
| 2026-11-26 | (paper only) List of Figures table accepted | Front matter | Verified in the Doc; column widths and page numbers still to do |
| 2026-11-26 | Tank 1 firmware: calibration and pump switches kept in flash, relay safety stop in the sensor task, review fixes | 3.4.2, 4.1 (M-06, optional) | Tank 2-4 sketches not changed yet |
