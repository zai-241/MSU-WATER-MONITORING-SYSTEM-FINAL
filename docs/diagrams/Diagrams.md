# Updated Diagrams for Chapter 3

These replace the figures that no longer match the system. Each one is written in **Mermaid**.

**To get an image for Word:**
- **Easiest:** open `docs/diagrams/diagrams.html` in your browser (double-click it). It shows every diagram with **Download SVG** and **Download PNG** buttons.
- **Or:** copy a code block into <https://mermaid.live>, then use **Actions → PNG / SVG**.

You can also redraw them in draw.io or Canva using these as the exact content.

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

---|---|
| 3-4 Proposed Operational Workflow | Readings are logged in both branches; alert service and push added |
| 3-5 System Data Processing and Logic Flowchart | Real filter stages, heartbeat, 5-second rule, alert service, push, repeat/resolve |
| 3-6 HIPO | Alert service module added; admin functions match the system |
| 3-7 IPO: IoT System | Deadband/heartbeat, pump simulation, failover, log buffer |
| 3-8 IPO: Backend Server and Application Logic | Alert service, push, offline detection, retention |
| 3-9 IPO: Web Dashboard and Mobile Application | Push, acknowledgment location, reports and exports |
| 3-10 Use Case Diagram | No Edit User / Assign Role; Worker and Viewer use cases; Alert Service actor |
| 3-11 Activity Diagram | Logging in both branches; Alert Service lane |
| 3-12 ERD | ROLES, USER_STATE, SYSTEM_WORKER; missing fields; corrected relationships |
| 3-13 Architectural Design | Alert Service, FCM, real hardware parts |
| 3-14 Network Design Topology | Wi-Fi standby link, 15–20 m test link, drum test site |

---

## Figure 3-4: Proposed Operational Workflow of MPWSD

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart TB
  subgraph IOT["IoT System (ESP32)"]
    A(["Start: 24/7 monitoring"]) --> B["Read sensor data<br/>(water level and pH)"]
    B --> C["Filter and convert readings"]
    C --> D["Log data to Firebase<br/>(on change or every 10 s)"]
    D --> E{"Level low/high or pH unsafe<br/>for 5 seconds?"}
    E -- "No" --> B
  end
  subgraph SVC["Alert Service"]
    F["Raise alert:<br/>notification + push notification"]
  end
  subgraph OP["Operator (Water Controller)"]
    G["Receive toast, chime<br/>and push notification"] --> H["Acknowledge alert<br/>(chime silenced, logged)"]
    H --> I["Perform on-site inspection"]
  end
  subgraph AD["Administrator"]
    J["Monitor dashboard<br/>and system logs"] --> K["Verify readings are<br/>back to normal"]
  end
  E -- "Yes" --> F
  F --> G
  F --> J
  I --> K
  K --> L(["End"])
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
  class A,E,L green
```

## Figure 3-5: System Data Processing and Logic Flowchart

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart TB
  S(["Start"]) --> R["Sample level and pH voltages<br/>every 20 ms"]
  R --> P["Every 200 ms: median filter (5)<br/>then moving average (10)"]
  P --> CV["Convert to height (m), level (%)<br/>and pH using calibration values"]
  CV --> BC{"Voltage outside 0.05–3.25 V<br/>or value impossible for 10 s?"}
  BC -- "Yes" --> SF["Sensor Fault: log CRITICAL,<br/>suppress that sensor's alerts"]
  SF --> R
  BC -- "No" --> SP["Spike check"]
  SP --> DB{"Changed ≥ 2% or ≥ 0.15 pH,<br/>alert state changed,<br/>or 10 s heartbeat due?"}
  DB -- "No" --> R
  DB -- "Yes" --> W["Write telemetry to Firebase<br/>(history every 10 min)"]
  W --> T{"Level < 15%, level > 95%,<br/>or pH outside 6.5–8.5?"}
  T -- "No" --> N["Normal: update dashboard cards,<br/>gauges and charts"]
  N --> R
  T -- "Yes" --> V{"Condition persists<br/>for 5 seconds?"}
  V -- "No" --> R
  V -- "Yes" --> AL["Raise alert:<br/>CRITICAL (low level, pH)<br/>WARNING (overflow)"]
  AL --> NT["Alert service creates notification<br/>and sends push notification"]
  NT --> UI["Clients show toast<br/>and play chime"]
  UI --> ACK{"Acknowledged?"}
  ACK -- "No" --> RP["Repeat every 60 s"]
  RP --> ACK
  ACK -- "Yes" --> SL["Silence chime,<br/>log acknowledgment"]
  SL --> RC{"Normal for 5 s?<br/>(level ≥ 17% / ≤ 93%,<br/>pH back in range)"}
  RC -- "No" --> RC
  RC -- "Yes" --> RS["Alert resolved,<br/>Recovered logged"]
  RS --> R
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
  class ACK,BC,DB,RC,S,T,V green
```

