# Updated Diagrams for Chapter 3

These replace the figures that no longer match the system. They keep the design of the original thesis figures (same layout, colors, fonts, avatars and photos); only the content that was wrong changed.

**To put a figure in Word:** use the PNG in `docs/diagrams/images/` (Insert → Pictures), or open `docs/diagrams/diagrams.html` in a browser to see them all with download links.

**To change a figure:** edit `figures.mjs`, then run `node docs/diagrams/build.mjs` (one-time setup: `npm i --no-save --prefix docs/diagrams puppeteer-core`). It needs Microsoft Edge and an internet connection for the fonts.

Only the figures that contradict the system are here. Figures 3-1 to 3-3 and 3-7 already match and stay as they are.

| Figure | What is wrong in the current figure | Paper edit |
|---|---|---|
| 3-4 Proposed Operational Workflow | Alert branch skips logging; no alert service or push | 3.1 |
| 3-5 System Data Processing and Logic Flowchart | Overflow shown as CRITICAL; ESP32/SystemMonitor broadcast alerts; no push, repeat or recovery | 3.3 |
| 3-6 HIPO | No alert service module | 3.4 |
| 3-8 IPO: Backend Server and Application Logic | Alerts issued by ESP32/clients; no alert service, push, offline detection or retention | 3.4 |
| 3-9 IPO: Web Dashboard and Mobile Application | Logs exported from the Logs page; tank assignments in Firestore; no push | 3.5, 3.6 |
| 3-10 Use Case Diagram | Has Edit User / Assign Role; missing Worker and Viewer use cases; no Alert Service | 3.7–3.10 |
| 3-11 Activity Diagram | Alert branch skips logging; no Alert Service lane | 3.1 |
| 3-12 ERD | Missing ROLES, USER_STATE, SYSTEM_WORKER, fields and correct relationships | 3.11–3.13 |
| 3-13 Architectural Design | No alert service or push; sensor wiring | 3.14, 4.1 |
| 3-14 Network Design Topology | Wi-Fi "only activates" on failure; reservoir test site | 3.15, 4.28 |

**What each new figure shows**

| Figure | What changed |
|---|---|
| 3-4 Proposed Operational Workflow | Readings are logged in both branches; alert service and push added |
| 3-5 System Data Processing and Logic Flowchart | Real filter stages, heartbeat, 5-second rule, alert service, push, repeat/resolve |
| 3-6 HIPO | Alert Service added to the Process Layer; current-to-voltage module in the sensors |
| 3-8 IPO: Backend Server and Application Logic | Alert service, push, offline detection, retention |
| 3-9 IPO: Web Dashboard and Mobile Application | Push, acknowledgment location, reports and exports |
| 3-10 Use Case Diagram | No Edit User / Assign Role; Worker and Viewer use cases; Alert Service actor; no pump toggle |
| 3-11 Activity Diagram | Logging in both branches; Alert Service lane |
| 3-12 ERD | ROLES, USER_STATE, SYSTEM_WORKER; missing fields; corrected relationships; no pump fields |
| 3-13 Architectural Design | Alert Service, FCM, real hardware parts |
| 3-14 Network Design Topology | Wi-Fi standby link, 15–20 m test link, drum test site |

Pump control is out of scope (Chapter 1.4 lists Remote Pump Actuation as a limitation and Chapter 5 as future work), so no figure shows pump switching, the pump lock or pump fields, even though the code still has them.

---

## Figure 3-4: Proposed Operational Workflow of MPWSD

![Figure 3-4: Proposed Operational Workflow of MPWSD](images/Figure_3-4.png)

Adds an Alert Service lane. Readings are logged before the checks, so logging happens in both branches.

## Figure 3-5: System Data Processing and Logic Flowchart

![Figure 3-5: System Data Processing and Logic Flowchart](images/Figure_3-5.png)

Adds the change/heartbeat check, alert service, push, 60-second repeat, acknowledgment and recovery (17% / 93%).

## Figure 3-6: Hierarchical Input-Process-Output (HIPO) Model

![Figure 3-6: Hierarchical Input-Process-Output (HIPO) Model](images/Figure_3-6.png)

Adds the Alert Service to the Process Layer and the current-to-voltage module to the sensors.

## Figure 3-8: Input-Process-Output (IPO) Model for Backend Server and Application Logic

![Figure 3-8: Input-Process-Output (IPO) Model for Backend Server and Application Logic](images/Figure_3-8.png)

Alerts now come from the Alert Service; adds push, offline detection, retention and heartbeat rows.

## Figure 3-9: Input-Process-Output (IPO) Model for Web Dashboard and Mobile Application

![Figure 3-9: Input-Process-Output (IPO) Model for Web Dashboard and Mobile Application](images/Figure_3-9.png)

Adds push notifications; exports come from the Reports page; tank assignment is stored in the Realtime Database.

## Figure 3-10: Use Case Diagram for the Water Level and Quality Monitoring System

![Figure 3-10: Use Case Diagram for the Water Level and Quality Monitoring System](images/Figure_3-10.png)

Removes Edit User and Assign Role; adds View System Logs, View Notification History and the Alert Service actor.

## Figure 3-11: Activity Diagram

![Figure 3-11: Activity Diagram](images/Figure_3-11.png)

Adds an Alert Service lane; telemetry is logged before the decision.

## Figure 3-12: Entity-Relationship Diagram (ERD)

![Figure 3-12: Entity-Relationship Diagram (ERD)](images/Figure_3-12.png)

Adds ROLES, USER_STATE and SYSTEM_WORKER, the missing fields, and TANKS raises NOTIFICATIONS. No pump fields.

## Figure 3-13: Architectural Design of the System

![Figure 3-13: Architectural Design of the System](images/Figure_3-13.png)

Adds the current-to-voltage module, the CPE210 bridge pair, the Alert Service and Firebase Cloud Messaging.

## Figure 3-14: Network Design Topology

![Figure 3-14: Network Design Topology](images/Figure_3-14.png)

Wi-Fi is a standby link; the test site is the drum model; the P2P link was 15–20 m in testing; adds the Alert Service.
