# MSU Water Monitoring System - General Overview

Welcome to the comprehensive developer and operator documentation for the **Mindanao State University (MSU) Water Monitoring & Control System**. This platform provides an end-to-end IoT solution for real-time reservoir water level and pH telemetry monitoring, automatic pump protection, remote calibration, and administrative logging.

---

## 1. System Architecture & Components

The platform consists of three core operational layers:

```mermaid
graph TD
    subgraph Edge Layer (ESP32 Microcontroller)
        ESP32[ESP32 Dev Module Dual-Core 240MHz]
        LevelSensor[Hydrostatic Level Sensor] -->|Analog DC GPIO 35| ESP32
        pHSensor[pH Glass Electrode Module] -->|Analog DC GPIO 34| ESP32
        Relay[5V Optocoupled Relay] <-->|Pump Control GPIO 32| ESP32
    end

    subgraph Cloud Layer (Firebase Backend)
        RTDB[(Firebase Realtime Database)]
        Firestore[(Cloud Firestore)]
    end

    subgraph Client Layer (Cross-Platform Frontend)
        WebApp[React 18 + Vite SPA]
        MobileApp[Capacitor Native Android App]
    end

    ESP32 <-->|HTTPS REST API & Token Auth| RTDB
    RTDB <-->|Live onValue Subscriptions| WebApp
    RTDB <-->|Live onValue Subscriptions| MobileApp
    Firestore <-->|User Profiles & Auth Permissions| WebApp
    Firestore <-->|User Profiles & Auth Permissions| MobileApp
```

### 1.1 Edge Hardware Node (ESP32)
The physical edge node deployed at the reservoir site is powered by an **ESP32 Dev Module** running FreeRTOS dual-core multitasking:
* **Hydrostatic Water Level Sensor**: Submersible pressure sensor providing continuous DC voltage on **GPIO 35** (ESP32 ADC1_CH7, 12-bit resolution) mapped to water column height (0–5m).
* **pH Glass Electrode Sensor**: Industrial electrode with signal conditioner on **GPIO 34** (ESP32 ADC1_CH6, 12-bit resolution) measuring hydrogen-ion concentration (0–14 pH).
* **Pump Actuator Relay**: 5V optocoupled single-channel relay on **GPIO 32** driving the 220V AC pump (`HIGH` = Pump ON, `LOW` = Pump OFF). Protected by a 30-second anti-chatter minimum OFF cooldown. *(Note: No servo motor or mechanical valve is used).*
* **Dual Network Connectivity**: W5500 SPI Ethernet module (SCK 18, MISO 19, MOSI 23, CS 5, INT 4, RST 14) as primary wired link; 2.4GHz Wi-Fi as automatic backup with a 90-second zombie-socket watchdog.
* **Hardware Controller Note**: The deployed edge node is exclusively the ESP32 Dev Module. *(Orange Pi One: Not implemented / TO CONFIRM as an unadopted alternative).*

### 1.2 Cloud Layer (Firebase)
* **Firebase Realtime Database (RTDB)**: Serves as the primary telemetry bus. Telemetry (`/tanks/1`), system thresholds (`/config`), alarm notifications (`/notifications`), audit events (`/logs`), and 10-minute historical telemetry samples (`/history/tanks/1`) synchronize with sub-second latency.
* **Cloud Firestore**: Stores role-based operator profiles (`/users/{uid}`) with fields `id`, `username`, `email`, `role` (`admin | worker | viewer`), `jobTitle`, `status`, and `createdAt`.
* **Firebase Hosting**: Hosts the compiled React single-page production bundle.

### 1.3 Cross-Platform Client Dashboard
* **Web SPA (`frontend/`)**: React 18, TypeScript, Vite, Tailwind CSS, Radix UI, and Recharts. Includes real-time gauges, admin calibration tools, audit logs, and data exports.
* **Mobile Wrapper (`mobile/`)**: Capacitor 8 native Android wrapper compiling the same responsive web application to an APK.
* **Multi-Format Reports**: Full data export in **Excel (.xlsx)** via `exceljs`, **PDF (.pdf)** via `jspdf` & `jspdf-autotable`, and **CSV (.csv)**.

---

## 2. Directory Structure

The repository is organized into clean, modular layers:

