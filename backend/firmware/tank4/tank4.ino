#include "secrets.h"
#include <ETH.h>
#include <SPI.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <time.h>

// ==========================================
// Required credentials (from secrets.h; copy secrets.example.h)
// ==========================================
// No fallback values: credentials must never be written in this file, because
// it is committed to git. A missing value stops the build here.
#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD)
#error "Define WIFI_SSID and WIFI_PASSWORD in secrets.h (copy secrets.example.h)"
#endif

#if !defined(FIREBASE_API_KEY) || !defined(FIREBASE_AUTH_EMAIL) || !defined(FIREBASE_AUTH_PASSWORD)
#error "Define FIREBASE_API_KEY, FIREBASE_AUTH_EMAIL and FIREBASE_AUTH_PASSWORD in secrets.h (copy secrets.example.h)"
#endif

// ==========================================
// Compile-Time Optimization Controls
// ==========================================
// Set to 1 to enable verbose debugging logs in Serial Monitor, or 0 for clean
// production operation
#define DEBUG_MODE 0

#if DEBUG_MODE
#define DEBUG_PRINT(x) Serial.print(x)
#define DEBUG_PRINTF(x, ...) Serial.printf(x, ##__VA_ARGS__)
#define DEBUG_PRINTLN(x) Serial.println(x)
#else
#define DEBUG_PRINT(x)
#define DEBUG_PRINTF(x, ...)
#define DEBUG_PRINTLN(x)
#endif

// ==========================================
// Hardware Watchdog Timeout
// If either FreeRTOS task hangs for this long, the board hard-resets.
// ==========================================
#define WDT_TIMEOUT_SECONDS 30

enum AlertState {
  STATE_NORMAL,
  STATE_WARNING,
  STATE_CRITICAL,
  STATE_RECOVERED
};

struct SystemAlert {
  const char *name;
  AlertState state;
  unsigned long abnormalStartTime;
  unsigned long normalStartTime;
  unsigned long lastLogTime;
  bool isCurrentlyAbnormal;
};

enum LogLevel { LEVEL_INFO, LEVEL_WARNING, LEVEL_ERROR, LEVEL_CRITICAL };

struct LogTracker {
  String lastAction;
  String lastDetails;
  unsigned long lastTime;
};

// ==========================================
// W5500 Ethernet (SPI) Pin Definitions
// Needs ESP32 Arduino core 3.x (ESP-IDF 5), which has the W5500 driver.
// Relay (32), pH (34) and level (35) are not shared with these pins.
// ==========================================
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(5, 0, 0)
#error "W5500 Ethernet needs ESP32 Arduino core 3.x: Tools > Board > Boards Manager > esp32 > update"
#endif
#define ETH_TYPE ETH_PHY_W5500
#define ETH_ADDR 1
#define ETH_SPI_SCK 18
#define ETH_SPI_MISO 19
#define ETH_SPI_MOSI 23
#define ETH_SPI_CS 5
#define ETH_SPI_INT 4
#define ETH_SPI_RST 14

bool ethConnected = false;
bool wifiConnected = false;
bool timeInitialized = false;

// ==========================================
// FreeRTOS Mutex for shared sensor/pump data
// Protects all variables read by networkTask and written by sensorTask.
// ==========================================
SemaphoreHandle_t sensorDataMutex = NULL;

// ==========================================
// Deferred-work flags.
// WiFi/ETH event callbacks run on the small "arduino_events" task, so they must
// NOT do HTTPS, NTP waits, or logging. They only set these flags, and
// networkTask does the heavy work.
// ==========================================
volatile bool needTimeInit = false;
volatile bool needAuth = false;
volatile bool needEthDownLog = false;
volatile bool needWifiDownLog = false;
volatile bool needEthFailover = false; // Ethernet dropped: move traffic to Wi-Fi now
volatile bool ethLinkUpPending = false; // cable is in, still waiting for an Ethernet IP
volatile unsigned long ethLinkUpAt = 0;

// Right after a link switch (Ethernet <-> Wi-Fi) the sensor upload goes out
// first, so the dashboard shows the switch as soon as possible. Until it has
// gone out (or LINK_UPLOAD_FIRST_MS has passed) command polling waits and logs
// are queued in RAM (their details keep the ESP32 local time).
bool linkUploadFirst = false;
unsigned long linkUploadFirstSince = 0;
const unsigned long LINK_UPLOAD_FIRST_MS = 5000UL; // 5s
volatile bool needEthPrimary = false;  // Ethernet got an IP: route traffic through it

// ==========================================
// Network Helper
// ==========================================
bool isNetworkConnected() { return ethConnected || wifiConnected; }

// Ethernet is the main link; Wi-Fi is the backup. Besides a cable unplug, the
// board also leaves Ethernet when it is connected but has no or slow internet:
// ETH_BAD_POLLS_TO_SWITCH polls in a row that fail or take longer than
// ETH_SLOW_POLL_MS. While on Wi-Fi for that reason (ethDegraded), Ethernet is
// tried again every ETH_RETRY_INTERVAL_MS, and at once if Wi-Fi drops.
const unsigned long ETH_SLOW_POLL_MS = 4000UL;
const int ETH_BAD_POLLS_TO_SWITCH = 3;
const unsigned long ETH_RETRY_INTERVAL_MS = 60000UL;
bool ethDegraded = false;
bool ethRetrying = false;
int ethBadPolls = 0;
unsigned long ethDegradedSince = 0;

// True when Ethernet is up and carrying the traffic.
bool ethActive() { return ethConnected && !ethDegraded; }

// ==========================================
// Sensor & Actuator Pin Definitions
// ==========================================
// Pump relay on GPIO 32: the pump logic below decides ON/OFF (automatic start at the low
// threshold, stop at overflow, dashboard commands, maintenance and lock refusals), reports
// pumpOn, and drives the relay: HIGH = pump ON, LOW = pump OFF (LOW at boot).
// Set PUMP_RELAY_ENABLED to 0 to run the pump logic without switching any pin.
#define PUMP_RELAY_ENABLED 1
#define RELAY_PIN 32
#define PH_SENSOR_PIN 34
#define LEVEL_SENSOR_PIN 35

// ==========================================
// Tank ID & Firebase Endpoints Configuration
// ==========================================
const int TANK_ID = 4;

#define FIREBASE_HOST                                                          \
  "msu-water-monitoring-system-default-rtdb.asia-southeast1.firebasedatabase." \
  "app"

String getTankBasePath() { return "/tanks/" + String(TANK_ID); }

String getHistoryBasePath() { return "/history/tanks/" + String(TANK_ID); }

String getTankBaseUrl() {
  return "https://" FIREBASE_HOST + getTankBasePath() + ".json";
}

String getHistoryBaseUrl() {
  return "https://" FIREBASE_HOST + getHistoryBasePath() + ".json";
}

const char *firebaseLogsBaseURL = "https://" FIREBASE_HOST "/logs.json";
const char *firebaseConfigBaseURL = "https://" FIREBASE_HOST "/config.json";

// Firebase Authentication State
String firebaseIdToken = "";
String firebaseRefreshToken = "";
unsigned long tokenAcquiredTime = 0;
unsigned long tokenExpiresInMs = 3600000;          // Default 1 hour
const unsigned long TOKEN_REFRESH_MARGIN = 300000; // Refresh 5 min early
bool firebaseAuthValid = false;

// Append ?auth=<idToken> to every RTDB request
String getTanksUrl() {
  String url = getTankBaseUrl();
  if (firebaseIdToken.length() > 0) {
    return url + "?auth=" + firebaseIdToken;
  }
  return url;
}

String getLogsUrl() {
  if (firebaseIdToken.length() > 0) {
    return String(firebaseLogsBaseURL) + "?auth=" + firebaseIdToken;
  }
  return String(firebaseLogsBaseURL);
}

String getConfigUrl() {
  if (firebaseIdToken.length() > 0) {
    return String(firebaseConfigBaseURL) + "?auth=" + firebaseIdToken;
  }
  return String(firebaseConfigBaseURL);
}

String getHistoryUrl() {
  String url = getHistoryBaseUrl();
  if (firebaseIdToken.length() > 0) {
    return url + "?auth=" + firebaseIdToken;
  }
  return url;
}

// Persistent TLS client for low-latency command polling with HTTP Keep-Alive
WiFiClientSecure commandClient;
bool commandClientConfigured = false;

// ==========================================
// Global Variables
// ==========================================
bool lastPumpState = false;
bool currentPumpState = false;
bool lastSentPumpState = false;
// pumpOn in tanks/{TANK_ID} is a command field: the web app writes it, and the
// ESP32 writes it only through updateFirebasePumpState() (never in the regular
// sensor upload, which would overwrite a command sent between two polls).
// While this flag is set, the ESP32's own pump state has not reached the
// database yet (boot, or a failed write), so the value there is not read as a
// command; the next poll writes the ESP32's state instead. Starting at true also
// means a leftover pumpOn=true does not restart the pump after a power cut.
bool pumpSyncPending = true;
unsigned long lastPumpStopTime = 0;
const unsigned long PUMP_MIN_OFF_TIME = 30000; // anti-chatter

// Dry-run guard: a running pump must raise the level by PUMP_MIN_RISE_PERCENT
// within PUMP_NO_RISE_TIMEOUT_MS, and may run at most PUMP_MAX_RUN_MS in one go.
// Otherwise it is stopped (empty source, closed valve, blocked pipe, pump
// running dry), tanks/{id}/pumpFault is set, and no automatic start happens
// until an operator turns the pump ON from the dashboard or the controller
// restarts. Tune both times to the pump: time a refill from the low to the
// overflow threshold and allow about 1.5 times that.
const unsigned long PUMP_NO_RISE_TIMEOUT_MS = 10UL * 60UL * 1000UL; // 10 min
const int PUMP_MIN_RISE_PERCENT = 3; // above the 2 % level deadband
const unsigned long PUMP_MAX_RUN_MS = 60UL * 60UL * 1000UL;         // 60 min
unsigned long pumpRunStartMs = 0; // when the pump last started (0 = off)
unsigned long pumpRiseRefMs = 0;  // when the level last rose by PUMP_MIN_RISE_PERCENT
int pumpRiseRefLevel = 0;         // the level at that time
String pumpFaultReason = "";      // "" | "no-rise" | "max-run" (tanks/{id}/pumpFault)

float lastPhValue = 7.0;

bool lastActualPumpState = false;

// ==========================================
// Filtering, Decoupling, and Deadband Constants
// ==========================================
const int FILTER_MEDIAN_WINDOW = 5;
const int FILTER_AVERAGE_WINDOW = 10;

const int WATER_LEVEL_DEADBAND = 2;
const float PH_LEVEL_DEADBAND = 0.15;

const unsigned long COMMAND_POLL_INTERVAL = 1000;
unsigned long lastCommandPoll = 0;

const unsigned long SENSOR_WRITE_HEARTBEAT = 10000;
const unsigned long MIN_WRITE_INTERVAL = 1000;
unsigned long lastSensorWrite = 0;

int lastSentWaterLevelPercent = -999;
float lastSentWaterHeight = -999.0;
float lastSentPhValue = -999.0;

// Shared sensor data (protected by sensorDataMutex)
int stabilizedWaterLevelPercent = -999;
float stabilizedWaterHeight = -999.0;
float stabilizedPhValue = -999.0;

// =================================================================================
// Non-Blocking Sensor Circular Buffers & Scheduler Globals
// (only used by sensorTask - no mutex needed for these)
// =================================================================================
unsigned long lastSensorSampleTime = 0;
const unsigned long SENSOR_SAMPLE_INTERVAL = 20;

float levelRawSamples[FILTER_MEDIAN_WINDOW] = {0.0};
int levelRawIndex = 0;
bool levelBufferFilled = false;
float levelAverageHistory[FILTER_AVERAGE_WINDOW] = {0.0};
int levelAverageIndex = 0;
int levelAverageCount = 0;

float phRawSamples[FILTER_MEDIAN_WINDOW] = {0.0};
int phRawIndex = 0;
bool phBufferFilled = false;
float phAverageHistory[FILTER_AVERAGE_WINDOW] = {0.0};
int phAverageIndex = 0;
int phAverageCount = 0;

// =================================================================================
// Reconnection, Robustness & Micro-Scheduling Globals
// =================================================================================
unsigned long lastWifiRetry = 0;
int wifiReconnectAttempts = 0;
unsigned long wifiRetryInterval = 15000;

bool firebaseConnected = false;
int firebaseErrorCount = 0;
unsigned long currentCommandPollInterval = COMMAND_POLL_INTERVAL;

unsigned long lastSensorProcessingTime = 0;
const unsigned long SENSOR_PROCESSING_INTERVAL = 200;

// =================================================================================
// Network Watchdog Globals
// Tracks the last time a Firebase HTTPS request succeeded. If WiFi reports
// WL_CONNECTED but all HTTPS requests keep failing for > 90 seconds, the router
// has silently deauthenticated the board (zombie socket). Force a full WiFi
// reconnect to recover.
// =================================================================================
unsigned long lastFirebaseSuccessTime = 0;
const unsigned long NETWORK_WATCHDOG_TIMEOUT = 90000UL; // 90s

// Ethernet -> Wi-Fi failover. After the cable is unplugged, Wi-Fi must reach
// Firebase within WIFI_FAILOVER_CHECK_MS, or Wi-Fi is reconnected to get a fresh
// DHCP lease (the DNS servers may still be the ones Ethernet's DHCP set).
const unsigned long WIFI_FAILOVER_CHECK_MS = 10000UL; // 10s
// While Ethernet is up, the Wi-Fi backup is kept associated (hot standby). If it
// is not, it is re-joined in the background at most this often.
const unsigned long WIFI_STANDBY_RETRY_MS = 60000UL; // 60s
bool wifiFailoverPending = false;
unsigned long wifiFailoverStart = 0;
// Set when Ethernet is lost, so its return is logged (not the first IP at boot).
bool ethWasLost = false;
unsigned long ethLostAt = 0;
// After the cable is plugged back in, the W5500 often gets no IP at all (a DHCP
// restart alone did not help in the 17 Nov 2026 test). If no IP arrives within
// this time, the W5500 driver is restarted (hardware reset through RST).
const unsigned long ETH_RESTART_WAIT_MS = 3000UL; // 3s
bool ethWaitRouted = false; // Wi-Fi pinned as the route while Ethernet has no IP

// =================================================================================
// Low-Heap Guard
// TLS handshakes require ~40 KB of contiguous internal heap. When free heap
// drops below this threshold, reset the persistent TLS commandClient before the
// allocator fails and causes a crash or hang.
// =================================================================================
const uint32_t MINIMUM_SAFE_HEAP = 60000; // bytes