## Figure 3-6: Hierarchical Input-Process-Output (HIPO) Model

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart LR
  ROOT["IoT-Based Water Level and Quality<br/>Monitoring System"]
  ROOT --> M1["1.0 Data Acquisition<br/>(ESP32)"]
  ROOT --> M2["2.0 Alert Processing<br/>(Alert Service)"]
  ROOT --> M3["3.0 Monitoring and Reporting<br/>(Web and Android App)"]
  ROOT --> M4["4.0 Administration"]
  M1 --> M11["1.1 Read level and pH sensors"]
  M1 --> M12["1.2 Filter, validate and convert"]
  M1 --> M13["1.3 Send telemetry and history"]
  M1 --> M14["1.4 Ethernet / Wi-Fi failover"]
  M1 --> M15["1.5 Pump logic (simulation)"]
  M2 --> M21["2.1 Evaluate thresholds (5 s rule)"]
  M2 --> M22["2.2 Create, repeat and resolve alerts"]
  M2 --> M23["2.3 Send push notifications"]
  M2 --> M24["2.4 Detect offline controllers"]
  M2 --> M25["2.5 Delete records older than 90 days"]
  M3 --> M31["3.1 Login and role-based access"]
  M3 --> M32["3.2 Live dashboard"]
  M3 --> M33["3.3 Notifications and acknowledgment"]
  M3 --> M34["3.4 Reports and export (PDF, Excel, CSV)"]
  M3 --> M35["3.5 System logs"]
  M4 --> M41["4.1 User management"]
  M4 --> M42["4.2 Tank assignment"]
  M4 --> M43["4.3 Thresholds and alert settings"]
  M4 --> M44["4.4 Sensor calibration"]
  M4 --> M45["4.5 Maintenance mode and pump lock"]
  M4 --> M46["4.6 Device accounts"]
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
```

## Figure 3-8: IPO Model for Backend Server and Application Logic

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart LR
  I["INPUT<br/><br/>• Live telemetry from the<br/>Realtime Database<br/>• Thresholds and alert settings<br/>• User credentials and roles<br/>• Device push tokens<br/>• Controller update times"]
  P["PROCESS<br/><br/>• Firebase Authentication and<br/>role-based security rules<br/>• Alert service: 5-second threshold check<br/>• Create, repeat (60 s) and resolve alerts<br/>• Send push notifications (FCM)<br/>• Mark controllers offline after 30 s<br/>• Delete records older than 90 days<br/>• Heartbeat; clients take over if it stops"]
  O["OUTPUT<br/><br/>• Alert notifications<br/>• Push notifications to devices<br/>• Log entries (e.g. Controller Offline)<br/>• Alert service heartbeat<br/>• Cleaned-up old records"]
  I --> P --> O
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
```

## Figure 3-9: IPO Model for Web Dashboard and Mobile Application

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart LR
  I["INPUT<br/><br/>• Login (email or username, password)<br/>• Live data from Firebase listeners<br/>• User actions: acknowledge alert,<br/>change settings, calibrate,<br/>assign tanks, choose report range<br/>• Push notifications"]
  P["PROCESS<br/><br/>• Role-based routing (Admin, Worker, Viewer)<br/>• Render status cards and gauges<br/>• Toast, chime and notification center<br/>• Record acknowledgment (who, when)<br/>• Average history (hourly / daily)<br/>• Count alerts and pump runs per period<br/>• Filter and search logs"]
  O["OUTPUT<br/><br/>• Real-time status cards<br/>• Alerts with sound and push<br/>• Trend charts (level, pH)<br/>• PDF, Excel and CSV reports<br/>• Diagnostic log tables<br/>• Updated settings and calibration"]
  I --> P --> O
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
```

## Figure 3-10: Use Case Diagram

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart LR
  ADMIN(("Admin"))
  WORKER(("Worker"))
  VIEWER(("Viewer"))
  subgraph SYS["Water Level and Quality Monitoring System"]
    direction TB
    UC1(["Login"])
    UC1a(["Validate Credentials"])
    UC1b(["Check User Role"])
    UC1c(["Load Session"])
    UC2(["View Dashboard"])
    UC3(["View Notification History"])
    UC4(["Acknowledge Alert"])
    UC5(["Generate / Export Report"])
    UC6(["View System Logs"])
    UC7(["Toggle Pump (Simulation)"])
    UC8(["Manage User Account"])
    UC8a(["Add User (with Role)"])
    UC8b(["Activate / Deactivate Account"])
    UC8c(["Delete User"])
    UC9(["Configure System<br/>(thresholds, calibration,<br/>tanks, maintenance, pump lock)"])
    UC10(["Provide Data"])
    UC11(["Raise Alert"])
    UC12(["Send Push Notification"])
    UC13(["Detect Controller Offline"])
  end
  IOT(("IoT Sensors<br/>(ESP32)"))
  SVC(("Alert Service"))

  UC1 -. "«include»" .-> UC1a
  UC1 -. "«include»" .-> UC1b
  UC1 -. "«include»" .-> UC1c
  UC8a -. "«extend»" .-> UC8
  UC8b -. "«extend»" .-> UC8
  UC8c -. "«extend»" .-> UC8

  ADMIN --- UC1 & UC2 & UC3 & UC4 & UC5 & UC6 & UC7 & UC8 & UC9
  WORKER --- UC1 & UC2 & UC3 & UC4 & UC5 & UC6 & UC7
  VIEWER --- UC1 & UC2 & UC3
  UC10 --- IOT
  UC11 --- IOT
  UC11 --- SVC
  UC12 --- SVC
  UC13 --- SVC
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
  class ADMIN,WORKER,VIEWER,IOT,SVC,UC1a,UC1b,UC1c,UC8a,UC8b,UC8c green
```

