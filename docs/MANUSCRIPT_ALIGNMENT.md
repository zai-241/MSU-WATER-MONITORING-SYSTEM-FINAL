# Manuscript Alignment Plan

What to change in the capstone manuscript so it describes the finished system.

- **Rule:** the system wins. The code stays as it is; the manuscript changes.
- **Manuscript:** the Google Doc draft last modified 2026-11-12 (*IoT-Based Water Level and Quality Monitoring System for MSU Motor Pool, Main Campus Marawi City*).
- **System:** this repository at commit `1ae64a5`.

## At a glance

| # | What the manuscript gets wrong | Priority |
| :-: | :-- | :-- |
| 1 | Says the system does not control the pump. It does. | High |
| 2 | Says alerts work only while the app is open. The system has background push notifications. | High |
| 3 | Leaves out the alert service (the always-on worker). | High |
| 4 | Leaves out several working features: maintenance mode, offline detection, device accounts, security rules. | Medium |
| 5 | Has wrong numbers: thresholds, test count, Android version, telemetry rate. | Medium |
| 6 | Contradicts itself in a few places. | Medium |

**Before you start, confirm two things.** They decide how sections 1 and 2 are worded.

- [ ] **Is a real pump wired to the relay at Reservoir Tank No. 1?** The firmware switches the relay on GPIO 32 as a pump. The manuscript says the relay is only an alert indicator. Write what is physically installed.
- [ ] **Are the alert service and push notifications switched on in your Firebase project?** The code is complete, but each needs a setup step from `PHASE3_SETUP.md`. If a step was skipped, that feature is built but not deployed, and the manuscript should say so.

---

## Part 1 — Rewrite these sections

### 1. Pump control

**The system does this:**

- Starts the pump automatically when the level falls to the low threshold (15%).
- Stops the pump automatically when the level reaches the overflow threshold (95%).
- Waits at least 30 seconds after a stop before starting again.
- Forces the pump off when the level sensor is faulty or Maintenance Mode is on.
- Keeps doing all of this with no network connection.
- Lets Admins switch the pump from the dashboard. Workers can too, for their assigned tank, unless the Admin turns on Pump Control Lock.
- Logs every pump action with the reason or the user.
- Includes pump activity and total pump cycles in the reports.

**Manuscript sections to change:**

| Section | Now says | Change to |
| :-- | :-- | :-- |
| 1.4 Limitations, *Remote Pump Actuation* | The system does not control or switch pump motors. | Delete this limitation. Describe pump control under the scope instead. |
| 1.2, 1.5 | The system "does not … directly control pump operations" and only supports manual intervention. | State that it monitors **and** controls the pump, with manual override. |
| 1.3 Objectives | Develop and Implement list monitoring only. | Add automatic pump control and manual override. |
| Abstract, 5.1, 5.2 | Monitoring and alerts only. | Add one sentence on automatic pump control. |
| 5.3 Recommendation 3 | Pump control is future work. | Remove it, or narrow it to what is still missing (for example motorized valves). |
| 3.6.1 Testing locale | The 5 V relay is "used only for local visual/audible alert indicators". | Describe the relay as the pump switch. |
| 3.4.1, 3.4.6 Workflow and activity diagrams | The controller walks to the tank and operates the pump by hand. | Add the automatic pump step and the dashboard pump switch. |
| 3.4.5 Use case diagram | No pump use case. | Add "Control Pump" for Admin and Worker, and "Lock Pump Control" for Admin. |
| 3.4.7 ERD | No pump fields. | Add `pumpOn` to TANKS and HISTORY_TANKS, and `pumpControlLock` and `maintenanceMode` to CONFIG. |
| 3.4.3, 3.4.4, 3.4.8 HIPO, IPO, architecture | No actuator. | Add the relay as an output of the edge layer. |
| Table 3-5 Hardware | Relay not listed. | Add the 5 V relay module. |
| 4.1 Features | No pump section. | Add a section on automatic pump control and its safety rules. |
| 4.1.4 Reports | Water level and pH only. | Add pump activity. |