// =================================================================================
// Firebase request timeouts
// At the Motor Pool a command poll often takes 1.5 to 3.8 s (logs of 13-17 Nov
// 2026), so the old 1.5 s read timeout made many uploads fail (HTTP -11) and the
// dashboard showed the controller offline. Each request is bounded: connect 5 s
// (HTTPClient default) + TLS handshake TLS_HANDSHAKE_TIMEOUT_S + read
// HTTP_TIMEOUT_MS, well under the 30 s task watchdog, which is fed before every
// request (feedWatchdog) so a loop with several slow requests does not reset it.
// =================================================================================
const uint16_t HTTP_TIMEOUT_MS = 5000;
const unsigned long TLS_HANDSHAKE_TIMEOUT_S = 10; // core default is 120 s
// A command poll slower than ETH_SLOW_POLL_MS is counted, and the count is
// logged at most once per SLOW_POLL_LOG_INTERVAL_MS (not one log per poll).
const unsigned long SLOW_POLL_LOG_INTERVAL_MS = 600000UL; // 10 min
unsigned long slowPollCount = 0;
unsigned long slowestPollMs = 0;
unsigned long lastSlowPollLog = 0;

// =================================================================================
// Last-resort restart (cloud watchdog)
// If nothing has reached Firebase for NO_CLOUD_RESTART_MS, on Ethernet or Wi-Fi,
// the board restarts itself. Before this, a stuck connection lasted until someone
// unplugged the board (outages of up to 10 h in the 16-17 Nov 2026 logs) while its
// power LED stayed on. The pump logic is local, so a running pump is never cut:
// the restart waits until the pump is OFF. If the internet stays down, the wait
// doubles after each such restart (3, 6, 12, 24 min) so the board does not keep
// restarting; the first successful request resets it to 3 min.
// =================================================================================
const unsigned long NO_CLOUD_RESTART_MS = 180000UL; // 3 min
const uint32_t NO_CLOUD_RESTART_MAX_DOUBLINGS = 3;  // 3 min x 2^3 = 24 min
unsigned long lastCloudOkTime = 0; // 0 = nothing reached Firebase since boot

// Kept in RTC memory, which survives a software or watchdog restart (not a
// power cut), so the boot log can say why the controller restarted itself.
#define RESTART_INFO_MAGIC 0x57A7E201UL
RTC_NOINIT_ATTR uint32_t rtcRestartMagic;
RTC_NOINIT_ATTR uint32_t rtcNoCloudRestarts;   // in a row, without a success
RTC_NOINIT_ATTR uint32_t rtcLastRestartWasNoCloud;
RTC_NOINIT_ATTR uint32_t rtcLastNoCloudSeconds;
bool bootReported = false;

// =================================================================================
// Sensor Calibration Parameters (adjusted dynamically via Firebase)
// =================================================================================
float levelVmin = 0.25;
float levelVmax = 3.00;
float tankHeight = 5.00;
float levelOffset = 0.00;
float phNeutralVoltage = 2.50;
float phSlope = 0.18;
float phOffset = 0.00;

// =================================================================================
// Sensor Health and Validation Status
// =================================================================================
bool phSensorOk = true;
bool levelSensorOk = true;

// =================================================================================
// Live calibration view (Admin Panel -> Calibration -> Live sensor readings)
// =================================================================================
// While tanks/{id}/calibrationUntil (epoch ms, set by an admin) is in the
// future, every sensor upload (once per second) also writes
// tanks/{id}/calibrationLive: the filtered level voltage, the unclamped height,
// the level % and the pH voltage, the same values as the [LevelCal] Serial
// Monitor line. It rides on the normal sensor upload (no extra request) and
// overwrites one small record (no history). It stops on its own at
// calibrationUntil, after CALIB_LIVE_MAX_MS even if the clock is wrong, and
// while the clock is not set yet (no NTP). Off by default.
const unsigned long CALIB_LIVE_MAX_MS = 30UL * 60UL * 1000UL;
long calibUntilSec = 0;          // tanks/{id}/calibrationUntil in seconds
unsigned long calibSeenAtMs = 0; // millis() when that value was first read
bool calibLiveWasOn = false;
volatile float liveLevelVoltage = 0.0;
volatile float liveLevelHeight = 0.0;
volatile int liveLevelPercent = 0;
volatile float livePhVoltage = 0.0;

// =================================================================================
// Sensor Validation and Stabilization Rules
// =================================================================================
const float PH_SPIKE_THRESHOLD = 1.50;
const int LEVEL_SPIKE_THRESHOLD = 15;
const int STABILIZATION_SAMPLES = 15;
const unsigned long SENSOR_FAULT_TIMEOUT = 10000;
// Unstable level signal: a disconnected or broken level sensor leaves GPIO 35
// floating, and the reading wanders across the range (e.g. 0 -> 57 -> 0 %)
// while staying inside the voltage and height bounds. If the level swings by
// LEVEL_UNSTABLE_RANGE % or more within LEVEL_STABILITY_WINDOW_S seconds, the
// reading counts as invalid (and, after SENSOR_FAULT_TIMEOUT, as a fault).
// A real 200 L drum cannot change that fast: 25 % in 30 s is about 100 L/min.
const int LEVEL_STABILITY_WINDOW_S = 30;
const int LEVEL_UNSTABLE_RANGE = 25;
// Lowest level voltage that counts as a real reading. With the 100 kOhm
// pull-down on GPIO 35 (docs/Level_Sensor_RC_Filter_Wiring.md) a disconnected
// HW-685 OUT wire is 0 V, but the ESP32 ADC reports about 0.14 V for 0 V, so
// the old 0.05 V limit never fired and only the height check (-0.5 m) caught
// it, by 12 mV on Tank 1 (20 Nov 2026). An empty tank reads at least 0.50 V
// (ZERO is never set lower), so 0.30 V is safely between the two.
const float LEVEL_MIN_VALID_VOLTAGE = 0.30;

int consecutivePhSpikes = 0;
unsigned long phFaultTimer = 0;
unsigned long phRecoveryTimer = 0;

int consecutiveLevelSpikes = 0;
unsigned long levelFaultTimer = 0;
unsigned long levelRecoveryTimer = 0;

// =================================================================================
// Alert Validation, False Alarm Prevention, and Status Handling
// =================================================================================
// Thresholds in use (pump rules and local alerts). They are this tank's own
// values (tanks/{TANK_ID}/thresholds, set by an admin in Reservoir Settings)
// when all four are present and valid, otherwise the shared ones in /config.
float lowLevelThreshold = 15.0;
float overflowThreshold = 95.0;
float minPh = 6.5;
float maxPh = 8.5;
// Shared values from /config
float sharedLowLevelThreshold = 15.0;
float sharedOverflowThreshold = 95.0;
float sharedMinPh = 6.5;
float sharedMaxPh = 8.5;
// This tank's own values (read with the 1 s command poll)
bool ownThresholdsSet = false;
float ownLowLevelThreshold = 15.0;
float ownOverflowThreshold = 95.0;
float ownMinPh = 6.5;
float ownMaxPh = 8.5;

void applyThresholds() {
  lowLevelThreshold = ownThresholdsSet ? ownLowLevelThreshold : sharedLowLevelThreshold;
  overflowThreshold = ownThresholdsSet ? ownOverflowThreshold : sharedOverflowThreshold;
  minPh = ownThresholdsSet ? ownMinPh : sharedMinPh;
  maxPh = ownThresholdsSet ? ownMaxPh : sharedMaxPh;
}
bool maintenanceMode = false; // config/maintenanceMode: all tanks
// tanks/{TANK_ID}/maintenanceMode: this tank only (set by an admin, read with the
// 1 s command poll). Either one holds the pump off and refuses pump ON commands.
bool tankMaintenanceMode = false;
bool maintenanceActive() { return maintenanceMode || tankMaintenanceMode; }
bool pumpControlLock = false;
// Pump demo mode (config/pumpDemoMode, on unless an admin turns it off): when off, the
// virtual pump stays OFF and every pump command is refused.
bool pumpDemoMode = true;
// Pump mode (config/pumpMode = "auto" | "manual"; missing or invalid = auto).
// Manual: only operator commands start the pump (no low-level auto refill); the
// safety stops (demo off, maintenance, faulty level sensor, overflow, dry-run
// guard) still apply.
bool pumpManualMode = false;
bool pumpModeLoaded = false; // false until the first /config read sets the mode

SystemAlert lowLevelAlert = {"Low Water Level", STATE_NORMAL, 0, 0, 0, false};
SystemAlert highLevelAlert = {"High Water Level", STATE_NORMAL, 0, 0, 0, false};
SystemAlert phAlert = {"Unsafe pH Level", STATE_NORMAL, 0, 0, 0, false};

AlertState lastSentLowLevelAlertState = STATE_NORMAL;
AlertState lastSentHighLevelAlertState = STATE_NORMAL;
AlertState lastSentPhAlertState = STATE_NORMAL;

const unsigned long ALERT_VALIDATION_TIME = 5000;
const unsigned long RECOVERY_VALIDATION_TIME = 5000;
const unsigned long COOLDOWN_DURATION = 60000;

String getAlertStateStr(AlertState s) {
  switch (s) {
  case STATE_NORMAL:
    return "NORMAL";
  case STATE_WARNING:
    return "WARNING";
  case STATE_CRITICAL:
    return "CRITICAL";
  case STATE_RECOVERED:
    return "RECOVERED";
  }
  return "NORMAL";
}

// =================================================================================
// Optimized Categorized Logging & Duplicate Suppression Definitions
// =================================================================================
String getLogLevelStr(LogLevel l) {
  switch (l) {
  case LEVEL_INFO:
    return "INFO";
  case LEVEL_WARNING:
    return "WARNING";
  case LEVEL_ERROR:
    return "ERROR";
  case LEVEL_CRITICAL:
    return "CRITICAL";
  }
  return "INFO";
}

LogTracker lastLoggedEvent = {"", "", 0};
const unsigned long LOG_DUPLICATE_COOLDOWN = 300000; // 5 minutes

bool shouldSuppressLog(String action, String details) {
  unsigned long now = millis();
  if (action == lastLoggedEvent.lastAction &&
      details == lastLoggedEvent.lastDetails) {
    if (now - lastLoggedEvent.lastTime < LOG_DUPLICATE_COOLDOWN) {
      return true;
    }
  }
  return false;
}

// Forward Declarations
void logSystemEvent(String action, String details, LogLevel level = LEVEL_INFO);
bool ensureFirebaseAuth();
bool firebaseSignIn();
bool firebaseRefreshTokenFunc();
String getStringFromJson(const String &json, const String &key);
String getTanksUrl();
String getLogsUrl();
String getConfigUrl();
String getHistoryUrl();
void postHistorySample();
void pushRamLog(const String &payload);
void flushRamLogBuffer();
void updateFirebasePumpState(bool pumpState);
void processAutomaticPumpControl();

// Feeds the task watchdog before a network request, but only from a task that
// is subscribed to it (networkTask); elsewhere it does nothing.
void feedWatchdog() {
  if (esp_task_wdt_status(NULL) == ESP_OK) {
    esp_task_wdt_reset();
  }
}

// Sets up a TLS client for Firebase: no certificate check (as before) and a
// bounded handshake.
void prepareTlsClient(WiFiClientSecure &client) {
  client.setInsecure();
  client.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);
}

// The persistent keep-alive TLS client, shared by command polling and the
// sensor upload (one handshake instead of a new one every upload).
WiFiClientSecure &firebaseClient() {
  if (!commandClientConfigured) {
    prepareTlsClient(commandClient);
    commandClientConfigured = true;
  }
  return commandClient;
}

// Call after every request that Firebase answered.
void markCloudOk() {
  lastFirebaseSuccessTime = millis();
  lastCloudOkTime = lastFirebaseSuccessTime;
  rtcNoCloudRestarts = 0;
}

// How long the cloud watchdog waits now (doubles after each restart in a row).
unsigned long noCloudRestartWaitMs() {
  uint32_t doublings = rtcNoCloudRestarts;
  if (doublings > NO_CLOUD_RESTART_MAX_DOUBLINGS)
    doublings = NO_CLOUD_RESTART_MAX_DOUBLINGS;
  return NO_CLOUD_RESTART_MS << doublings;
}

// Last-resort restart: see NO_CLOUD_RESTART_MS.
void checkCloudWatchdog() {
  unsigned long now = millis();
  unsigned long silentMs = now - lastCloudOkTime; // since boot if never OK
  if (silentMs < noCloudRestartWaitMs())
    return;
  if (currentPumpState)
    return; // never cut a running pump; restart once it is OFF
  Serial.printf("[CloudWatchdog] Nothing reached Firebase for %lu s. "
                "Restarting the controller.\n",
                silentMs / 1000);
  rtcRestartMagic = RESTART_INFO_MAGIC;
  rtcLastRestartWasNoCloud = 1;
  rtcLastNoCloudSeconds = silentMs / 1000;
  rtcNoCloudRestarts++;
  Serial.flush();
  ESP.restart();
}

// Readable reset reason for the boot log.
String resetReasonText(esp_reset_reason_t reason) {
  switch (reason) {
  case ESP_RST_POWERON:
    return "power-on (power restored, EN/reset button or firmware upload)";
  case ESP_RST_EXT:
    return "external reset pin";
  case ESP_RST_SW:
    return "software restart";
  case ESP_RST_PANIC:
    return "crash (panic or task watchdog)";
  case ESP_RST_INT_WDT:
    return "interrupt watchdog";
  case ESP_RST_TASK_WDT:
    return "task watchdog (a task hung for 30 s)";
  case ESP_RST_WDT:
    return "watchdog";
  case ESP_RST_BROWNOUT:
    return "brownout (supply voltage dropped: check the power supply and "
           "relay wiring)";
  case ESP_RST_DEEPSLEEP:
    return "wake from deep sleep";
  default:
    return "unknown (" + String((int)reason) + ")";
  }
}

// Logs once, after the first successful Firebase request, why the controller
// started. Abnormal restarts are logged as ERROR so they are kept in the RAM
// buffer if the log upload fails.
void reportBootReason() {
  bootReported = true;
  esp_reset_reason_t reason = esp_reset_reason();
  bool selfRestart = (reason == ESP_RST_SW &&
                      rtcRestartMagic == RESTART_INFO_MAGIC &&
                      rtcLastRestartWasNoCloud == 1);
  String details;
  LogLevel level = LEVEL_INFO;
  if (selfRestart) {
    details = "Controller restarted itself: nothing reached Firebase for " +
              String(rtcLastNoCloudSeconds / 60) + " min " +
              String(rtcLastNoCloudSeconds % 60) + " s.";
    level = LEVEL_WARNING;
  } else {
    details = "Controller started. Reset reason: " + resetReasonText(reason) +
              ".";
    if (reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT ||
        reason == ESP_RST_TASK_WDT || reason == ESP_RST_WDT ||
        reason == ESP_RST_BROWNOUT) {
      level = LEVEL_ERROR;
    }
  }
  rtcLastRestartWasNoCloud = 0;
  logSystemEvent("System Power Tracker", details, level);
}