Notes for the figure: Worker's **Toggle Pump** applies only to the tank assigned to them and only when the Pump Control Lock is off.

## Figure 3-11: Activity Diagram

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart TB
  subgraph L1["IoT System"]
    S(["●"]) --> A1["Read sensor data"]
    A1 --> A2["Evaluate parameters"]
    A2 --> A3["Log telemetry to database<br/>and update live dashboard"]
    A3 --> D1{"Critical value<br/>for 5 seconds?"}
    D1 -- "No" --> A1
    D1 -- "Yes" --> A4["Log alert event"]
  end
  subgraph L2["Alert Service"]
    B1["Create alert notification"] --> B2["Send push notification"]
  end
  subgraph L3["Operator"]
    C1["Receive toast, chime<br/>and push notification"] --> C2["Inspect tank status"]
    C2 --> C3["Acknowledge alert<br/>(chime silenced)"]
    C3 --> C4["Perform on-site<br/>manual inspection"]
  end
  subgraph L4["Admin"]
    E1["Receive system alert"] --> E2["Monitor real-time telemetry"]
    E2 --> E3["Inspect system diagnostic logs"]
    E3 --> E4["Verify telemetry stabilization<br/>(alert resolves after 5 s normal)"]
    E4 --> F(["◉"])
  end
  A4 --> B1
  B2 --> C1
  B2 --> E1
  C4 --> E4
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
  class D1,F,S green
```

## Figure 3-12: Entity-Relationship Diagram (ERD)

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
erDiagram
  CONFIG {
    number lowLevelThreshold
    number overflowThreshold
    number minPh
    number maxPh
    boolean maintenanceMode
    boolean pumpControlLock
    number offlineThresholdSec
    number repeatIntervalSec
    boolean soundEnabled
    boolean pushEnabled
  }
  TANKS {
    string id PK
    string name
    string location
    boolean enabled
    string assignedWorker FK
    number waterLevel
    number waterHeight
    number phLevel
    string status
    boolean pumpOn
    number levelVmin
    number levelVmax
    number tankHeight
    number levelOffset
    number phNeutralVoltage
    number phSlope
    number phOffset
    boolean levelSensorOk
    boolean phSensorOk
    string lowLevelAlert
    string highLevelAlert
    string phAlert
    number lastUpdate
    number rssi
    boolean ethConnected
    boolean wifiConnected
    boolean controllerOffline
  }
  HISTORY_TANKS {
    string id PK
    string tankId FK
    number waterLevel
    number waterHeight
    number phLevel
    boolean pumpOn
    number timestamp
  }
  USERS {
    string id PK
    string username
    string email
    string role
    string jobTitle
    string status
    number createdAt
  }
  ROLES {
    string uid PK, FK
    string role "admin, worker, viewer, device"
  }
  USER_STATE {
    string uid PK, FK
    number notificationsLastReadAt
    map notificationsReadIds
    map fcmTokens "push device tokens"
  }
  NOTIFICATIONS {
    string id PK
    string tankId FK
    string title
    string message
    string type
    number timestamp
    boolean acknowledged
    string acknowledgedBy "display name"
    string acknowledgedByUid FK
    number acknowledgedAt
    boolean resolved
    number resolvedAt
    number lastRepeatedAt
  }
  LOGS {
    string id PK
    string action
    string details
    string performedBy "name of user or component"
    string logLevel
    number timestamp
  }
  SYSTEM_WORKER {
    number lastSeen
    number startedAt
  }

  CONFIG ||--o{ TANKS : "sets thresholds for"
  TANKS ||--o{ HISTORY_TANKS : "records"
  TANKS ||--o{ NOTIFICATIONS : "raises"
  USERS |o--o{ TANKS : "is assigned"
  USERS ||--|| ROLES : "has"
  USERS ||--o| USER_STATE : "has"
  USERS |o--o{ NOTIFICATIONS : "acknowledges"
  USERS |o..o{ LOGS : "performedBy (name, not a strict key)"
```