### 2. Push notifications

**The system does this:**

- Sends push notifications through Firebase Cloud Messaging when an alert starts.
- Delivers them to web browsers and to the Android app, even when the app is closed.
- Lets each user turn push on or off, and lets the Admin turn it off for everyone.
- Still shows the in-app toast and looping chime while the app is open.

**Manuscript sections to change:**

| Section | Now says | Change to |
| :-- | :-- | :-- |
| 1.4 Limitations, *Notification Channels* | Alerts appear only while the app is open. Firebase Cloud Messaging is not used. | Alerts are delivered in-app and as background push through Firebase Cloud Messaging. Keep the part about no SMS or Messenger. |
| Abstract, Introduction, 1.1, 1.2, 1.3 | "in-app toast alerts" | "in-app alerts and push notifications" |
| 5.3 Recommendation 7 | Push is future work. | Remove it. |
| Table 3-1, REQ-04 | "in-app alerts and toast notifications" | Add push notifications. |
| 2.1.4 | Alerts are shown "while the application is open". | Add background delivery. |
| 3.4.1 – 3.4.6 | Alerts go to "active web and mobile client sessions". | Add push to registered devices. |
| 4.1.3, 4.3.3 | Mobile alerts are toast and chime only. | Add the push notification, with a screenshot. |

### 3. The alert service

The manuscript says alerts are checked by "the ESP32 firmware and the client-side SystemMonitor". There is a third part it never mentions.

**The system does this:**

- Runs a small Node.js program (the alert service) on an always-on machine.
- Checks every tank against the thresholds every 2 seconds, using the same alert logic as the app.
- Detects when a controller stops reporting.
- Sends the push notifications.
- Deletes notifications, logs, and history older than 90 days.
- Writes a heartbeat every 10 seconds. If it stops for about 35 seconds, any open dashboard takes over alert checking.

**Manuscript sections to change:**

| Section | Change |
| :-- | :-- |
| 3.4.2, 3.4.3, 3.4.4.2 | Name the alert service as the main alert checker, with the app as fallback. |
| 3.4.8 Architecture, Figure 3.13 | Add the alert service to the cloud and network layer. |
| 3.4.9 Network design, Figure 3.14 | Show where the alert service runs. |
| Table 3-3 Developer software | Add Node.js and the Firebase Admin SDK. |
| Table 3-6 User hardware | Add the always-on machine that hosts the alert service. |
| 1.4 Limitations | Add: push and background alerts need the alert service to be running. |

### 4. Features the manuscript leaves out

Add these to section 4.1, and to the diagrams where noted.

- [ ] **Maintenance Mode.** An Admin switch that turns the pump off and silences alerts during servicing. Add to the use case diagram.
- [ ] **Controller offline detection.** A tank is marked offline when it has not reported for 30 seconds. The Admin can change this (minimum 20 seconds).
- [ ] **Adjustable alert repeat.** The 60-second cooldown is the default. The Admin can change it (minimum 10 seconds).
- [ ] **Sensor fault alerts.** A faulty level or pH sensor raises its own alert. The manuscript mentions fault detection but not the alert.
- [ ] **Controller (ESP32) accounts.** Each ESP32 signs in with its own account and must be registered by the Admin under a fourth role, `device`. Section 3.4.5 lists only three user roles plus the hardware actor.
- [ ] **Database security rules.** Access is enforced by role in the Realtime Database rules, using a `/roles` node. The ERD's "six core entities" leaves this out.
- [ ] **App Check.** Requests are verified with reCAPTCHA v3. One sentence under security is enough.
- [ ] **Sound controls.** Users can mute or snooze the chime.
- [ ] **Offline cache.** The app keeps the last tank readings and settings when the connection drops.
- [ ] **Logs page.** It filters by four tabs (All, Alerts, System, Errors), not by the four severity levels as 4.1.4 says.

---

## Part 2 — Correct these numbers