void updateAlertState(SystemAlert &alert, bool abnormalCondition,
                      String details) {
  unsigned long now = millis();
  alert.isCurrentlyAbnormal = abnormalCondition;

  switch (alert.state) {
  case STATE_NORMAL:
    if (abnormalCondition) {
      if (alert.abnormalStartTime == 0) {
        alert.abnormalStartTime = now;
      } else if (now - alert.abnormalStartTime >= ALERT_VALIDATION_TIME) {
        if (strcmp(alert.name, "High Water Level") == 0) {
          alert.state = STATE_WARNING;
          logSystemEvent(String(alert.name) + " Alert",
                         details + " [Status: Triggered]", LEVEL_WARNING);
        } else {
          alert.state = STATE_CRITICAL;
          logSystemEvent(String(alert.name) + " Alert",
                         details + " [Status: Triggered]", LEVEL_CRITICAL);
        }
        alert.abnormalStartTime = 0;
        alert.lastLogTime = now;
      }
    } else {
      alert.abnormalStartTime = 0;
    }
    break;

  case STATE_WARNING:
  case STATE_CRITICAL:
    if (!abnormalCondition) {
      if (alert.normalStartTime == 0) {
        alert.normalStartTime = now;
      } else if (now - alert.normalStartTime >= RECOVERY_VALIDATION_TIME) {
        alert.state = STATE_RECOVERED;
        alert.normalStartTime = 0;
        alert.lastLogTime = now;
        logSystemEvent(String(alert.name) + " Alert",
                       details + " [Status: Recovered]", LEVEL_INFO);
      }
    } else {
      alert.normalStartTime = 0;
      if (now - alert.lastLogTime >= COOLDOWN_DURATION) {
        alert.lastLogTime = now;
        logSystemEvent(
            String(alert.name) + " Alert", details + " [Status: Persistent]",
            (alert.state == STATE_WARNING) ? LEVEL_WARNING : LEVEL_CRITICAL);
      }
    }
    break;

  case STATE_RECOVERED:
    alert.state = STATE_NORMAL;
    alert.abnormalStartTime = 0;
    alert.normalStartTime = 0;
    break;
  }
}

// ==========================================
// Helper: Get Formatted Time String
// ==========================================
String getTimeString() {
  if (!timeInitialized) {
    return String(millis()) + "ms";
  }
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String(millis()) + "ms";
  }
  char timeStringBuff[50];
  strftime(timeStringBuff, sizeof(timeStringBuff), "%Y-%m-%d %H:%M:%S",
           &timeinfo);
  return String(timeStringBuff);
}

// ==========================================
// RAM Ring Buffer for Offline Critical & Error Logs (20 entries)
// ==========================================
const int RAM_LOG_BUFFER_SIZE = 20;
String ramLogBuffer[RAM_LOG_BUFFER_SIZE];
int ramLogHead = 0;
int ramLogTail = 0;
int ramLogCount = 0;

void pushRamLog(const String &payload) {
  if (sensorDataMutex &&
      xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    ramLogBuffer[ramLogHead] = payload;
    ramLogHead = (ramLogHead + 1) % RAM_LOG_BUFFER_SIZE;
    if (ramLogCount < RAM_LOG_BUFFER_SIZE) {
      ramLogCount++;
    } else {
      ramLogTail = (ramLogTail + 1) % RAM_LOG_BUFFER_SIZE;
      DEBUG_PRINTLN(
          "[RamLogBuffer] 20-entry buffer full. Oldest log overwritten.");
    }
    DEBUG_PRINTF(
        "[RamLogBuffer] Buffered critical/error log. Buffer count: %d/%d\n",
        ramLogCount, RAM_LOG_BUFFER_SIZE);
    xSemaphoreGive(sensorDataMutex);
  }
}

void flushRamLogBuffer() {
  if (ramLogCount == 0)
    return;
  if (!isNetworkConnected())
    return;
  if (!ensureFirebaseAuth())
    return;

  DEBUG_PRINTF("[RamLogBuffer] Firebase reconnected. Flushing %d buffered "
               "log(s) to /logs...\n",
               ramLogCount);

  while (ramLogCount > 0) {
    if (!isNetworkConnected()) {
      DEBUG_PRINTLN("[RamLogBuffer] Network connection interrupted during "
                    "flush. Pausing.");
      break;
    }

    String payload = "";
    if (sensorDataMutex &&
        xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (ramLogCount > 0) {
        payload = ramLogBuffer[ramLogTail];
      }
      xSemaphoreGive(sensorDataMutex);
    }
    if (payload.length() == 0)
      break;

    WiFiClientSecure secureClient;
    prepareTlsClient(secureClient);
    HTTPClient http;
    http.begin(secureClient, getLogsUrl());
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    feedWatchdog(); // up to 20 buffered logs, each its own request
    int httpResponseCode = http.sendRequest("POST", payload);

    if (httpResponseCode == 401) {
      DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized during flush. "
                    "Invalidating token.");
      firebaseAuthValid = false;
      http.end();
      break;
    }

    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      DEBUG_PRINTF("[RamLogBuffer] Successfully flushed log to /logs (HTTP "
                   "%d). Remaining: %d\n",
                   httpResponseCode, ramLogCount - 1);
      if (sensorDataMutex &&
          xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        ramLogBuffer[ramLogTail] = "";
        ramLogTail = (ramLogTail + 1) % RAM_LOG_BUFFER_SIZE;
        ramLogCount--;
        xSemaphoreGive(sensorDataMutex);
      }
      http.end();
      vTaskDelay(pdMS_TO_TICKS(10));
    } else {
      DEBUG_PRINTF("[RamLogBuffer] HTTP error sending buffered log: %d. "
                   "Pausing flush.\n",
                   httpResponseCode);
      http.end();
      break;
    }
  }
}

// ==========================================
// Logging System (Firebase)
// NOTE: never call this from a WiFi/ETH event callback (it does HTTPS).
// ==========================================
void logSystemEvent(String action, String details, LogLevel level) {
  if (shouldSuppressLog(action, details)) {
    DEBUG_PRINTF("[SUPPRESSED DUPLICATE LOG] Action: %s, Details: %s\n",
                 action.c_str(), details.c_str());
    return;
  }

  lastLoggedEvent.lastAction = action;
  lastLoggedEvent.lastDetails = details;
  lastLoggedEvent.lastTime = millis();

  String logStr = "[" + getTimeString() + "] [" + getLogLevelStr(level) + "] " +
                  action + " - " + details;
  Serial.println(logStr);

  String dummyId = "esp32-" + String(millis());

  String jsonPayload;
  jsonPayload.reserve(300);

  jsonPayload = "{";
  jsonPayload += "\"id\":\"" + dummyId + "\",";
  jsonPayload += "\"action\":\"" + action + "\",";
  jsonPayload +=
      "\"details\":\"" + details + " (Local Time: " + getTimeString() + ")\",";
  jsonPayload += "\"performedBy\":\"ESP32 System\",";
  jsonPayload += "\"tankId\":\"" + String(TANK_ID) + "\",";
  jsonPayload += "\"logLevel\":\"" + getLogLevelStr(level) + "\",";
  jsonPayload += "\"timestamp\":{\".sv\":\"timestamp\"}";
  jsonPayload += "}";

  bool isCriticalOrError = (level == LEVEL_CRITICAL || level == LEVEL_ERROR);

  // CRITICAL FIX: If called from sensorTask (Core 1), do NOT execute HTTPS!
  // Doing mbedTLS on Core 1's smaller stack causes stack overflow and crashes.
  // Buffer the log in RAM so networkTask (Core 0) can flush it safely.
  if (xPortGetCoreID() == 1) {
    pushRamLog(jsonPayload);
    return;
  }

  // Just after a link switch the sensor upload goes first; send this later.
  if (linkUploadFirst) {
    pushRamLog(jsonPayload);
    return;
  }

  bool sentSuccessfully = false;

  if (isNetworkConnected()) {
    ensureFirebaseAuth();

    WiFiClientSecure secureClient;
    prepareTlsClient(secureClient);
    HTTPClient http;
    http.begin(secureClient, getLogsUrl());
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    feedWatchdog();
    int httpResponseCode = http.sendRequest("POST", jsonPayload);
    if (httpResponseCode == 401) {
      DEBUG_PRINTLN(
          "[FirebaseAuth] Received 401 Unauthorized in logSystemEvent.");
      firebaseAuthValid = false;
    }

    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      sentSuccessfully = true;
      markCloudOk();
      DEBUG_PRINTF("Log seamlessly tracking on Web System. Firebase Code: %d\n",
                   httpResponseCode);
    } else {
      DEBUG_PRINTF("Error syncing log to Web System. Code: %s\n",
                   http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }

  if (!sentSuccessfully && isCriticalOrError) {
    pushRamLog(jsonPayload);
  }
}

// ==========================================
// NTP Time Sync (called from networkTask, NOT from the event callback)
// ==========================================
void initTime() {
  Serial.println("Syncing Time from NTP Server...");
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 2000)) { // Wait up to 2 seconds for sync
                                       // (prevents long startup blockage)
    timeInitialized = true;
    logSystemEvent(
        "System Power Tracker",
        "Device Powered ON & Hardware Clock Synced. ESP32 is fully active.",
        LEVEL_INFO);
  } else {
    Serial.println("Failed to get accurate time from NTP.");
  }
}

// ==========================================
// Network Event Handler
// Runs on the small arduino_events task. ONLY set flags / print here.
// ==========================================
void WiFiEvent(arduino_event_id_t event) {
  switch (event) {
  case ARDUINO_EVENT_ETH_START:
    Serial.println("ETH Started");
    ETH.setHostname("esp32-water-monitor");
    break;
  case ARDUINO_EVENT_ETH_CONNECTED:
    Serial.println("ETH Connected");
    ethLinkUpAt = millis();
    ethLinkUpPending = true;
    break;
  case ARDUINO_EVENT_ETH_GOT_IP:
    Serial.print("ETH IP: ");
    Serial.println(ETH.localIP());
    ethConnected = true;
    ethLinkUpPending = false;
    needEthPrimary = true;
    needTimeInit = !timeInitialized;
    needAuth = true;
    break;
  case ARDUINO_EVENT_ETH_DISCONNECTED:
    Serial.println("ETH Disconnected");
    ethLinkUpPending = false;
    if (ethConnected) {
      ethConnected = false;
      needEthDownLog = true;
      needEthFailover = true;
    }
    break;

  case ARDUINO_EVENT_ETH_LOST_IP:
    Serial.println("ETH Lost IP");
    if (ethConnected) {
      ethConnected = false;
      needEthDownLog = true;
      needEthFailover = true;
    }
    break;

  case ARDUINO_EVENT_WIFI_STA_CONNECTED:
    Serial.println("WiFi Connected");
    break;
  case ARDUINO_EVENT_WIFI_STA_GOT_IP:
    Serial.print("WiFi IP: ");
    Serial.println(WiFi.localIP());
    wifiConnected = true;
    needTimeInit = !timeInitialized;
    needAuth = true;
    break;
  case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
    Serial.println("WiFi Disconnected");
    if (wifiConnected) {
      wifiConnected = false;
      needWifiDownLog = true;
    }
    break;

  default:
    break;
  }
}

// Runs at the top of networkTask: does the work the event callback deferred.
void processDeferredNetworkWork() {
  if (linkUploadFirst && millis() - linkUploadFirstSince >= LINK_UPLOAD_FIRST_MS) {
    linkUploadFirst = false; // upload did not get through; poll as usual
  }
  if (needEthFailover) {
    needEthFailover = false;
    if (!ethConnected)
      startWifiFailover();
  }
  if (needEthPrimary) {
    needEthPrimary = false;
    if (ethConnected) {
      Serial.println("[Failover] Ethernet is up. Routing traffic through Ethernet.");
      ethDegraded = false;
      ethRetrying = false;
      ethBadPolls = 0;
      routeViaEthernet();
      resetFirebaseSocket();
      linkUploadFirst = true;
      linkUploadFirstSince = millis();
      if (ethWasLost) {
        ethWasLost = false;
        Serial.printf("[Failover] Back on Ethernet (%lu s after it was lost).\n",
                      (millis() - ethLostAt) / 1000);
        logSystemEvent("Network Recovery",
                       "Ethernet connection restored. Wi-Fi is on standby again.",
                       LEVEL_INFO);
      }
    }
  }
  // Cable is in but no Ethernet IP yet. Keep traffic on Wi-Fi (an Ethernet
  // interface without an IP must not become the route), and restart the W5500
  // if no IP arrives. Its own ETH_CONNECTED event starts the wait again.
  if (ethLinkUpPending && !ethConnected) {
    if (!ethWaitRouted) {
      ethWaitRouted = true;
      routeViaWifi();
    }
    if (millis() - ethLinkUpAt >= ETH_RESTART_WAIT_MS) {
      ethLinkUpPending = false;
      ethWaitRouted = false;
      restartEthernet();
    }
  }
  if (needEthDownLog) {
    needEthDownLog = false;
    logSystemEvent("Network Alert",
                   "Ethernet connection unexpectedly disconnected",
                   LEVEL_CRITICAL);
  }
  if (needWifiDownLog) {
    needWifiDownLog = false;
    logSystemEvent("Network Alert", "WiFi backup connection disconnected",
                   LEVEL_WARNING);
  }
  if (needTimeInit && isNetworkConnected()) {
    needTimeInit = false;
    if (!timeInitialized)
      initTime();
  }
  if (needAuth && isNetworkConnected()) {
    needAuth = false;
    ensureFirebaseAuth();
  }
}

// ==========================================
// Signal Filtering Implementation
// ==========================================
void sortArray(float arr[], int n) {
  for (int i = 0; i < n - 1; i++) {
    for (int j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        float temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
    }
  }
}

// ADC oversampling: each sample is the average of this many back-to-back
// conversions. Averaging N readings cuts random ADC and wiring noise by about
// sqrt(N) (16 -> ~4x) without adding delay (16 reads take well under 1 ms).
// The average voltage is unchanged, so existing calibration values stay valid.
const int ADC_OVERSAMPLE = 16;

float readVoltageOversampled(int pin) {
  uint32_t sum = 0;
  for (int i = 0; i < ADC_OVERSAMPLE; i++) {
    sum += analogRead(pin);
  }
  return ((float)sum / ADC_OVERSAMPLE / 4095.0) * 3.3;
}

// Level sensor: the same averaging, but with analogReadMilliVolts(), which applies
// the factory ADC calibration stored in each ESP32 (eFuse). The plain
// raw / 4095 * 3.3 conversion reads about 0.2 V low on Tank 1 (0.60 V vs 0.80 V
// and 1.17 V vs 1.37 V on a multimeter), so Vmin/Vmax read with a meter did not
// match what the firmware saw. With this, the Serial Monitor should match a
// meter closely. The pH sensor still uses readVoltageOversampled() so its
// existing calibration (phNeutralVoltage, phSlope) stays valid.
float readLevelVoltageCalibrated() {
  uint32_t sumMv = 0;
  for (int i = 0; i < ADC_OVERSAMPLE; i++) {
    sumMv += analogReadMilliVolts(LEVEL_SENSOR_PIN);
  }
  return (float)sumMv / ADC_OVERSAMPLE / 1000.0;
}