Notes for the figure: USERS is stored in Cloud Firestore; all other entities are in the Firebase Realtime Database. SYSTEM_WORKER is the alert service's heartbeat and has no relationships.

## Figure 3-13: Architectural Design of the System

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart TB
  subgraph EDGE["Edge Tier (Physical Perception)"]
    direction LR
    LS["Hydrostatic level sensor<br/>0–5 m, 4–20 mA"] --> CVM["Current-to-voltage<br/>module"]
    CVM --> ESP["ESP32-WROOM-32<br/>filtering, alert states,<br/>pump logic"]
    PH["PH-4502C<br/>pH sensor"] --> ESP
    ESP --- LAN["LAN8720<br/>Ethernet"]
  end
  subgraph NETCLOUD["Network & Cloud Tier"]
    direction LR
    B1["TP-Link CPE210"] -. "point-to-point<br/>2.4 GHz" .-> B2["TP-Link CPE210"]
    B2 --> RT["Wireless router /<br/>Internet gateway"]
    RT --> FB[("Firebase<br/>Realtime Database · Firestore<br/>Authentication · Hosting")]
    SVC["Alert Service<br/>Node.js + Firebase Admin SDK"] <--> FB
    SVC --> FCM["Firebase Cloud<br/>Messaging"]
  end
  subgraph CLIENT["Client Tier"]
    direction LR
    WEB["Web dashboard<br/>React + Vite"]
    APP["Android app<br/>Capacitor"]
  end
  LAN -- "Cat6 / RJ45" --> B1
  ESP -. "Wi-Fi standby link" .-> RT
  FB <--> WEB
  FB <--> APP
  FCM -. "push" .-> WEB
  FCM -. "push" .-> APP
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
```

## Figure 3-14: Network Design Topology

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#CFE2FF", "primaryBorderColor": "#3B3F46", "primaryTextColor": "#111111", "lineColor": "#3B3F46", "secondaryColor": "#C3F5C3", "tertiaryColor": "#FFFFFF", "clusterBkg": "#FFFFFF", "clusterBorder": "#222222", "edgeLabelBackground": "#FFFFFF", "fontFamily": "Segoe UI, Arial, sans-serif", "fontSize": "15px", "attributeBackgroundColorOdd": "#FFFFFF", "attributeBackgroundColorEven": "#F3F6FA"}, "themeCSS": ".nodeLabel, .label, .edgeLabel, text { font-weight: 600; } .cluster-label text, .cluster-label .nodeLabel { font-weight: 700; font-size: 17px; }"}}%%
flowchart LR
  subgraph SITE["Sensor site (tested on 200 L drum model of Reservoir Tank No. 1)"]
    direction TB
    ESP["ESP32 + LAN8720<br/>(IP65 enclosure)"]
    CPE1["TP-Link CPE210<br/>(station)"]
    ESP -- "Cat6 UTP / RJ45<br/>primary link" --> CPE1
  end
  CPE1 -. "Point-to-point 2.4 GHz<br/>15–20 m during testing" .-> CPE2
  subgraph MPWSD["MPWSD network"]
    direction TB
    CPE2["TP-Link CPE210<br/>(access point)"]
    RT["Wireless router /<br/>gateway"]
    AP["2.4 GHz Wi-Fi<br/>backup access point"]
    CPE2 -- "Ethernet" --> RT
    AP --- RT
  end
  ESP -. "Wi-Fi standby link<br/>(used if Ethernet goes down)" .-> AP
  RT -- "Internet" --> FB[("Firebase Cloud")]
  SVC["Alert Service"] -- "Internet" --> FB
  FB -- "Wi-Fi / mobile data" --> U1["Admin PC / laptop"]
  FB -- "Wi-Fi / mobile data" --> U2["Android phones / tablets"]
  classDef green fill:#C3F5C3,stroke:#3B3F46,stroke-width:1.5px,color:#111111
```