```text
MSU-WATER-MONITORING-SYSTEM/
├── frontend/                   # React SPA web application (Vite + TypeScript)
│   ├── public/                 # Static assets (favicons, logos)
│   ├── src/                    # Application source code
│   │   ├── components/         # Reusable UI components (WaterGauge, AppLayout, etc.)
│   │   ├── config/             # Firebase SDK client initialization
│   │   ├── context/            # AuthContext and state providers
│   │   ├── hooks/              # Custom React hooks (useAuth, useUIStabilization)
│   │   ├── lib/                # Utility helpers (utils.ts)
│   │   ├── pages/              # Views (Dashboard, AdminPanel, Reports, Logs, Login)
│   │   ├── routes/             # App routing configuration
│   │   ├── services/           # Authentication and business logic services
│   │   ├── store/              # Centralized state store (useStore.ts)
│   │   └── test/               # Vitest unit & integration test suites
│   ├── index.html              # HTML entrypoint
│   ├── vite.config.ts          # Vite bundler configuration
│   ├── vitest.config.ts        # Vitest test runner configuration
│   ├── tailwind.config.ts      # Tailwind design system styling
│   └── package.json            # Frontend package scripts
├── backend/                    # Microcontroller firmware and cloud security rules
│   ├── cloud/                  # Firebase security configuration
│   │   ├── database.rules.json # Realtime Database security rules
│   │   └── firestore.rules     # Cloud Firestore security rules
│   └── firmware/               # ESP32 edge microcontroller source code
│       ├── esp32_firmware.ino  # FreeRTOS dual-core C++ Arduino firmware
│       ├── secrets.h           # Device Wi-Fi and Firebase credentials (untracked)
│       └── secrets.example.h   # Credentials template
├── mobile/                     # Cross-platform mobile project
│   ├── android/                # Capacitor Android native project files
│   └── capacitor.config.ts     # Capacitor build configuration
├── docs/                       # Project specifications & architecture documentation
│   ├── Methodology.md          # 4-stage filtering, calibration math, and database schemas
│   ├── SRS.md                  # Software Requirements Specification
│   └── System_Overview.md      # Setup guide, architecture, and operator manual
├── firebase.json               # Root Firebase deployment configuration
├── package.json                # Root package runner (dev, build, test, cap:sync)
└── README.md                   # Project overview and quick-start guide
```

---

## 3. Setup & Development Guide