// Non-blocking sampling routine called every SENSOR_SAMPLE_INTERVAL ms.
void sampleSensorsNonBlocking() {
  unsigned long now = millis();
  if (now - lastSensorSampleTime >= SENSOR_SAMPLE_INTERVAL) {
    lastSensorSampleTime = now;

    levelRawSamples[levelRawIndex] = readLevelVoltageCalibrated();
    levelRawIndex = (levelRawIndex + 1) % FILTER_MEDIAN_WINDOW;
    if (levelRawIndex == 0) {
      levelBufferFilled = true;
    }

    phRawSamples[phRawIndex] = readVoltageOversampled(PH_SENSOR_PIN);
    phRawIndex = (phRawIndex + 1) % FILTER_MEDIAN_WINDOW;
    if (phRawIndex == 0) {
      phBufferFilled = true;
    }
  }
}

float readLevelVoltageStable() {
  if (!levelBufferFilled) {
    return readLevelVoltageCalibrated();
  }

  float tempSamples[FILTER_MEDIAN_WINDOW];
  memcpy(tempSamples, levelRawSamples, sizeof(levelRawSamples));
  sortArray(tempSamples, FILTER_MEDIAN_WINDOW);
  float medianVal = tempSamples[FILTER_MEDIAN_WINDOW / 2];

  levelAverageHistory[levelAverageIndex] = medianVal;
  levelAverageIndex = (levelAverageIndex + 1) % FILTER_AVERAGE_WINDOW;
  if (levelAverageCount < FILTER_AVERAGE_WINDOW) {
    levelAverageCount++;
  }

  float sum = 0.0;
  for (int i = 0; i < levelAverageCount; i++) {
    sum += levelAverageHistory[i];
  }
  return sum / levelAverageCount;
}

float readPhVoltageStable() {
  if (!phBufferFilled) {
    return readVoltageOversampled(PH_SENSOR_PIN);
  }

  float tempSamples[FILTER_MEDIAN_WINDOW];
  memcpy(tempSamples, phRawSamples, sizeof(phRawSamples));
  sortArray(tempSamples, FILTER_MEDIAN_WINDOW);
  float medianVal = tempSamples[FILTER_MEDIAN_WINDOW / 2];

  phAverageHistory[phAverageIndex] = medianVal;
  phAverageIndex = (phAverageIndex + 1) % FILTER_AVERAGE_WINDOW;
  if (phAverageCount < FILTER_AVERAGE_WINDOW) {
    phAverageCount++;
  }

  float sum = 0.0;
  for (int i = 0; i < phAverageCount; i++) {
    sum += phAverageHistory[i];
  }
  return sum / phAverageCount;
}

// ==========================================
// JSON Parsing Helpers
// ==========================================
bool getBoolFromJson(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\"");
  if (keyIndex == -1)
    return false;

  int colonIndex = json.indexOf(":", keyIndex);
  if (colonIndex == -1)
    return false;

  int valStart = colonIndex + 1;
  while (valStart < json.length() &&
         (json[valStart] == ' ' || json[valStart] == '\t' ||
          json[valStart] == '\r' || json[valStart] == '\n')) {
    valStart++;
  }

  if (json.substring(valStart).startsWith("true")) {
    return true;
  }
  return false;
}

// Reads a whole-number epoch in milliseconds (e.g. 1795007397317) and returns
// it in seconds (0 if missing). getFloatFromJson() would round it by minutes.
long getEpochSecFromJson(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\"");
  if (keyIndex == -1)
    return 0;
  int colonIndex = json.indexOf(":", keyIndex);
  if (colonIndex == -1)
    return 0;
  int i = colonIndex + 1;
  while (i < (int)json.length() && json[i] == ' ')
    i++;
  String digits = "";
  while (i < (int)json.length() && isDigit(json[i]))
    digits += json[i++];
  if (digits.length() <= 3)
    return 0;
  return digits.substring(0, digits.length() - 3).toInt();
}

// True while the admin's live calibration window is open (see CALIB_LIVE_MAX_MS).
bool calibrationLiveOn() {
  if (calibUntilSec <= 0)
    return false;
  time_t nowSec = time(nullptr);
  if (nowSec < 1700000000) // clock not set yet (no NTP)
    return false;
  if (millis() - calibSeenAtMs > CALIB_LIVE_MAX_MS)
    return false;
  return (long)nowSec < calibUntilSec;
}

bool hasKeyInJson(String json, String key) {
  return json.indexOf("\"" + key + "\"") != -1;
}

// Returns -999.0 if the key is not found or parsing fails
float getFloatFromJson(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\"");
  if (keyIndex == -1)
    return -999.0;

  int colonIndex = json.indexOf(":", keyIndex);
  if (colonIndex == -1)
    return -999.0;

  int valStart = colonIndex + 1;
  while (valStart < json.length() &&
         (json[valStart] == ' ' || json[valStart] == '\t' ||
          json[valStart] == '\r' || json[valStart] == '\n')) {
    valStart++;
  }

  int valEnd = valStart;
  while (valEnd < json.length() &&
         (isDigit(json[valEnd]) || json[valEnd] == '.' || json[valEnd] == '-' ||
          json[valEnd] == '+')) {
    valEnd++;
  }

  if (valStart == valEnd)
    return -999.0;
  return json.substring(valStart, valEnd).toFloat();
}

String getStringFromJson(const String &json, const String &key) {
  String searchKey = "\"" + key + "\"";
  int keyIndex = json.indexOf(searchKey);
  if (keyIndex == -1)
    return "";

  int colonIndex = json.indexOf(":", keyIndex + searchKey.length());
  if (colonIndex == -1)
    return "";

  int start = colonIndex + 1;
  while (start < json.length() &&
         (json[start] == ' ' || json[start] == '\t' || json[start] == '\r' ||
          json[start] == '\n')) {
    start++;
  }
  if (start >= json.length())
    return "";

  if (json[start] == '\"') {
    int endQuote = json.indexOf('\"', start + 1);
    if (endQuote == -1)
      return "";
    return json.substring(start + 1, endQuote);
  } else {
    int end = start;
    while (end < json.length() && json[end] != ',' && json[end] != '}' &&
           json[end] != ']' && json[end] != ' ' && json[end] != '\r' &&
           json[end] != '\n') {
      end++;
    }
    return json.substring(start, end);
  }
}

// ==========================================
// Firebase Authentication Implementations
// ==========================================

// Authenticate using identitytoolkit signInWithPassword REST endpoint
bool firebaseSignIn() {
  if (!isNetworkConnected()) {
    DEBUG_PRINTLN("[FirebaseAuth] Cannot sign in: Network is offline.");
    return false;
  }

  Serial.println(
      "[FirebaseAuth] Authenticating via REST API (signInWithPassword)...");

  String url = "https://identitytoolkit.googleapis.com/v1/"
               "accounts:signInWithPassword?key=" +
               String(FIREBASE_API_KEY);

  String payload = "{";
  payload += "\"email\":\"" + String(FIREBASE_AUTH_EMAIL) + "\",";
  payload += "\"password\":\"" + String(FIREBASE_AUTH_PASSWORD) + "\",";
  payload += "\"returnSecureToken\":true";
  payload += "}";

  WiFiClientSecure secureClient;
  prepareTlsClient(secureClient);
  HTTPClient http;
  http.begin(secureClient, url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");

  feedWatchdog();
  int code = http.POST(payload);
  if (code == 200) {
    String response = http.getString();
    String idTok = getStringFromJson(response, "idToken");
    String refTok = getStringFromJson(response, "refreshToken");
    String expStr = getStringFromJson(response, "expiresIn");

    if (idTok.length() > 0) {
      firebaseIdToken = idTok;
      if (refTok.length() > 0) {
        firebaseRefreshToken = refTok;
      }
      long expSec = expStr.toInt();
      if (expSec > 0) {
        tokenExpiresInMs = expSec * 1000UL;
      } else {
        tokenExpiresInMs = 3600000UL;
      }
      tokenAcquiredTime = millis();
      firebaseAuthValid = true;
      Serial.println("[FirebaseAuth] Sign-in successful! ID token acquired.");
      http.end();
      return true;
    } else {
      Serial.println("[FirebaseAuth] Error: HTTP 200 received but idToken key "
                     "was missing.");
    }
  } else {
    Serial.printf("[FirebaseAuth] Sign-in failed. HTTP status code: %d\n",
                  code);
  }
  http.end();
  firebaseAuthValid = false;
  return false;
}

// Refresh ID token using securetoken.googleapis.com REST endpoint
bool firebaseRefreshTokenFunc() {
  if (!isNetworkConnected()) {
    return false;
  }
  if (firebaseRefreshToken.length() == 0) {
    Serial.println("[FirebaseAuth] No refresh token found. Re-authenticating "
                   "via password...");
    return firebaseSignIn();
  }

  Serial.println(
      "[FirebaseAuth] Refreshing ID token via securetoken.googleapis.com...");

  String url = "https://securetoken.googleapis.com/v1/token?key=" +
               String(FIREBASE_API_KEY);
  String body =
      "grant_type=refresh_token&refresh_token=" + firebaseRefreshToken;

  WiFiClientSecure secureClient;
  prepareTlsClient(secureClient);
  HTTPClient http;
  http.begin(secureClient, url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  feedWatchdog();
  int code = http.POST(body);
  if (code == 200) {
    String response = http.getString();
    String newIdTok = getStringFromJson(response, "id_token");
    String newRefTok = getStringFromJson(response, "refresh_token");
    String expStr = getStringFromJson(response, "expires_in");

    if (newIdTok.length() > 0) {
      firebaseIdToken = newIdTok;
      if (newRefTok.length() > 0) {
        firebaseRefreshToken = newRefTok;
      }
      long expSec = expStr.toInt();
      if (expSec > 0) {
        tokenExpiresInMs = expSec * 1000UL;
      } else {
        tokenExpiresInMs = 3600000UL;
      }
      tokenAcquiredTime = millis();
      firebaseAuthValid = true;
      Serial.println("[FirebaseAuth] ID token successfully refreshed!");
      http.end();
      return true;
    } else {
      Serial.println("[FirebaseAuth] Error: HTTP 200 but id_token missing in "
                     "refresh response.");
    }
  } else {
    Serial.printf("[FirebaseAuth] Token refresh failed (HTTP %d). "
                  "Re-authenticating via password...\n",
                  code);
  }
  http.end();

  return firebaseSignIn();
}

// Ensure an active auth token is available (refreshes ~5 min before expiry)
bool ensureFirebaseAuth() {
  if (!isNetworkConnected()) {
    return false;
  }

  unsigned long now = millis();

  if (!firebaseAuthValid || firebaseIdToken.length() == 0) {
    return firebaseSignIn();
  }

  if (now - tokenAcquiredTime >= (tokenExpiresInMs - TOKEN_REFRESH_MARGIN)) {
    return firebaseRefreshTokenFunc();
  }

  return true;
}

// =================================================================================
// pH Sensor Processing Pipeline (Reading -> Validation -> Calibration ->
// Output)
// =================================================================================
void processPhSensor() {
  float rawPhVoltage = readPhVoltageStable();
  livePhVoltage = rawPhVoltage; // for the live calibration view

  bool electricalValid = (rawPhVoltage > 0.05 && rawPhVoltage < 3.25);

  // pH = 7.0 + ((Neutral_V - Raw_V) / Slope) + pH_Offset
  float phVal = 7.0 + ((phNeutralVoltage - rawPhVoltage) / phSlope) + phOffset;

  bool physicalValid = (phVal >= 0.0 && phVal <= 14.0);
  bool readingValid = electricalValid && physicalValid;

  unsigned long now = millis();

  if (!readingValid) {
    if (phFaultTimer == 0) {
      phFaultTimer = now;
    }
    phRecoveryTimer = 0;
    consecutivePhSpikes = 0;

    if (phSensorOk && (now - phFaultTimer >= SENSOR_FAULT_TIMEOUT)) {
      phSensorOk = false;
      logSystemEvent("Sensor Fault",
                     "pH Sensor FAULT! Out-of-bounds readings. Voltage: " +
                         String(rawPhVoltage, 2) + "V, pH: " + String(phVal, 2) +
                         ". Monitoring continues with the raw reading.",
                     LEVEL_CRITICAL);
    }
    // Monitoring is never suspended: once the fault is confirmed (10 s), the
    // live reading, clamped to 0-14, keeps flowing to the dashboard, history
    // and alerts, flagged by phSensorOk = false. During the 10 s check the
    // last good value is held so a short glitch does not show.
    if (!phSensorOk) {
      float clampedPh = constrain(phVal, 0.0f, 14.0f);
      if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
        if (stabilizedPhValue == -999.0 ||
            abs(clampedPh - stabilizedPhValue) >= PH_LEVEL_DEADBAND) {
          stabilizedPhValue = clampedPh;
        }
        xSemaphoreGive(sensorDataMutex);
      }
    }
    return;
  }

  phFaultTimer = 0;

  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stabilizedPhValue == -999.0) {
      stabilizedPhValue = phVal;
      phSensorOk = true;
      xSemaphoreGive(sensorDataMutex);
      return;
    }

    float diff = abs(phVal - stabilizedPhValue);
    if (diff >= PH_SPIKE_THRESHOLD) {
      consecutivePhSpikes++;
      if (consecutivePhSpikes >= STABILIZATION_SAMPLES) {
        stabilizedPhValue = phVal;
        consecutivePhSpikes = 0;
        DEBUG_PRINTLN("pH sensor stabilized at new value: " + String(phVal, 2));
      } else {
        DEBUG_PRINTLN("pH spike ignored (count=" + String(consecutivePhSpikes) +
                      "): " + String(phVal, 2));
      }
    } else {
      consecutivePhSpikes = 0;
      if (!phSensorOk) {
        if (phRecoveryTimer == 0) {
          phRecoveryTimer = now;
        } else if (now - phRecoveryTimer >= 3000) {
          phSensorOk = true;
          phRecoveryTimer = 0;
          xSemaphoreGive(sensorDataMutex);
          logSystemEvent(
              "Sensor Recovery",
              "pH sensor has recovered and is sending stable readings",
              LEVEL_INFO);
          return;
        }
      }
      if (abs(phVal - stabilizedPhValue) >= PH_LEVEL_DEADBAND) {
        stabilizedPhValue = phVal;
      }
    }
    xSemaphoreGive(sensorDataMutex);
  }
}