| Section | Manuscript says | System has |
| :-- | :-- | :-- |
| 4.1.3 | Low-level alert below **20%** | **15%** |
| 4.1.4 log examples | Warnings at 20%, 85%, pH 6.4 and 8.6; critical at 10%, pH 4.0 and 10.0 | Only 15%, 95%, and pH 6.5–8.5 exist. Rewrite the examples. |
| Table 3-3, 3.6.1 | **37** automated tests | **77** test cases in 11 files. Run `npm test` and use the number it reports. |
| Table 3-4 | Android **8.0 (API 26)** or higher | Minimum is **API 24 (Android 7.0)** |
| 4.2.1.5 | Telemetry sent every **1 second**, 86,400 packets a day | Sent on a change (at most once a second) or every **10 seconds**. Reword, or state how the test build was set. |
| 3.4.8 | Wi-Fi turns on only when Ethernet fails | Wi-Fi connects at startup and stays as a standby. Match 4.1.1. |
| 3.4.2 – 3.4.4 | 60-second cooldown, fixed | 60 seconds by default, adjustable |

## Part 3 — Fix these contradictions

These are inside the manuscript itself.

- [ ] **Respondents.** Section 3.6.1 says 3 engineers and 27 others. Section 5.1 says 15 controllers, 10 administrative staff, and 5 engineers. Use the true breakdown in both.
- [ ] **Typo.** "gllons" in 4.3.1.
- [ ] **Figures 4.1 – 4.9** are still placeholders. Take the screenshots from the finished system, including the pump switch and a push notification.

---

## Part 4 — Already correct

Leave these as they are. They were checked against the code.

**Sensor filtering**
- Sample every 20 ms, process every 200 ms.
- Median filter of 5 samples, moving average of 10.
- Sensor fault at ≤ 0.05 V or ≥ 3.25 V for 10 seconds; recovery after 3 seconds.
- Sudden jumps of 1.5 pH or 15% ignored until confirmed over 15 samples.
- Deadband of 2% level and 0.15 pH.

**Alerts**
- Thresholds: 15% low, 95% overflow, pH 6.5–8.5.
- Alerts clear at 17% and 93%.
- 5-second persistence check.
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
- Keyword search with highlighting in the logs.
- User profiles in Firestore; everything else in Realtime Database.

**Access**
- Roles: Admin, Worker, Viewer.
- Reports and Logs for Admin and Worker only; Admin Panel for Admin only.
- Only Admin and Worker can acknowledge. The name, time, and a log entry are recorded.

---

## A caution on Chapter 4 results

Pump control and push notifications become part of the stated scope and objectives, but the manuscript has no test results for them.

- [ ] Add test cases and real measurements for them (for example: pump starts at 15%, stops at 95%, push arrives with the app closed).
- [ ] Or state clearly that they were implemented but not part of the measured evaluation.

Do not reuse the existing figures for features they did not measure. The 2.34-second notification latency was measured for the in-app toast, not for push.

## Order of work

1. Confirm the two questions at the top.
2. Rewrite section 1.4 (Scope and Limitations). Everything else follows from it.
3. Update the Abstract, Chapter 1, and Chapter 5 to match.
4. Update Chapter 3: requirements table, diagrams, ERD, hardware and software tables.
5. Update Chapter 4: features, numbers, screenshots.
6. Fix Parts 2 and 3.

## Repo docs

`README.md` and the files in `docs/` already describe pump control. They are out of date on two points:

- [ ] They do not mention the alert service or push notifications.
- [ ] They say 37 tests.

## What was not checked

- The measured results in Chapter 4. These are field measurements.
- Hardware details such as the enclosure, cabling, and bridge setup.
- The diagrams, which are images. The changes listed for them are based on the text around them.
- Chapter 2, the usability tables, and the appendices, which were only keyword-searched.
- Whether the alert service, push, and App Check are switched on in the live Firebase project.
- Nothing was compiled, flashed, or run. The test count was read from the source files.