### 3.1 Prerequisites
* [Node.js](https://nodejs.org/) (v18.0.0 or higher) & `npm`
* [Arduino IDE](https://www.arduino.cc/en/software) (2.x recommended) with ESP32 Board Support
* [Android Studio](https://developer.android.com/studio) (optional, for compiling Capacitor Android APK)
* Firebase Project with Realtime Database, Cloud Firestore, and Authentication enabled

### 3.2 Setting Up the Web Application
1. Navigate to the repository root:
   ```bash
   cd MSU-WATER-MONITORING-SYSTEM
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure Firebase credentials in `frontend/src/config/firebase.ts`.
4. Launch the local development server:
   ```bash
   npm run dev
   ```
   The application binds to `http://localhost:8080`.
5. Run automated unit tests:
   ```bash
   npm test
   ```
   *(Executes 37 tests across 5 test suites covering offline controllers, calibration, and stabilization).*
6. Build production bundle:
   ```bash
   npm run build
   ```
   Outputs the static bundle to `frontend/dist/`.
7. Deploy to Firebase Hosting:
   ```bash
   firebase deploy
   ```

### 3.3 Flashing the ESP32 Node
1. Open `backend/firmware/esp32_firmware.ino` in the Arduino IDE.
2. In the Arduino Boards Manager, ensure **esp32 by Espressif Systems** (v2.x or v3.x) is installed.
3. **Firmware Dependencies**: The firmware uses native ESP32 core libraries (`WiFi`, `WiFiClientSecure`, `HTTPClient`, `ETH`, `esp_task_wdt`, `FreeRTOS`). **No third-party libraries** (such as Mobizt Firebase, ArduinoJson, or ESP32Servo) are required, preserving heap for TLS operations.
4. Copy `backend/firmware/secrets.example.h` to `backend/firmware/secrets.h` and configure your credentials:
   ```cpp
   #define WIFI_SSID "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   #define FIREBASE_API_KEY "Your_Firebase_API_Key"
   #define FIREBASE_AUTH_EMAIL "esp32-device@your-domain.edu"
   #define FIREBASE_AUTH_PASSWORD "Your_Password"
   ```
5. Select **ESP32 Dev Module** as the target board, select the COM port, and click **Upload**.

### 3.4 Building the Mobile App (Capacitor Android)
1. Build the production web bundle:
   ```bash
   npm run build
   ```
2. Sync web assets to the native Android project:
   ```bash
   npm run cap:sync
   ```
3. Open the native Android project in Android Studio:
   ```bash
   npm run cap:open
   ```
4. Build the debug or release APK directly from Android Studio.

---

## 4. System Operations Guide

### 4.1 Sensor Calibration
Sensor calibration parameters can be adjusted in real time via the **Admin Panel** (`tanks/1`):
1. **Water Level Calibration**:
   - **$V_{min}$ (Empty Voltage)**: Sensor voltage when the tank is empty (default `0.25 V`).
   - **$V_{max}$ (Full Voltage)**: Sensor voltage when the tank is full (default `3.00 V`).
   - **Tank Height**: Physical height of the reservoir in meters (default `5.00 m`).
   - **Level Offset**: Fine calibration adjustment in percentage (default `0.00 %`).
2. **pH Sensor Calibration**:
   - **Neutral Voltage ($V_{neutral}$)**: Voltage reading when probe is immersed in pH 7.0 buffer solution (default `2.50 V`).
   - **Slope Sensitivity**: Voltage difference per pH unit (default `0.18 V/pH`).
   - **pH Offset**: Fine reading offset to calibrate against reference hand-held meters (default `0.00`).
3. **Live sensor readings** (no USB cable needed): choose the tank and press **Start**. The
   panel shows the level voltage, height, percentage and pH voltage once per second for 10 minutes
   (**+10 min** extends it, 30 minutes at most). Fill the tank to empty/full, press **Use as Vmin** /
   **Use as Vmax** (or **Use as pH neutral** in pH 7 buffer), then **Save All Configurations**.

### 4.2 System Modes & Safeguards
* **Automatic Pump Refill**: When water level drops $\le 15\%$ (`lowLevelThreshold`), the pump is started automatically. A 30-second anti-chatter cooldown prevents immediate restarts.
* **Overflow Protection**: When water level reaches $\ge 95\%$ (`overflowThreshold`), the pump is immediately stopped.
* **Maintenance Mode**: Activating Maintenance Mode via the Admin Panel forces the physical pump relay OFF, suppresses alarms, and prevents automatic or manual pump activation during physical maintenance.
* **Tank Maintenance (per tank)**: Admin Panel → System Controls → Tank Maintenance has one switch for each registered tank. It does the same as Maintenance Mode for that tank only (alerts, night watch and the offline notice paused; pump held off and pump commands refused), so a technician can work on one tank while the others stay monitored. The Dashboard card shows **"Under Maintenance"**.
* **Pump Control Lock**: Restricts pump manual toggles exclusively to Administrators, preventing standard Workers from activating relays.
* **Multi-Tank Infrastructure**: Tank 1 is the active IoT-connected reservoir. Tanks 2–4 are pre-configured expansion slots labeled **"Planned - IoT node not yet installed"** in the dashboard. An admin can register more tanks (Tank 5, 6, ...) in Admin Panel → Tank Assignment; each gets its own card, calibration, maintenance switch, reports and alerts, and `npm run firmware:new-tank -- <id>` makes its controller sketch.

### 4.3 Night Watch (Leak Detection)
Admin Panel > **Night Watch (Leak Detection)**. No water should be used at night, so a falling level
then means a leak or an open faucet.
* **Hours**: 10 PM to 3 AM by default (Philippine time). Change *Starts at* / *Ends at*.
* **Fast Drop**: default 5%. A drop this large within 30 minutes raises **"Possible Leak or Open Faucet"**
  (danger, push notification). It clears after the level holds for 15 minutes.
* **Total Night Drop**: default 3%. A total drop this large over the night raises **"Possible Slow Leak"**
  (warning) when the window ends.
* Values under 3% are refused (the level moves in 2% steps). The switch at the top turns it off.
* Ignored: readings while the pump runs, during a level sensor fault, during live calibration, in
  maintenance mode, and while the controller is offline.
* **What to do on an alert**: check the faucets at the tank and the outlet valve, then the pipes. The
  alert cannot tell a leak from an open faucet.

### 4.4 Predictive Analytics
Reports > **Predictive Analytics** (below the charts), for the selected tank and date range:
* **Peak hours** and **Peak day**: when water is used most, with average liters, and bar charts per hour
  and per day of the week (peaks highlighted).
* **Expected use today**: the average for today's weekday, next to the use so far today.
* **Time until 15%**: when the level is expected to reach the low threshold at the usual rate of use.
* **pH trend**: rising, falling or stable over the last 24 hours, and when it would pass a limit.
* Included in the Excel (sheet), PDF (section 3), CSV (blocks after the data) and print view.
* Needs about a day of history; it is based on averages of past use, not machine learning.