// =================================================================================
// Level Signal Stability Check
// =================================================================================
// Keeps the min and max level per second for the last LEVEL_STABILITY_WINDOW_S
// seconds. Returns true when the swing over the full window reaches
// LEVEL_UNSTABLE_RANGE (see the constants above). Called every 200 ms.
int levelWindowMin[LEVEL_STABILITY_WINDOW_S];
int levelWindowMax[LEVEL_STABILITY_WINDOW_S];
int levelWindowIdx = 0;
int levelWindowFilled = 0;
unsigned long levelWindowSecond = 0;
int lastLevelSwing = 0; // for the fault log message

bool levelSignalUnstable(int levelPercent, unsigned long now) {
  unsigned long second = now / 1000;
  if (levelWindowFilled == 0) {
    levelWindowIdx = 0;
    levelWindowMin[0] = levelWindowMax[0] = levelPercent;
    levelWindowFilled = 1;
    levelWindowSecond = second;
  } else if (second != levelWindowSecond) {
    unsigned long steps = second - levelWindowSecond;
    if (steps > (unsigned long)LEVEL_STABILITY_WINDOW_S)
      steps = LEVEL_STABILITY_WINDOW_S;
    for (unsigned long i = 0; i < steps; i++) {
      levelWindowIdx = (levelWindowIdx + 1) % LEVEL_STABILITY_WINDOW_S;
      levelWindowMin[levelWindowIdx] = levelWindowMax[levelWindowIdx] =
          levelPercent;
      if (levelWindowFilled < LEVEL_STABILITY_WINDOW_S)
        levelWindowFilled++;
    }
    levelWindowSecond = second;
  } else {
    if (levelPercent < levelWindowMin[levelWindowIdx])
      levelWindowMin[levelWindowIdx] = levelPercent;
    if (levelPercent > levelWindowMax[levelWindowIdx])
      levelWindowMax[levelWindowIdx] = levelPercent;
  }

  if (levelWindowFilled < LEVEL_STABILITY_WINDOW_S)
    return false; // not enough history yet (first 30 s after boot)

  int lo = 100, hi = 0;
  for (int i = 0; i < LEVEL_STABILITY_WINDOW_S; i++) {
    if (levelWindowMin[i] < lo)
      lo = levelWindowMin[i];
    if (levelWindowMax[i] > hi)
      hi = levelWindowMax[i];
  }
  lastLevelSwing = hi - lo;
  return lastLevelSwing >= LEVEL_UNSTABLE_RANGE;
}

// =================================================================================
// Water Level Sensor Processing Pipeline
// =================================================================================
void processLevelSensor() {
  float rawLevelVoltage = readLevelVoltageStable();

  bool electricalValid = (rawLevelVoltage > LEVEL_MIN_VALID_VOLTAGE &&
                         rawLevelVoltage < 3.25);

  float valRange = levelVmax - levelVmin;
  float height = 0.0;
  if (abs(valRange) > 0.001) {
    height = (rawLevelVoltage - levelVmin) * (tankHeight / valRange);
  }

  bool physicalValid = (height >= -0.5 && height <= (tankHeight + 0.5));

  float clampedHeight = height;
  if (clampedHeight < 0.0)
    clampedHeight = 0.0;
  if (clampedHeight > tankHeight)
    clampedHeight = tankHeight;

  int levelPercent = (clampedHeight / tankHeight) * 100;
  levelPercent += (int)levelOffset;
  if (levelPercent < 0)
    levelPercent = 0;
  if (levelPercent > 100)
    levelPercent = 100;

  liveLevelVoltage = rawLevelVoltage; // for the live calibration view
  liveLevelHeight = height;
  liveLevelPercent = levelPercent;

  unsigned long now = millis();

  bool signalUnstable = levelSignalUnstable(levelPercent, now);
  bool readingValid = electricalValid && physicalValid && !signalUnstable;

  if (!readingValid) {
    if (levelFaultTimer == 0) {
      levelFaultTimer = now;
    }
    levelRecoveryTimer = 0;
    consecutiveLevelSpikes = 0;

    if (levelSensorOk && (now - levelFaultTimer >= SENSOR_FAULT_TIMEOUT)) {
      levelSensorOk = false;
      String reason =
          (electricalValid && physicalValid)
              ? "Unstable readings (level swung " + String(lastLevelSwing) +
                    "% within " + String(LEVEL_STABILITY_WINDOW_S) +
                    " s; sensor may be disconnected)"
              : String("Out-of-bounds readings");
      logSystemEvent(
          "Sensor Fault",
          "Water Level Sensor FAULT! " + reason + ". Voltage: " +
              String(rawLevelVoltage, 2) + "V, Height: " + String(height, 2) +
              "m. Monitoring continues with the raw reading.",
          LEVEL_CRITICAL);
    }
    // Monitoring is never suspended: once the fault is confirmed (10 s), the
    // live reading, clamped to 0-100 %, keeps flowing to the dashboard,
    // history and alerts, flagged by levelSensorOk = false. During the 10 s
    // check the last good value is held so a short glitch does not show.
    // The pump still stops on a faulty level sensor (processAutomaticPumpControl).
    if (!levelSensorOk) {
      if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
        if (stabilizedWaterLevelPercent == -999 ||
            abs(levelPercent - stabilizedWaterLevelPercent) >=
                WATER_LEVEL_DEADBAND) {
          stabilizedWaterLevelPercent = levelPercent;
          stabilizedWaterHeight = clampedHeight;
        }
        xSemaphoreGive(sensorDataMutex);
      }
    }
    return;
  }

  levelFaultTimer = 0;

  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stabilizedWaterLevelPercent == -999) {
      stabilizedWaterLevelPercent = levelPercent;
      stabilizedWaterHeight = clampedHeight;
      levelSensorOk = true;
      xSemaphoreGive(sensorDataMutex);
      return;
    }

    int diff = abs(levelPercent - stabilizedWaterLevelPercent);
    if (diff >= LEVEL_SPIKE_THRESHOLD) {
      consecutiveLevelSpikes++;
      if (consecutiveLevelSpikes >= STABILIZATION_SAMPLES) {
        stabilizedWaterLevelPercent = levelPercent;
        stabilizedWaterHeight = clampedHeight;
        consecutiveLevelSpikes = 0;
        DEBUG_PRINTLN("Level sensor stabilized at new value: " +
                      String(levelPercent) + "%");
      } else {
        DEBUG_PRINTLN(
            "Level spike ignored (count=" + String(consecutiveLevelSpikes) +
            "): " + String(levelPercent) + "%");
      }
    } else {
      consecutiveLevelSpikes = 0;
      if (!levelSensorOk) {
        if (levelRecoveryTimer == 0) {
          levelRecoveryTimer = now;
        } else if (now - levelRecoveryTimer >= 3000) {
          levelSensorOk = true;
          levelRecoveryTimer = 0;
          xSemaphoreGive(sensorDataMutex);
          logSystemEvent(
              "Sensor Recovery",
              "Water Level sensor has recovered and is sending stable readings",
              LEVEL_INFO);
          return;
        }
      }
      if (abs(levelPercent - stabilizedWaterLevelPercent) >=
          WATER_LEVEL_DEADBAND) {
        stabilizedWaterLevelPercent = levelPercent;
        stabilizedWaterHeight = clampedHeight;
      }
    }
    xSemaphoreGive(sensorDataMutex);
  }
}

// =================================================================================
// Connection Manager (WiFi Reconnection & Non-Blocking Backoff)
// =================================================================================
void manageConnections() {
  unsigned long now = millis();

  if (ethActive()) {
    if (wifiConnected) {
      wifiConnected = false;
      DEBUG_PRINTLN("Ethernet is active. Disabling backup WiFi flag.");
    }
    // Hot standby: keep the Wi-Fi backup joined while Ethernet carries the
    // traffic, so unplugging the cable switches over in seconds instead of
    // starting Wi-Fi from scratch.
    if (WiFi.status() != WL_CONNECTED &&
        now - lastWifiRetry >= WIFI_STANDBY_RETRY_MS) {
      lastWifiRetry = now;
      DEBUG_PRINTLN("Wi-Fi backup not joined. Re-joining it in the background.");
      WiFi.disconnect();
      WiFi.setSleep(false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      wifiConnected = false;
      logSystemEvent("Network Alert", "WiFi backup connection lost!",
                     LEVEL_WARNING);
    }

    if (now - lastWifiRetry >= wifiRetryInterval) {
      lastWifiRetry = now;
      wifiReconnectAttempts++;

      // Backoff: 15s -> 30s -> 60s max
      if (wifiReconnectAttempts == 1)
        wifiRetryInterval = 15000;
      else if (wifiReconnectAttempts == 2)
        wifiRetryInterval = 30000;
      else
        wifiRetryInterval = 60000;

      Serial.printf(
          "Attempting WiFi reconnection (Attempt %d)... Next retry in %lds\n",
          wifiReconnectAttempts, wifiRetryInterval / 1000);

      WiFi.disconnect();
      WiFi.setSleep(false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  } else {
    if (!wifiConnected) {
      wifiConnected = true;
      wifiReconnectAttempts = 0;
      wifiRetryInterval = 15000;
      WiFi.setSleep(false);
      logSystemEvent("Network Recovery",
                     "WiFi backup connection established successfully.",
                     LEVEL_INFO);
    }
  }
}

// =================================================================================
// Ethernet -> Wi-Fi failover (runs in networkTask right after the cable is
// unplugged, before anything else uses the network).
// =================================================================================
// Sends new connections through Wi-Fi or Ethernet (the default route).
void routeViaWifi() {
  esp_netif_t *staNetif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (staNetif != NULL) {
    esp_netif_set_default_netif(staNetif);
  }
}

void routeViaEthernet() { ETH.setDefault(); }

// Closes the persistent TLS socket (it stays on the link it was opened on) and
// clears the poll backoff, so the next poll opens a new socket at once.
void resetFirebaseSocket() {
  commandClient.stop();
  firebaseConnected = false;
  firebaseErrorCount = 0;
  currentCommandPollInterval = COMMAND_POLL_INTERVAL;
  lastCommandPoll = millis() - COMMAND_POLL_INTERVAL;
}

// Called after every command poll. Leaves Ethernet for Wi-Fi when Ethernet is
// connected but its internet fails or is slow.
void checkEthernetQuality(bool pollOk, unsigned long pollMs) {
  if (!ethActive()) {
    ethBadPolls = 0;
    return;
  }
  bool bad = !pollOk || pollMs > ETH_SLOW_POLL_MS;
  if (!bad) {
    ethBadPolls = 0;
    if (ethRetrying) {
      ethRetrying = false;
      logSystemEvent("Network Recovery",
                     "Ethernet internet recovered. Back on Ethernet.", LEVEL_INFO);
    }
    return;
  }
  ethBadPolls++;
  if (ethBadPolls < ETH_BAD_POLLS_TO_SWITCH || WiFi.status() != WL_CONNECTED)
    return; // not bad enough yet, or no Wi-Fi to switch to

  bool firstSwitch = !ethRetrying;
  ethDegraded = true;
  ethRetrying = false;
  ethBadPolls = 0;
  ethDegradedSince = millis();
  Serial.printf("[Failover] Ethernet has no or slow internet (last poll %lu ms, "
                "%s). Switching to the Wi-Fi backup.\n",
                pollMs, pollOk ? "ok" : "failed");
  routeViaWifi();
  resetFirebaseSocket();
  if (firstSwitch) { // a failed retry does not log again every minute
    logSystemEvent("Network Alert",
                   "Ethernet is connected but has no or slow internet. "
                   "Switched to the Wi-Fi backup.",
                   LEVEL_WARNING);
  }
}

// Runs every networkTask loop: while on Wi-Fi because Ethernet was bad, try
// Ethernet again after ETH_RETRY_INTERVAL_MS, or at once if Wi-Fi drops.
void checkEthernetRecovery() {
  if (!ethConnected || !ethDegraded)
    return;
  if (WiFi.status() == WL_CONNECTED &&
      millis() - ethDegradedSince < ETH_RETRY_INTERVAL_MS)
    return;
  Serial.println("[Failover] Trying Ethernet again.");
  ethDegraded = false;
  ethRetrying = true;
  ethBadPolls = 0;
  routeViaEthernet();
  resetFirebaseSocket();
}

void startWifiFailover() {
  unsigned long now = millis();
  Serial.println("[Failover] Ethernet lost. Switching to the Wi-Fi backup now.");
  ethWasLost = true;
  ethLostAt = now;
  linkUploadFirst = true;
  linkUploadFirstSince = now;
  ethDegraded = false;
  ethRetrying = false;
  ethBadPolls = 0;

  // The persistent TLS socket was open on the Ethernet link and is dead now.
  resetFirebaseSocket();

  // Restart the Wi-Fi retry schedule so manageConnections() retries at once
  // if Wi-Fi is not joined.
  wifiReconnectAttempts = 0;
  wifiRetryInterval = 15000;
  lastWifiRetry = now - wifiRetryInterval;

  if (WiFi.status() == WL_CONNECTED) {
    // Route traffic through Wi-Fi now instead of waiting for the stack to
    // retire the Ethernet interface.
    routeViaWifi();
    wifiFailoverPending = true;
    wifiFailoverStart = now;
  }
}

// The cable is in but no Ethernet IP came: restart the W5500 driver (this also
// resets the chip through its RST pin), so it starts fresh and asks for a lease.
void restartEthernet() {
  Serial.println("[Failover] Ethernet cable is in but has no IP. Restarting "
                 "the W5500.");
  ETH.end();
  SPI.begin(ETH_SPI_SCK, ETH_SPI_MISO, ETH_SPI_MOSI);
  if (!ETH.begin(ETH_TYPE, ETH_ADDR, ETH_SPI_CS, ETH_SPI_INT, ETH_SPI_RST,
                 SPI)) {
    Serial.println("[Failover] W5500 restart failed. Staying on Wi-Fi.");
  }
  routeViaWifi(); // until the restarted Ethernet has an IP
}

// Drops the Wi-Fi connection and joins again (fresh DHCP lease: IP, gateway, DNS).
void forceWifiReconnect(unsigned long now) {
  commandClient.stop();
  commandClientConfigured = false;
  firebaseConnected = false;
  firebaseAuthValid = false;
  wifiConnected = false;
  // Give the new connection a full watchdog period before judging it. (With 0
  // here the watchdog fired again as soon as Wi-Fi came back, before the first
  // poll could succeed, and kept dropping Wi-Fi in a loop.)
  lastFirebaseSuccessTime = now;

  WiFi.disconnect(true);
  vTaskDelay(pdMS_TO_TICKS(500));
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiRetry = now;
  wifiReconnectAttempts = 0;
  wifiRetryInterval = 15000;
}

// =================================================================================
// Network Watchdog - Zombie Socket Detector
// WiFi.status() can return WL_CONNECTED even after the router silently deauths
// the board (e.g. ARP timeout, DHCP lease expired, router restart). In this
// state all HTTPS calls fail but no disconnect event fires. This function
// detects the condition by checking how long it has been since any Firebase
// call succeeded, and forces a full WiFi reconnect to tear down the zombie TCP
// stack.
// =================================================================================
void checkNetworkWatchdog() {
  if (ethActive() || !wifiConnected) {
    wifiFailoverPending = false; // Ethernet is back, or Wi-Fi re-joins anyway
    return;
  }

  unsigned long now = millis();

  // Right after an Ethernet -> Wi-Fi failover: Wi-Fi gets WIFI_FAILOVER_CHECK_MS
  // to reach Firebase, not the full 90 s watchdog period.
  if (wifiFailoverPending) {
    if (firebaseConnected &&
        (long)(lastFirebaseSuccessTime - wifiFailoverStart) >= 0) {
      wifiFailoverPending = false;
      Serial.printf("[Failover] Wi-Fi backup is carrying data (%lu ms after "
                    "Ethernet was lost).\n",
                    lastFirebaseSuccessTime - wifiFailoverStart);
    } else if (now - wifiFailoverStart >= WIFI_FAILOVER_CHECK_MS) {
      wifiFailoverPending = false;
      Serial.println("[Failover] No reply over Wi-Fi yet. Re-joining Wi-Fi for a "
                     "fresh DHCP lease.");
      forceWifiReconnect(now);
      return;
    }
  }
  unsigned long referenceTime =
      (lastFirebaseSuccessTime > 0)
          ? lastFirebaseSuccessTime
          : (now < NETWORK_WATCHDOG_TIMEOUT
                 ? 0
                 : now - NETWORK_WATCHDOG_TIMEOUT - 1);

  if (referenceTime == 0)
    return;

  if ((now - referenceTime) >= NETWORK_WATCHDOG_TIMEOUT) {
    Serial.printf(
        "[NetworkWatchdog] HTTPS failing for %lus despite WL_CONNECTED. "
        "Router may have silently deauthenticated. Forcing WiFi reconnect.\n",
        (now - referenceTime) / 1000);
    logSystemEvent("Network Watchdog",
                   "Forced WiFi reconnect: HTTPS failing for 90s while "
                   "WL_CONNECTED (zombie socket).",
                   LEVEL_WARNING);

    forceWifiReconnect(now);
  }
}

// ==========================================
// Pump Control & Synchronization Helper
// ==========================================
// Sends one PATCH to tanks/{TANK_ID} with the pump fields.
//   writePumpOn:   include pumpOn = pumpState.
//   commandResult: when not NULL, also acknowledges a pump command from the web
//                  app: pumpCommandAt (server time) and pumpCommandResult
//                  ("accepted" or "refused-<reason>"). The dashboard shows a
//                  waiting spinner until pumpCommandAt changes.
// Returns true when the database accepted the write.
bool sendPumpPatch(bool writePumpOn, bool pumpState,
                   const char *commandResult) {
  if (!isNetworkConnected() || !ensureFirebaseAuth()) {
    return false;
  }
  WiFiClientSecure secureClient;
  prepareTlsClient(secureClient);
  HTTPClient http;
  http.begin(secureClient, getTanksUrl());
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  String patchPayload = "{";
  if (writePumpOn) {
    patchPayload += "\"pumpOn\":" + String(pumpState ? "true" : "false") + ",";
  }
  if (commandResult != NULL) {
    patchPayload += "\"pumpCommandResult\":\"" + String(commandResult) + "\",";
    patchPayload += "\"pumpCommandAt\":{\".sv\":\"timestamp\"},";
  }
  patchPayload += "\"lastUpdate\":{\".sv\":\"timestamp\"}}";
  feedWatchdog();
  int code = http.sendRequest("PATCH", patchPayload);
  if (code == 401) {
    DEBUG_PRINTLN("[FirebaseAuth] Received 401 in sendPumpPatch.");
    firebaseAuthValid = false;
  }
  bool ok = (code >= 200 && code < 300);
  if (ok) {
    lastSensorWrite = millis();
    markCloudOk();
    DEBUG_PRINTF("[Pump] Updated pump fields in tanks/%d (pumpOn %s, result "
                 "%s, HTTP %d)\n",
                 TANK_ID,
                 writePumpOn ? (pumpState ? "true" : "false") : "unchanged",
                 commandResult != NULL ? commandResult : "-", code);
  } else {
    DEBUG_PRINTF("[Pump] Failed to PATCH pump fields in tanks/%d. Code: %d\n",
                 TANK_ID, code);
  }
  http.end();
  return ok;
}

// Writes the ESP32's pump state to pumpOn, and acknowledges a pump command
// when commandResult is not NULL (used when a command is refused).
void updateFirebasePumpStateWithResult(bool pumpState,
                                       const char *commandResult) {
  lastSentPumpState = pumpState;
  pumpSyncPending = true; // cleared only when the write succeeds
  if (sendPumpPatch(true, pumpState, commandResult)) {
    pumpSyncPending = false;
  }
}

void updateFirebasePumpState(bool pumpState) {
  updateFirebasePumpStateWithResult(pumpState, NULL);
}

// Acknowledges an accepted pump command without touching pumpOn: it already
// holds the commanded value, and rewriting it could undo a newer command.
void acknowledgePumpCommand(const char *commandResult) {
  sendPumpPatch(false, false, commandResult);
}

// Starts the dry-run guard's clocks. Call whenever the pump is switched ON.
void notePumpStarted(int levelPercent) {
  pumpRunStartMs = millis();
  pumpRiseRefMs = pumpRunStartMs;
  pumpRiseRefLevel = levelPercent;
}

void processAutomaticPumpControl() {
  unsigned long now = millis();

  // Snapshot sensor values under mutex
  int levelPercent;
  bool levelOk;
  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    levelPercent = stabilizedWaterLevelPercent;
    levelOk = levelSensorOk;
    xSemaphoreGive(sensorDataMutex);
  } else {
    return;
  }

  // Rule 0: with the pump system off (config/pumpDemoMode false) the pump stays OFF.
  if (!pumpDemoMode) {
    if (currentPumpState) {
      currentPumpState = false;
      lastPumpStopTime = now;
      logSystemEvent("Pump Controller",
                     "Pump stopped automatically. Water level: " +
                         String(levelPercent) +
                         "%. Reason: Pump system turned off.",
                     LEVEL_INFO);
      updateFirebasePumpState(false);
    }
    return;
  }

  // Rule 1: maintenance (system-wide or this tank) forces the pump OFF and
  // blocks automatic starts.
  if (maintenanceActive()) {
    if (currentPumpState) {
      currentPumpState = false;
      lastPumpStopTime = now;
      logSystemEvent(
          "Pump Controller",
          "Pump stopped automatically. Water level: " + String(levelPercent) +
              "%. Reason: Maintenance mode active.",
          LEVEL_WARNING);
      updateFirebasePumpState(false);
    }
    return;
  }

  // Rule 3: faulty level sensor -> never auto-start, stop if running.
  if (!levelOk) {
    if (currentPumpState) {
      currentPumpState = false;
      lastPumpStopTime = now;
      logSystemEvent(
          "Pump Controller",
          "Pump stopped automatically. Water level: " + String(levelPercent) +
              "%. Reason: Water level sensor faulty.",
          LEVEL_CRITICAL);
      updateFirebasePumpState(false);
    }
    return;
  }

  if (levelPercent < 0) {
    return;
  }

  // Rule 2: overflow shutoff always applies.
  if (currentPumpState && (levelPercent >= (int)overflowThreshold)) {
    currentPumpState = false;
    lastPumpStopTime = now;
    logSystemEvent(
        "Pump Controller",
        "Pump stopped automatically. Water level: " + String(levelPercent) +
            "% reached overflow threshold (" + String((int)overflowThreshold) +
            "%). Reason: Overflow shutoff protection.",
        LEVEL_INFO);
    updateFirebasePumpState(false);
    return;
  }

  // Rule 4: dry-run guard. The level must keep rising while the pump runs.
  if (currentPumpState) {
    if (pumpRunStartMs == 0)
      notePumpStarted(levelPercent);
    if (levelPercent >= pumpRiseRefLevel + PUMP_MIN_RISE_PERCENT) {
      pumpRiseRefLevel = levelPercent;
      pumpRiseRefMs = now;
    }
    const char *fault = NULL;
    String why;
    if (now - pumpRunStartMs >= PUMP_MAX_RUN_MS) {
      fault = "max-run";
      why = "it ran for the maximum of " + String(PUMP_MAX_RUN_MS / 60000UL) +
            " min";
    } else if (now - pumpRiseRefMs >= PUMP_NO_RISE_TIMEOUT_MS) {
      fault = "no-rise";
      why = "the level did not rise " + String(PUMP_MIN_RISE_PERCENT) +
            "% in " + String(PUMP_NO_RISE_TIMEOUT_MS / 60000UL) + " min";
    }
    if (fault != NULL) {
      currentPumpState = false;
      lastPumpStopTime = now;
      pumpRunStartMs = 0;
      pumpFaultReason = fault;
      logSystemEvent("Pump Controller",
                     "Pump stopped automatically. Water level: " +
                         String(levelPercent) + "%. Reason: " + why +
                         ". Check the water source, valve and pipe. Automatic "
                         "starts are blocked until the pump is turned ON from "
                         "the dashboard.",
                     LEVEL_CRITICAL);
      updateFirebasePumpState(false);
      return;
    }
  }

  // Manual pump mode: no automatic start; only operator commands turn it on.
  if (pumpManualMode) {
    return;
  }

  // Automatic start when level falls to lowLevelThreshold or below
  if (!currentPumpState && (levelPercent <= (int)lowLevelThreshold)) {
    if (pumpFaultReason.length() > 0) {
      DEBUG_PRINTF("[Pump] Auto-start blocked: pump fault \"%s\" (turn the pump "
                   "ON from the dashboard to clear it)\n",
                   pumpFaultReason.c_str());
    } else if (now - lastPumpStopTime >= PUMP_MIN_OFF_TIME) {
      currentPumpState = true;
      notePumpStarted(levelPercent);
      logSystemEvent(
          "Pump Controller",
          "Pump started automatically. Water level: " + String(levelPercent) +
              "% fell to low level threshold (" +
              String((int)lowLevelThreshold) +
              "%). Reason: Low water level refill triggered.",
          LEVEL_INFO);
      updateFirebasePumpState(true);
    } else {
      DEBUG_PRINTF(
          "[Pump] Auto-start pending anti-chatter cooldown (%lus remaining)\n",
          (PUMP_MIN_OFF_TIME - (now - lastPumpStopTime)) / 1000);
    }
  }
}

// ==========================================
// Historical Telemetry Sampling (every 10 mins)
// ==========================================
const unsigned long HISTORY_SAMPLE_INTERVAL = 600000UL;
unsigned long lastHistorySampleTime = 0;

void postHistorySample() {
  if (!isNetworkConnected())
    return;
  if (!ensureFirebaseAuth())
    return;

  // Snapshot sensor data under mutex
  int lvlPercent;
  float lvlHeight, phVal;
  bool lvlOk, phOk;
  bool pumpOn;
  if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    lvlPercent = stabilizedWaterLevelPercent;
    lvlHeight = stabilizedWaterHeight;
    phVal = stabilizedPhValue;
    lvlOk = levelSensorOk;
    phOk = phSensorOk;
    pumpOn = currentPumpState;
    xSemaphoreGive(sensorDataMutex);
  } else {
    return;
  }

  // Samples are kept during a sensor fault too (monitoring is never
  // suspended); the health flags let Reports mark them as faulty readings.
  String jsonPayload;
  jsonPayload.reserve(320);

  jsonPayload = "{";
  if (lvlPercent != -999) {
    jsonPayload += "\"waterLevel\":" + String(lvlPercent) + ",";
    jsonPayload += "\"waterHeight\":" + String(lvlHeight, 2) + ",";
  } else {
    jsonPayload += "\"waterLevel\":null,";
    jsonPayload += "\"waterHeight\":null,";
  }

  if (phVal != -999.0) {
    jsonPayload += "\"phLevel\":" + String(phVal, 2) + ",";
  } else {
    jsonPayload += "\"phLevel\":null,";
  }

  jsonPayload += "\"levelSensorOk\":" + String(lvlOk ? "true" : "false") + ",";
  jsonPayload += "\"phSensorOk\":" + String(phOk ? "true" : "false") + ",";

  jsonPayload += "\"pumpOn\":" + String(pumpOn ? "true" : "false") + ",";
  jsonPayload += "\"timestamp\":{\".sv\":\"timestamp\"}";
  jsonPayload += "}";

  WiFiClientSecure secureClient;
  prepareTlsClient(secureClient);
  HTTPClient http;
  http.begin(secureClient, getHistoryUrl());
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  feedWatchdog();
  int httpResponseCode = http.sendRequest("POST", jsonPayload);
  if (httpResponseCode == 401) {
    DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in history post. "
                  "Invalidating token.");
    firebaseAuthValid = false;
  } else if (httpResponseCode >= 200 && httpResponseCode < 300) {
    markCloudOk();
    DEBUG_PRINTF("[History] Sample successfully posted to /history/tanks/%d.\n",
                 TANK_ID);
  } else {
    DEBUG_PRINTF("[History] Failed to post history sample. HTTP Code: %d\n",
                 httpResponseCode);
  }
  http.end();
}

// =================================================================================
// SENSOR TASK  (Core 1)
// Handles: sensor sampling, stabilization, spike rejection, relay driving,
//          alert state machine.
// This task NEVER touches WiFi, HTTP, or Firebase so it runs uninterrupted.
// =================================================================================
void sensorTask(void *pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe to hardware watchdog

  Serial.println("[SensorTask] Started on Core " + String(xPortGetCoreID()));

  // Pre-fill filter buffers
  for (int i = 0; i < FILTER_MEDIAN_WINDOW; i++) {
    levelRawSamples[i] = readLevelVoltageCalibrated();
    phRawSamples[i] = readVoltageOversampled(PH_SENSOR_PIN);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  levelBufferFilled = true;
  phBufferFilled = true;

  unsigned long lastProcessTime = 0;

  for (;;) {
    esp_task_wdt_reset(); // Pet the watchdog

    // 1. Sample raw ADC values every 20 ms
    sampleSensorsNonBlocking();

    // 2. Every 200 ms: run full processing pipeline
    unsigned long now = millis();
    if (now - lastProcessTime >= SENSOR_PROCESSING_INTERVAL) {
      lastProcessTime = now;

      processPhSensor();
      processLevelSensor();

      // Snapshot current values for alert evaluation
      int lvlPct;
      float phV;
      if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
        lvlPct = stabilizedWaterLevelPercent;
        phV = stabilizedPhValue;
        xSemaphoreGive(sensorDataMutex);
      } else {
        vTaskDelay(pdMS_TO_TICKS(1));
        continue;
      }

      // Alert state machine
      bool isLowAbnormal = (lowLevelAlert.state == STATE_NORMAL)
                               ? (lvlPct < lowLevelThreshold)
                               : !(lvlPct >= (lowLevelThreshold + 2.0));

      bool isHighAbnormal = (highLevelAlert.state == STATE_NORMAL)
                                ? (lvlPct > overflowThreshold)
                                : !(lvlPct <= (overflowThreshold - 2.0));

      bool isPhAbnormal =
          (phAlert.state == STATE_NORMAL)
              ? (phV < minPh || phV > maxPh)
              : !(phV >= (minPh + 0.15) && phV <= (maxPh - 0.15));

      updateAlertState(lowLevelAlert, isLowAbnormal,
                       "Water level is extremely low: " + String(lvlPct) + "%");
      updateAlertState(
          highLevelAlert, isHighAbnormal,
          "Water level is reaching overflow capacity: " + String(lvlPct) + "%");
      updateAlertState(phAlert, isPhAbnormal,
                       "Unsafe pH level detected: " + String(phV, 2));

      // Drive relay directly with no network dependency (no pin when PUMP_RELAY_ENABLED is 0)
      bool desiredPumpState = currentPumpState;
      if (desiredPumpState != lastActualPumpState) {
#if PUMP_RELAY_ENABLED
        digitalWrite(RELAY_PIN, desiredPumpState ? HIGH : LOW);
#endif
        lastActualPumpState = desiredPumpState;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5)); // Yield to other tasks
  }
}

// =================================================================================
// NETWORK TASK  (Core 0)
// Handles: WiFi/Ethernet management, Firebase auth, command polling,
//          sensor upload, config sync, history posting, RAM log flushing.
// All blocking TLS/HTTP calls live here, away from the sensor loop.
// =================================================================================
void networkTask(void *pvParameters) {
  esp_task_wdt_add(NULL); // Subscribe to hardware watchdog

  Serial.println("[NetworkTask] Started on Core " + String(xPortGetCoreID()));

  static bool lastSentPhHealth = true;
  static bool lastSentLevelHealth = true;
  // Link last reported to the dashboard. A change (Ethernet <-> Wi-Fi) is written
  // at once, so the dashboard shows a failover when it happens, not at the next
  // 10 s heartbeat.
  static bool lastSentEthLink = false;
  static bool lastSentWifiLink = false;
  static String lastSentPumpFault = "";

  for (;;) {
    esp_task_wdt_reset(); // Pet the watchdog

    // 0. Deferred work from WiFi/ETH event callbacks
    processDeferredNetworkWork();

    // 1. Manage WiFi reconnection
    manageConnections();

    // 2. Network watchdog: zombie socket detector
    checkNetworkWatchdog();

    // 2b. Back to Ethernet after a slow/no-internet switch to Wi-Fi
    checkEthernetRecovery();

    // 2c. Last resort: restart if nothing has reached Firebase for minutes
    checkCloudWatchdog();

    // 3. Low-heap guard
    {
      uint32_t freeHeap = ESP.getFreeHeap();
      DEBUG_PRINTF("[Heap] Free: %u bytes\n", freeHeap);
      if (freeHeap < MINIMUM_SAFE_HEAP && commandClientConfigured) {
        Serial.printf(
            "[HeapGuard] Free heap (%u B) below safe threshold (%u B). "
            "Resetting TLS client to prevent allocation failure.\n",
            freeHeap, MINIMUM_SAFE_HEAP);
        commandClient.stop();
        commandClientConfigured = false;
      }
    }

    // 4. Proactively refresh Firebase auth token
    if (isNetworkConnected()) {
      ensureFirebaseAuth();
    }

    // 5. Flush offline-buffered logs on reconnect
    if (isNetworkConnected() && firebaseConnected && ramLogCount > 0) {
      flushRamLogBuffer();
    }

    // 6. Automatic pump control decision (calls Firebase if state changes)
    processAutomaticPumpControl();

    // =============================================================
    // 7. CONSOLIDATED COMMAND POLLING (READS from Firebase)
    // =============================================================
    if (isNetworkConnected() && !linkUploadFirst &&
        (millis() - lastCommandPoll >= currentCommandPollInterval)) {
      lastCommandPoll = millis();
      unsigned long pollStartTime = millis();

      if (ensureFirebaseAuth()) {
        HTTPClient http;
        http.setReuse(true);
        http.begin(firebaseClient(), getTanksUrl());
        http.setTimeout(HTTP_TIMEOUT_MS);
        feedWatchdog();
        int httpResponseCode = http.GET();

        if (httpResponseCode == 401) {
          DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in command "
                        "polling. Invalidating token.");
          firebaseAuthValid = false;
        }

        if (httpResponseCode >= 200 && httpResponseCode < 300) {
          bool wasDisconnected = !firebaseConnected;
          firebaseConnected = true;
          markCloudOk();
          firebaseErrorCount = 0;
          currentCommandPollInterval = COMMAND_POLL_INTERVAL;

          if (wasDisconnected || ramLogCount > 0) {
            flushRamLogBuffer();
          }

          String payload = http.getString();
          payload.trim();

          bool firebasePump = getBoolFromJson(payload, "pumpOn");

          if (pumpSyncPending) {
            // The database does not hold our pump state yet: write it first
            // and read commands from the next poll on.
            updateFirebasePumpState(currentPumpState);
          } else if (hasKeyInJson(payload, "pumpOn") &&
                     firebasePump != lastSentPumpState) {
            if (firebasePump) {
              // Manual ON command requested
              bool lvlOk;
              int lvlPct;
              if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) ==
                  pdTRUE) {
                lvlOk = levelSensorOk;
                lvlPct = stabilizedWaterLevelPercent;
                xSemaphoreGive(sensorDataMutex);
              } else {
                lvlOk = false;
                lvlPct = 0;
              }

              if (!pumpDemoMode) {
                DEBUG_PRINTLN("[Pump] Manual ON command refused: Pump system "
                              "is off.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Pump system "
                               "is off.",
                               LEVEL_WARNING);
                updateFirebasePumpStateWithResult(false, "refused-demo-off");
                currentPumpState = false;
              } else if (lvlOk && lvlPct >= 0 && lvlPct >= (int)overflowThreshold) {
                DEBUG_PRINTLN(
                    "[Pump] Manual ON command refused: Water level is "
                    "at or above overflowThreshold.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Water level (" +
                                   String(lvlPct) +
                                   "%) is at or above overflow threshold (" +
                                   String((int)overflowThreshold) + "%).",
                               LEVEL_WARNING);
                updateFirebasePumpStateWithResult(false, "refused-overflow");
                currentPumpState = false;
              } else if (maintenanceActive()) {
                DEBUG_PRINTLN("[Pump] Manual ON command refused: Maintenance "
                              "mode is active.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Maintenance "
                               "mode is active.",
                               LEVEL_WARNING);
                updateFirebasePumpStateWithResult(false, "refused-maintenance");
                currentPumpState = false;
              } else if (pumpControlLock) {
                DEBUG_PRINTLN("[Pump] Manual toggle refused: Pump control lock "
                              "is enabled.");
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump toggle refused: Pump control lock is enabled.",
                    LEVEL_WARNING);
                updateFirebasePumpStateWithResult(currentPumpState,
                                                  "refused-lock");
              } else if (!lvlOk) {
                DEBUG_PRINTLN("[Pump] Manual ON command refused: Level sensor "
                              "is faulty.");
                logSystemEvent("Pump Controller",
                               "Manual pump ON command refused: Water level "
                               "sensor is faulty.",
                               LEVEL_CRITICAL);
                updateFirebasePumpStateWithResult(false, "refused-level-sensor");
                currentPumpState = false;
              } else {
                if (pumpFaultReason.length() > 0) {
                  logSystemEvent("Pump Controller",
                                 "Pump fault \"" + pumpFaultReason +
                                     "\" cleared by a manual ON command.",
                                 LEVEL_INFO);
                  pumpFaultReason = "";
                }
                currentPumpState = true;
                notePumpStarted(lvlPct);
                lastSentPumpState = true;
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump ON command accepted. Water level: " +
                        String(lvlPct) + "%",
                    LEVEL_INFO);
                acknowledgePumpCommand("accepted");
              }
            } else {
              // Manual OFF command requested
              if (pumpControlLock) {
                DEBUG_PRINTLN("[Pump] Manual toggle refused: Pump control lock "
                              "is enabled.");
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump toggle refused: Pump control lock is enabled.",
                    LEVEL_WARNING);
                updateFirebasePumpStateWithResult(currentPumpState,
                                                  "refused-lock");
              } else {
                currentPumpState = false;
                lastSentPumpState = false;
                lastPumpStopTime = millis();
                logSystemEvent(
                    "Pump Controller",
                    "Manual pump OFF command accepted. Water level: " +
                        String(stabilizedWaterLevelPercent) + "%",
                    LEVEL_INFO);
                acknowledgePumpCommand("accepted");
              }
            }
          }

          // --- DYNAMIC CALIBRATION SYNC ---
          if (hasKeyInJson(payload, "levelVmin")) {
            float val = getFloatFromJson(payload, "levelVmin");
            if (val != -999.0)
              levelVmin = val;
          }
          if (hasKeyInJson(payload, "levelVmax")) {
            float val = getFloatFromJson(payload, "levelVmax");
            if (val != -999.0)
              levelVmax = val;
          }
          if (hasKeyInJson(payload, "tankHeight")) {
            float val = getFloatFromJson(payload, "tankHeight");
            if (val != -999.0)
              tankHeight = val;
          }
          if (hasKeyInJson(payload, "levelOffset")) {
            float val = getFloatFromJson(payload, "levelOffset");
            if (val != -999.0)
              levelOffset = val;
          }
          if (hasKeyInJson(payload, "phNeutralVoltage")) {
            float val = getFloatFromJson(payload, "phNeutralVoltage");
            if (val != -999.0)
              phNeutralVoltage = val;
          }
          if (hasKeyInJson(payload, "phSlope")) {
            float val = getFloatFromJson(payload, "phSlope");
            if (val != -999.0)
              phSlope = val;
          }
          if (hasKeyInJson(payload, "phOffset")) {
            float val = getFloatFromJson(payload, "phOffset");
            if (val != -999.0)
              phOffset = val;
          }

          // --- THIS TANK'S OWN THRESHOLDS (tanks/{TANK_ID}/thresholds) ---
          // Used only when all four are there and valid (low < overflow within
          // 0-100 %, min pH < max pH within 0-14), the same check as the web app.
          {
            float ownLow = getFloatFromJson(payload, "lowLevelThreshold");
            float ownHigh = getFloatFromJson(payload, "overflowThreshold");
            float ownPhMin = getFloatFromJson(payload, "minPh");
            float ownPhMax = getFloatFromJson(payload, "maxPh");
            bool ownValid = ownLow != -999.0 && ownHigh != -999.0 &&
                            ownPhMin != -999.0 && ownPhMax != -999.0 &&
                            ownLow >= 0 && ownHigh <= 100 && ownLow < ownHigh &&
                            ownPhMin >= 0 && ownPhMax <= 14 &&
                            ownPhMin < ownPhMax;
            bool changed =
                ownValid != ownThresholdsSet ||
                (ownValid &&
                 (ownLow != ownLowLevelThreshold ||
                  ownHigh != ownOverflowThreshold || ownPhMin != ownMinPh ||
                  ownPhMax != ownMaxPh));
            if (ownValid) {
              ownLowLevelThreshold = ownLow;
              ownOverflowThreshold = ownHigh;
              ownMinPh = ownPhMin;
              ownMaxPh = ownPhMax;
            }
            ownThresholdsSet = ownValid;
            applyThresholds();
            if (changed) {
              logSystemEvent(
                  "Pump Controller",
                  ownValid ? "Using this tank's own thresholds: low " +
                                 String((int)ownLow) + "%, overflow " +
                                 String((int)ownHigh) + "%, pH " +
                                 String(ownPhMin, 1) + "-" +
                                 String(ownPhMax, 1)
                           : String("Using the shared thresholds"),
                  LEVEL_INFO);
            }
          }

          // --- LIVE CALIBRATION VIEW (calibrationUntil set by an admin) ---
          long newCalibUntil =
              hasKeyInJson(payload, "calibrationUntil")
                  ? getEpochSecFromJson(payload, "calibrationUntil")
                  : 0;
          if (newCalibUntil != calibUntilSec) {
            calibUntilSec = newCalibUntil;
            calibSeenAtMs = millis();
          }

          // --- PER-TANK MAINTENANCE (tanks/{TANK_ID}/maintenanceMode) ---
          bool newTankMaintenance =
              hasKeyInJson(payload, "maintenanceMode") &&
              getBoolFromJson(payload, "maintenanceMode");
          if (newTankMaintenance != tankMaintenanceMode) {
            tankMaintenanceMode = newTankMaintenance;
            logSystemEvent("Pump Controller",
                           String("Tank maintenance mode ") +
                               (tankMaintenanceMode ? "enabled" : "disabled"),
                           LEVEL_INFO);
          }
        } else {
          commandClient.stop();
          firebaseConnected = false;
          firebaseErrorCount++;
          currentCommandPollInterval =
              min(COMMAND_POLL_INTERVAL * (1 << min(firebaseErrorCount, 3)),
                  30000UL);

          DEBUG_PRINTF(
              "Error polling commands. HTTP Code: %d. Backing off to %lds\n",
              httpResponseCode, currentCommandPollInterval / 1000);
        }
        http.end();

        // Poll /config for the shared thresholds and system switches
        HTTPClient httpConfig;
        httpConfig.setReuse(true);
        httpConfig.begin(firebaseClient(), getConfigUrl());
        httpConfig.setTimeout(HTTP_TIMEOUT_MS);
        feedWatchdog();
        int configResponseCode = httpConfig.GET();

        if (configResponseCode == 401) {
          DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in config "
                        "polling. Invalidating token.");
          firebaseAuthValid = false;
        }

        if (configResponseCode >= 200 && configResponseCode < 300) {
          String configPayload = httpConfig.getString();
          configPayload.trim();

          if (hasKeyInJson(configPayload, "lowLevelThreshold")) {
            float val = getFloatFromJson(configPayload, "lowLevelThreshold");
            if (val != -999.0)
              sharedLowLevelThreshold = val;
          }
          if (hasKeyInJson(configPayload, "overflowThreshold")) {
            float val = getFloatFromJson(configPayload, "overflowThreshold");
            if (val != -999.0)
              sharedOverflowThreshold = val;
          }
          if (hasKeyInJson(configPayload, "minPh")) {
            float val = getFloatFromJson(configPayload, "minPh");
            if (val != -999.0)
              sharedMinPh = val;
          }
          if (hasKeyInJson(configPayload, "maxPh")) {
            float val = getFloatFromJson(configPayload, "maxPh");
            if (val != -999.0)
              sharedMaxPh = val;
          }
          applyThresholds(); // the tank's own values win when set
          if (hasKeyInJson(configPayload, "maintenanceMode")) {
            maintenanceMode = getBoolFromJson(configPayload, "maintenanceMode");
          }
          if (hasKeyInJson(configPayload, "pumpControlLock")) {
            pumpControlLock = getBoolFromJson(configPayload, "pumpControlLock");
          }
          if (hasKeyInJson(configPayload, "pumpDemoMode")) {
            pumpDemoMode = getBoolFromJson(configPayload, "pumpDemoMode");
          }
          // pumpMode: only "manual" selects manual; missing or anything else = auto.
          // Changing mode never switches the pump itself.
          bool newManualMode =
              hasKeyInJson(configPayload, "pumpMode") &&
              getStringFromJson(configPayload, "pumpMode") == "manual";
          if (!pumpModeLoaded) {
            pumpManualMode = newManualMode;
            pumpModeLoaded = true;
            DEBUG_PRINTF("[Pump] Pump mode at startup: %s\n",
                         pumpManualMode ? "MANUAL" : "AUTO");
          } else if (newManualMode != pumpManualMode) {
            pumpManualMode = newManualMode;
            logSystemEvent("Pump Controller",
                           String("Pump mode changed to ") +
                               (pumpManualMode ? "MANUAL" : "AUTO"),
                           LEVEL_INFO);
          }
        } else {
          if (configResponseCode <= 0) {
            commandClient.stop();
          }
          DEBUG_PRINTF(
              "Config read failed (HTTP %d). Falling back to last known "
              "thresholds (%.1f/%.1f/%.2f/%.2f)\n",
              configResponseCode, lowLevelThreshold, overflowThreshold, minPh,
              maxPh);
        }
        httpConfig.end();
      }

      unsigned long pollDuration = millis() - pollStartTime;
      bool pollOk = firebaseConnected &&
                    (long)(lastFirebaseSuccessTime - pollStartTime) >= 0;
      checkEthernetQuality(pollOk, pollDuration);
      // Slow polls are counted and summarized at most every 10 min (one log
      // per slow poll filled /logs: 4,265 entries in 4 days).
      if (pollDuration > ETH_SLOW_POLL_MS) {
        slowPollCount++;
        if (pollDuration > slowestPollMs)
          slowestPollMs = pollDuration;
      }
      if (slowPollCount > 0 &&
          millis() - lastSlowPollLog >= SLOW_POLL_LOG_INTERVAL_MS) {
        lastSlowPollLog = millis();
        logSystemEvent("System Performance",
                       String(slowPollCount) +
                           " command poll(s) took longer than " +
                           String(ETH_SLOW_POLL_MS) +
                           " ms in the last 10 min (slowest " +
                           String(slowestPollMs) + " ms)",
                       LEVEL_WARNING);
        slowPollCount = 0;
        slowestPollMs = 0;
      }
    }

    // 7b. Once per boot, after Firebase answers: log why the controller started
    if (!bootReported && firebaseConnected && !linkUploadFirst) {
      reportBootReason();
    }

    // =============================================================
    // 8. CONDITIONAL SENSOR UPLOADS (WRITES to Firebase)
    // =============================================================

    // Snapshot shared data under mutex
    int snapLevel;
    float snapPh, snapHeight;
    bool snapPhOk, snapLevelOk;
    if (xSemaphoreTake(sensorDataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
      snapLevel = stabilizedWaterLevelPercent;
      snapPh = stabilizedPhValue;
      snapHeight = stabilizedWaterHeight;
      snapPhOk = phSensorOk;
      snapLevelOk = levelSensorOk;
      xSemaphoreGive(sensorDataMutex);
    } else {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    bool levelChangedSignificantly =
        (lastSentWaterLevelPercent == -999) ||
        (abs(snapLevel - lastSentWaterLevelPercent) >= WATER_LEVEL_DEADBAND);
    bool phChangedSignificantly =
        (lastSentPhValue == -999.0) ||
        (abs(snapPh - lastSentPhValue) >= PH_LEVEL_DEADBAND);
    bool phHealthChanged = (snapPhOk != lastSentPhHealth);
    bool levelHealthChanged = (snapLevelOk != lastSentLevelHealth);
    String snapPumpFault = pumpFaultReason;
    bool pumpFaultChanged = (snapPumpFault != lastSentPumpFault);
    bool alertStateChanged =
        (lowLevelAlert.state != lastSentLowLevelAlertState) ||
        (highLevelAlert.state != lastSentHighLevelAlertState) ||
        (phAlert.state != lastSentPhAlertState);
    bool snapEth = ethActive();
    bool snapWifi = wifiConnected;
    bool linkChanged =
        (snapEth != lastSentEthLink) || (snapWifi != lastSentWifiLink);
    bool heartbeatElapsed =
        (millis() - lastSensorWrite >= SENSOR_WRITE_HEARTBEAT);
    bool rateLimitElapsed = (millis() - lastSensorWrite >= MIN_WRITE_INTERVAL);
    // Live calibration view: upload every MIN_WRITE_INTERVAL (1 s) while open.
    bool calibLive = calibrationLiveOn();
    if (calibLive != calibLiveWasOn) {
      calibLiveWasOn = calibLive;
      logSystemEvent("Calibration",
                     calibLive ? "Live calibration readings started (sent "
                                 "once per second)."
                               : "Live calibration readings stopped.",
                     LEVEL_INFO);
    }

    if (isNetworkConnected()) {
      if (rateLimitElapsed &&
          (levelChangedSignificantly || phChangedSignificantly ||
           phHealthChanged || levelHealthChanged ||
           alertStateChanged || linkChanged || pumpFaultChanged ||
           heartbeatElapsed ||
           calibLive)) {
        if (ensureFirebaseAuth()) {

          // Compute overall status from alert states
          String status = "safe";
          if (lowLevelAlert.state == STATE_CRITICAL ||
              phAlert.state == STATE_CRITICAL) {
            status = "danger";
          } else if (highLevelAlert.state == STATE_WARNING) {
            status = "warning";
          }

          String jsonPayload;
          jsonPayload.reserve(704);

          jsonPayload = "{";
          jsonPayload += "\"waterLevel\":" + String(snapLevel) + ",";
          jsonPayload += "\"phLevel\":" + String(snapPh, 2) + ",";
          jsonPayload += "\"waterHeight\":" + String(snapHeight, 2) + ",";
          jsonPayload += "\"status\":\"" + status + "\",";
          // No pumpOn here: it is written only by updateFirebasePumpState().
          // pumpFault: set by the dry-run guard; null removes it.
          jsonPayload += "\"pumpFault\":" +
                         (snapPumpFault.length() > 0
                              ? "\"" + snapPumpFault + "\""
                              : String("null")) +
                         ",";
          jsonPayload +=
              "\"phSensorOk\":" + String(snapPhOk ? "true" : "false") + ",";
          jsonPayload +=
              "\"levelSensorOk\":" + String(snapLevelOk ? "true" : "false") +
              ",";
          jsonPayload += "\"lowLevelAlert\":\"" +
                         getAlertStateStr(lowLevelAlert.state) + "\",";
          jsonPayload += "\"highLevelAlert\":\"" +
                         getAlertStateStr(highLevelAlert.state) + "\",";
          jsonPayload +=
              "\"phAlert\":\"" + getAlertStateStr(phAlert.state) + "\",";
          jsonPayload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
          jsonPayload +=
              "\"wifiConnected\":" + String(snapWifi ? "true" : "false") +
              ",";
          jsonPayload += "\"firebaseConnected\":" +
                         String(firebaseConnected ? "true" : "false") + ",";
          jsonPayload +=
              "\"ethConnected\":" + String(snapEth ? "true" : "false") +
              ",";
          if (calibLive) {
            jsonPayload += "\"calibrationLive\":{";
            jsonPayload += "\"voltage\":" + String((float)liveLevelVoltage, 3) + ",";
            jsonPayload += "\"heightM\":" + String((float)liveLevelHeight, 3) + ",";
            jsonPayload += "\"percent\":" + String((int)liveLevelPercent) + ",";
            jsonPayload += "\"phVoltage\":" + String((float)livePhVoltage, 3) + ",";
            jsonPayload += "\"at\":{\".sv\":\"timestamp\"}},";
          }
          jsonPayload += "\"lastUpdate\":{\".sv\":\"timestamp\"}";
          jsonPayload += "}";

          // Same keep-alive connection as the command poll: no new TLS
          // handshake (1-2 s on this link) for every upload.
          HTTPClient http;
          http.setReuse(true);
          http.begin(firebaseClient(), getTanksUrl());
          http.setTimeout(HTTP_TIMEOUT_MS);
          http.addHeader("Content-Type", "application/json");

          feedWatchdog();
          int httpResponseCode = http.sendRequest("PATCH", jsonPayload);
          if (httpResponseCode == 401) {
            DEBUG_PRINTLN("[FirebaseAuth] Received 401 Unauthorized in sensor "
                          "upload. Invalidating token.");
            firebaseAuthValid = false;
          }

          if (httpResponseCode >= 200 && httpResponseCode < 300) {
            DEBUG_PRINTLN("Firebase Sensors Updated successfully.");
            linkUploadFirst = false;
            bool wasDisconnected = !firebaseConnected;
            if (wasDisconnected) {
              logSystemEvent(
                  "Firebase Recovery",
                  "Firebase live sensor connection successfully restored.",
                  LEVEL_INFO);
            }
            firebaseConnected = true;
            markCloudOk();
            firebaseErrorCount = 0;
            currentCommandPollInterval = COMMAND_POLL_INTERVAL;

            if (wasDisconnected || ramLogCount > 0) {
              flushRamLogBuffer();
            }

            lastSentWaterLevelPercent = snapLevel;
            lastSentPhValue = snapPh;
            lastSentWaterHeight = snapHeight;
            lastSentPhHealth = snapPhOk;
            lastSentLevelHealth = snapLevelOk;
            lastSentLowLevelAlertState = lowLevelAlert.state;
            lastSentHighLevelAlertState = highLevelAlert.state;
            lastSentPhAlertState = phAlert.state;
            lastSentEthLink = snapEth;
            lastSentWifiLink = snapWifi;
            lastSentPumpFault = snapPumpFault;
            lastSensorWrite = millis();
          } else {
            if (httpResponseCode <= 0) {
              commandClient.stop(); // broken socket: the next request reconnects
            }
            firebaseConnected = false;
            firebaseErrorCount++;
            currentCommandPollInterval =
                min(COMMAND_POLL_INTERVAL * (1 << min(firebaseErrorCount, 3)),
                    30000UL);

            DEBUG_PRINTLN("Error Sending Data to Firebase!");
            logSystemEvent("Firebase Error",
                           "Failed to patch live sensor data. HTTP Code: " +
                               String(httpResponseCode),
                           LEVEL_ERROR);
          }
          http.end();
        }
      }
    } else if (!isNetworkConnected() &&
               millis() - lastSensorWrite > SENSOR_WRITE_HEARTBEAT) {
      lastSensorWrite = millis();
      DEBUG_PRINTLN("No Internet Connection. All remote updates failing.");
    }

    // =============================================================
    // 9. HISTORICAL TELEMETRY SAMPLING (EVERY 10 MINUTES)
    // =============================================================
    if (isNetworkConnected()) {
      if (lastHistorySampleTime == 0) {
        if (snapLevel != -999) {
          lastHistorySampleTime = millis();
          postHistorySample();
        }
      } else if (millis() - lastHistorySampleTime >= HISTORY_SAMPLE_INTERVAL) {
        lastHistorySampleTime = millis();
        postHistorySample();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10)); // Yield - prevents starvation of other tasks
  }
}

// ==========================================
// Setup
// ==========================================
void setup() {
  Serial.begin(115200);
  vTaskDelay(pdMS_TO_TICKS(1000));

  Serial.println(
      "Starting ESP32 Water Monitor System (FreeRTOS dual-core mode)...");

#if PUMP_RELAY_ENABLED
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
#endif

  prepareTlsClient(commandClient);
  commandClientConfigured = true;

  // RTC memory holds garbage after a power cut: start the restart info fresh.
  esp_reset_reason_t bootReason = esp_reset_reason();
  Serial.println("Reset reason: " + resetReasonText(bootReason));
  if (rtcRestartMagic != RESTART_INFO_MAGIC || bootReason == ESP_RST_POWERON ||
      bootReason == ESP_RST_BROWNOUT) {
    rtcRestartMagic = RESTART_INFO_MAGIC;
    rtcNoCloudRestarts = 0;
    rtcLastRestartWasNoCloud = 0;
    rtcLastNoCloudSeconds = 0;
  }

  // Create the shared sensor data mutex
  sensorDataMutex = xSemaphoreCreateMutex();
  if (sensorDataMutex == NULL) {
    Serial.println("[FATAL] Failed to create sensorDataMutex!");
    while (true) {
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }

  // Configure hardware watchdog timer.
  // If any FreeRTOS task hangs for WDT_TIMEOUT_SECONDS, the board resets.
  esp_task_wdt_config_t wdtConfig = {.timeout_ms = WDT_TIMEOUT_SECONDS * 1000,
                                     .idle_core_mask = 0,
                                     .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdtConfig);

  WiFi.onEvent(WiFiEvent);

  Serial.println("Initializing WiFi Backup...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Disable WiFi modem sleep. This prevents the router from silently
  // deauthenticating the board after ~30 minutes of low traffic.
  WiFi.setSleep(false);

  Serial.println("Initializing Ethernet...");
  SPI.begin(ETH_SPI_SCK, ETH_SPI_MISO, ETH_SPI_MOSI);
  if (!ETH.begin(ETH_TYPE, ETH_ADDR, ETH_SPI_CS, ETH_SPI_INT, ETH_SPI_RST, SPI)) {
    Serial.println("W5500 not found: check SPI wiring and 3.3V power. Using Wi-Fi only.");
  }

  // Spawn sensorTask on Core 1 (dedicated to real-time sensor work)
  xTaskCreatePinnedToCore(
      sensorTask,   // task function
      "SensorTask", // name for debugging
      10240,        // stack in bytes (expanded from 8KB for safety buffer)
      NULL,         // parameter
      2,            // priority (higher = more urgent; sensors must not starve)
      NULL,         // task handle (not needed)
      1             // CPU core 1
  );

  // Spawn networkTask on Core 0 (the "protocol CPU" which also handles WiFi
  // stack)
  xTaskCreatePinnedToCore(
      networkTask,   // task function
      "NetworkTask", // name for debugging
      20480,         // stack in bytes (TLS + HTTP needs a large stack)
      NULL,          // parameter
      1,             // priority (lower than sensorTask)
      NULL,          // task handle (not needed)
      0              // CPU core 0
  );

  Serial.println("FreeRTOS tasks launched. System Ready.");

  // Arduino's loop() task runs on Core 1 at priority 1.
  // We don't use it, so delete it to free 8KB of stack memory.
  vTaskDelete(NULL);
}

// loop() is intentionally left empty.
// All work is done in the FreeRTOS tasks above.
void loop() {}
