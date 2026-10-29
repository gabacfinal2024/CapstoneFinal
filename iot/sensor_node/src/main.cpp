/*
 * AgriResQ sensor node: plain ESP32 DevKit + DHT22.
 *
 * Pairs with the AgriResQ hub exactly like the ESP32-CAM does (POST /api/devices/claim/), then sends the
 * DHT22 temperature and humidity every READ_PERIOD_S seconds (POST /api/devices/reading/) plus a heartbeat,
 * so the node shows up in the web dashboard and the mobile app (online status, IP address, readings) and
 * its readings feed the rule engine that ages the linked batch.
 *
 * Wiring:  DHT22 DATA -> GPIO 4 (see DHT_PIN), VCC -> 3V3, GND -> GND, 10 kΩ pull-up between DATA and 3V3
 *          (most DHT22 breakout boards already have it).
 *
 * First start: flash once, then use the AgriResQ mobile app to configure Wi-Fi and pair.
 * Serial commands remain available for diagnostics: server URL | pair CODE | unpair | status | read
 */
#include <Arduino.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include "mbedtls/md.h"

#include "secrets.h"   // WIFI_SSID, WIFI_PASSWORD, SERVER_URL (and optionally PAIRING_CODE)

#ifndef DHT_PIN
#define DHT_PIN 4
#endif
#ifndef PAIRING_CODE
#define PAIRING_CODE ""
#endif

static const char *FW_VERSION = "sensor-1.2.0";
static const uint16_t DISCOVERY_PORT = 41234;
static const uint32_t READ_PERIOD_S = 30;
static const uint32_t HEARTBEAT_PERIOD_S = 15;
static const uint32_t WIFI_TIMEOUT_MS = 20000;
static const char *SETUP_AP_PASSWORD = "agriresq";
static const IPAddress SETUP_AP_IP(192, 168, 4, 1);
static const char *GTS_ROOT_R4 = R"PEM(
-----BEGIN CERTIFICATE-----
MIICCjCCAZGgAwIBAgIQbkepyIuUtui7OyrYorLBmTAKBggqhkjOPQQDAzBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQA
IgNiAATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzu
hXyiQHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/l
xKvRHYqjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1Ud
DgQWBBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNnADBkAjBqUFJ0
CMRw3J5QdCHojXohw0+WbhXRIjVhLfoIN+4Zba3bssx9BzT1YBkstTTZbyACMANx
sbqjYAuG7ZoIapVon+Kz4ZNkfF6Tpt95LY2F45TPI11xzPKwTdb+mciUqXWi4w==
-----END CERTIFICATE-----
)PEM";

DHT dht(DHT_PIN, DHT22);
Preferences prefs;
WebServer setupHttp(80);
DNSServer setupDns;
String server, token, pendingCode = PAIRING_CODE, wifiSsid, wifiPassword, setupApSsid;
uint32_t lastBeat = 0, lastRead = 0, lastClaim = 0, lastGoodHttp = 0;
float lastT = NAN, lastH = NAN;
bool setupMode = false, provisioningRequested = false;
bool setupRoutesRegistered = false;
String setupState = "idle", setupMessage = "Waiting for setup from the AgriResQ app.";

String mac() { return WiFi.macAddress(); }   // upper-case "AA:BB:CC:DD:EE:FF"

void loadPrefs() {
  prefs.begin("agrinode", true);
  token = prefs.getString("token", "");
  server = prefs.getString("server", "");
  wifiSsid = prefs.getString("wifi_ssid", WIFI_SSID);
  wifiPassword = prefs.getString("wifi_password", WIFI_PASSWORD);
  prefs.end();
  if (server.isEmpty()) server = SERVER_URL;
}

void savePrefs() {
  prefs.begin("agrinode", false);
  prefs.putString("token", token);
  prefs.putString("server", server);
  prefs.putString("wifi_ssid", wifiSsid);
  prefs.putString("wifi_password", wifiPassword);
  prefs.end();
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (wifiSsid.isEmpty()) return false;
  Serial.printf("Wi-Fi: joining %s ", wifiSsid.c_str());
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS) {
    delay(400);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi: could not join. Check WIFI_SSID / WIFI_PASSWORD (2.4 GHz only).");
    return false;
  }
  Serial.printf("Wi-Fi: connected, IP %s\n", WiFi.localIP().toString().c_str());
  configTime(0, 0, "time.google.com", "pool.ntp.org");
  time_t now = time(nullptr);
  uint32_t syncStarted = millis();
  while (now < 1760000000 && millis() - syncStarted < 15000) {
    delay(250);
    now = time(nullptr);
  }
  if (now < 1760000000) {
    Serial.println("Clock: NTP sync failed; hosted HTTPS requests need working internet time.");
  } else {
    Serial.println("Clock: synchronized for HTTPS certificate validation.");
  }
  return true;
}

void addCorsHeaders() {
  setupHttp.sendHeader("Access-Control-Allow-Origin", "*");
  setupHttp.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setupHttp.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  setupHttp.sendHeader("Access-Control-Max-Age", "600");
}

void sendSetupJson(int status, const String &body) {
  addCorsHeaders();
  setupHttp.send(status, "application/json", body);
}

void handleSetupOptions() {
  addCorsHeaders();
  setupHttp.send(204);
}

void handleSetupInfo() {
  JsonDocument d;
  d["kind"] = "SENSOR";
  d["mac"] = mac();
  d["fw"] = FW_VERSION;
  d["setup_ap_ssid"] = setupApSsid;
  d["setup_ap_password"] = SETUP_AP_PASSWORD;
  String body;
  serializeJson(d, body);
  sendSetupJson(200, body);
}

void handleSetupNetworks() {
  int count = WiFi.scanNetworks(false, true);
  JsonDocument d;
  JsonArray networks = d.to<JsonArray>();
  for (int i = 0; i < count; ++i) {
    String ssid = WiFi.SSID(i);
    if (ssid.isEmpty()) continue;
    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = ssid;
    network["rssi"] = WiFi.RSSI(i);
    network["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  WiFi.scanDelete();
  String body;
  serializeJson(d, body);
  sendSetupJson(200, body);
}

void handleSetupStatus() {
  JsonDocument d;
  d["state"] = setupState;
  d["message"] = setupMessage;
  String body;
  serializeJson(d, body);
  sendSetupJson(200, body);
}

void handleSetupProvision() {
  JsonDocument input;
  String raw = setupHttp.arg("plain");
  if (!raw.isEmpty()) {
    DeserializationError error = deserializeJson(input, raw);
    if (error) {
      sendSetupJson(400, "{\"detail\":\"Invalid setup request.\"}");
      return;
    }
  }
  String nextSsid = raw.isEmpty() ? setupHttp.arg("ssid") : String(input["ssid"] | "");
  String nextPassword = raw.isEmpty() ? setupHttp.arg("password") : String(input["password"] | "");
  String nextServer = raw.isEmpty() ? setupHttp.arg("server") : String(input["server"] | "");
  String nextCode = raw.isEmpty() ? setupHttp.arg("code") : String(input["code"] | "");
  nextSsid.trim();
  nextServer.trim();
  nextCode.trim();
  nextCode.toUpperCase();
  while (nextServer.endsWith("/")) nextServer.remove(nextServer.length() - 1);
  if (nextSsid.isEmpty() || nextSsid.length() > 32 || nextPassword.length() > 63 ||
      (!nextServer.startsWith("http://") && !nextServer.startsWith("https://")) ||
      nextServer.length() > 200 || nextServer.indexOf(' ') >= 0 ||
      nextCode.length() != 6) {
    sendSetupJson(400, "{\"detail\":\"Check the Wi-Fi name, password, server URL and six-character pairing code.\"}");
    return;
  }
  for (size_t i = 0; i < nextCode.length(); ++i) {
    if (!isAlphaNumeric(nextCode[i])) {
      sendSetupJson(400, "{\"detail\":\"The pairing code must contain six letters or numbers.\"}");
      return;
    }
  }
  wifiSsid = nextSsid;
  wifiPassword = nextPassword;
  server = nextServer;
  pendingCode = nextCode;
  token = "";
  savePrefs();
  setupState = "connecting";
  setupMessage = "Connecting to the selected Wi-Fi network.";
  provisioningRequested = true;
  if (raw.isEmpty()) {
    addCorsHeaders();
    setupHttp.send(202, "text/html",
      "<!doctype html><meta name='viewport' content='width=device-width'><title>AgriResQ setup</title>"
      "<h2>Setup saved</h2><p>Connect your phone to its normal internet Wi-Fi, then return to the AgriResQ app. "
      "The sensor is joining Wi-Fi and pairing now.</p>");
  } else {
    sendSetupJson(202, "{\"state\":\"connecting\"}");
  }
}

void startSetupMode() {
  if (setupMode) return;
  WiFi.mode(WIFI_AP_STA);
  String stationMac = WiFi.macAddress();
  stationMac.replace(":", "");
  setupApSsid = "AgriResQ-SENSOR-" + stationMac.substring(max(0, (int)stationMac.length() - 4));
  if (!WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_IP, IPAddress(255, 255, 255, 0)) ||
      !WiFi.softAP(setupApSsid.c_str(), SETUP_AP_PASSWORD)) {
    Serial.println("Setup hotspot failed to start.");
    setupMessage = "Could not start the setup hotspot. Restart the sensor and try again.";
    return;
  }
  setupDns.start(53, "*", SETUP_AP_IP);
  if (!setupRoutesRegistered) {
    setupHttp.on("/", HTTP_GET, []() {
      addCorsHeaders();
      setupHttp.send(200, "text/html",
        R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width">
        <title>AgriResQ sensor setup</title><style>body{font:16px sans-serif;max-width:480px;margin:2em auto;padding:0 1em;color:#183b2c}
        input,button{box-sizing:border-box;width:100%;padding:12px;margin:7px 0;font-size:16px}button{background:#2a6b48;color:white;border:0;border-radius:8px}</style>
        </head><body><h2>Connect your AgriResQ sensor</h2><p>Enter the stall Wi-Fi name and password (2.4 GHz), then submit to pair this sensor.</p>
        <form method="post" action="/provision"><label>Stall Wi-Fi name</label><input name="ssid" maxlength="32" required>
        <label>Wi-Fi password</label><input name="password" type="password" maxlength="63">
        <label>AgriResQ server</label><input id="server" name="server" value="https://agriresq.onrender.com" required>
        <label>Six-character pairing code</label><input id="code" name="code" maxlength="6" minlength="6" required>
        <button type="submit">Save Wi-Fi and pair sensor</button></form>
        <p>After submitting, reconnect your phone to internet Wi-Fi and return to AgriResQ.</p>
        <script>const q=new URLSearchParams(location.search);for(const k of ['server','code'])if(q.has(k))document.getElementById(k).value=q.get(k)</script></body></html>)HTML");
    });
    setupHttp.on("/info", HTTP_GET, handleSetupInfo);
    setupHttp.on("/networks", HTTP_GET, handleSetupNetworks);
    setupHttp.on("/status", HTTP_GET, handleSetupStatus);
    setupHttp.on("/provision", HTTP_POST, handleSetupProvision);
    setupHttp.on("/provision", HTTP_OPTIONS, handleSetupOptions);
    setupHttp.onNotFound([]() {
      addCorsHeaders();
      setupHttp.sendHeader("Location", "http://192.168.4.1/");
      setupHttp.send(302);
    });
    setupRoutesRegistered = true;
  }
  setupHttp.begin();
  setupMode = true;
  Serial.printf("Setup hotspot: %s (password: %s)\n", setupApSsid.c_str(), SETUP_AP_PASSWORD);
}

void stopSetupMode() {
  if (!setupMode) return;
  setupDns.stop();
  setupHttp.stop();
  WiFi.softAPdisconnect(true);
  setupMode = false;
}

void handleProvisioning() {
  if (!provisioningRequested) return;
  provisioningRequested = false;
  if (!connectWifi()) {
    setupState = "wifi_failed";
    setupMessage = "Could not join this Wi-Fi. Check the password and choose a 2.4 GHz network.";
    return;
  }
  setupState = "claiming";
  setupMessage = "Connected to Wi-Fi. Registering the sensor with AgriResQ.";
}

// ── talking to the hub ──────────────────────────────────────────────────────

int postJson(const String &path, const String &body, String &resp, bool withToken = true) {
  if (server.isEmpty()) return -1;
  HTTPClient http;
  WiFiClient localClient;
  WiFiClientSecure secureClient;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  bool started = false;
  if (server.startsWith("https://")) {
    secureClient.setCACert(GTS_ROOT_R4);
    started = http.begin(secureClient, server + path);
  } else if (server.startsWith("http://")) {
    started = http.begin(localClient, server + path);
  }
  if (!started) {
    Serial.printf("HTTP: unsupported server URL or connection setup failed: %s\n", server.c_str());
    return -1;
  }
  http.addHeader("Content-Type", "application/json");
  if (withToken) http.addHeader("X-Device-Token", token);
  int code = http.POST(body);
  resp = code > 0 ? http.getString() : "";
  http.end();
  if (code > 0 && code < 500) lastGoodHttp = millis();
  return code;
}

String hmacHex(const String &key, const String &msg) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const uint8_t *)key.c_str(), key.length());
  mbedtls_md_hmac_update(&ctx, (const uint8_t *)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]);
  return String(hex);
}

// The laptop gets a new IP whenever the router changes. Ask the LAN where the hub is; the answer is signed
// with this node's token, so nobody else on the network can redirect it.
bool discoverServer() {
  if (token.length() < 8 || WiFi.status() != WL_CONNECTED) return false;
  WiFiUDP udp;
  if (!udp.begin(DISCOVERY_PORT + 1)) return false;
  String nonce = String((uint32_t)esp_random(), HEX);
  String q = "{\"nonce\":\"" + nonce + "\",\"tid\":\"" + token.substring(0, 8) + "\"}";
  IPAddress bcast((uint32_t)WiFi.localIP() | ~(uint32_t)WiFi.subnetMask());
  udp.beginPacket(bcast, DISCOVERY_PORT);
  udp.print(q);
  udp.endPacket();
  uint32_t t = millis();
  while (millis() - t < 2500) {
    if (udp.parsePacket() > 0) {
      char buf[257];
      int len = udp.read(buf, 256);
      buf[len > 0 ? len : 0] = 0;
      JsonDocument d;
      if (!deserializeJson(d, buf)) {
        String s = d["server"] | "", sig = d["sig"] | "";
        if (!s.isEmpty() && sig == hmacHex(token, nonce + s)) {
          udp.stop();
          if (s != server) {
            Serial.printf("Hub moved: %s -> %s\n", server.c_str(), s.c_str());
            server = s;
            savePrefs();
          }
          return true;
        }
      }
    }
    delay(20);
  }
  udp.stop();
  return false;
}

bool claim() {
  pendingCode.trim();
  pendingCode.toUpperCase();
  JsonDocument d;
  d["code"] = pendingCode;
  d["mac"] = mac();
  d["fw"] = FW_VERSION;
  d["wifi_ssid"] = WiFi.SSID();
  d["kind"] = "SENSOR";
  d["dht_pin"] = DHT_PIN;
  String body, resp;
  serializeJson(d, body);
  int code = postJson("/api/devices/claim/", body, resp, false);
  if (code == 201) {
    JsonDocument r;
    if (!deserializeJson(r, resp)) {
      token = r["device_token"] | "";
      savePrefs();
      pendingCode = "";
      Serial.println("Paired. This node now appears in the AgriResQ app and dashboard.");
      setupState = "done";
      setupMessage = "Sensor paired successfully.";
      stopSetupMode();
      return true;
    }
  }
  if (code <= 0) {
    Serial.printf("Pairing: cannot reach the hub at %s (check SERVER_URL, same Wi-Fi, firewall)\n", server.c_str());
  } else {
    JsonDocument r;
    deserializeJson(r, resp);
    Serial.printf("Pairing failed (HTTP %d): %s\n", code, (const char *)(r["detail"] | "unknown error"));
    if (code == 400 || code == 409) {
      pendingCode = "";
      setupState = "claim_failed";
      setupMessage = (const char *)(r["detail"] | "Pairing code was rejected.");
    }
  }
  return false;
}

void sendHeartbeat() {
  JsonDocument d;
  d["rssi"] = WiFi.RSSI();
  d["fw"] = FW_VERSION;
  d["uptime_s"] = (uint32_t)(millis() / 1000);
  d["wifi_ssid"] = WiFi.SSID();
  String body, resp;
  serializeJson(d, body);
  int code = postJson("/api/devices/heartbeat/", body, resp);
  if (code == 401) {            // the hub does not know this token any more (node removed in the app)
    Serial.println("The hub removed this node. Type: pair CODE   to pair it again.");
    token = "";
    savePrefs();
    setupState = "idle";
    setupMessage = "Device was removed. Use the AgriResQ app to pair it again.";
    startSetupMode();
    return;
  }
  if (code <= 0) {
    Serial.println("Hub not reachable, looking for it on the network...");
    if (discoverServer()) Serial.println("Hub found.");
    return;
  }
  JsonDocument r;
  if (!deserializeJson(r, resp)) {
    String cmd = r["command"] | "";
    if (cmd == "reboot") ESP.restart();
    if (cmd == "unpair" || cmd == "forget_wifi") {
      token = "";
      pendingCode = "";
      if (cmd == "forget_wifi") {
        wifiSsid = "";
        wifiPassword = "";
      }
      savePrefs();
      setupState = "idle";
      setupMessage = "Use the AgriResQ app to configure Wi-Fi and pair this sensor.";
      startSetupMode();
      Serial.println("Unpaired from the app. Setup hotspot is ready.");
    }
  }
}

bool readDht(float &t, float &h) {
  t = dht.readTemperature();
  h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.printf("DHT22 on GPIO %d: no reading (check DATA wire, power, pull-up)\n", DHT_PIN);
    return false;
  }
  lastT = t;
  lastH = h;
  return true;
}

void sendReading() {
  float t, h;
  if (!readDht(t, h)) return;
  JsonDocument d;
  d["temperature_c"] = serialized(String(t, 1));
  d["humidity_rh"] = serialized(String(h, 1));
  String body, resp;
  serializeJson(d, body);
  int code = postJson("/api/devices/reading/", body, resp);
  Serial.printf("Reading %.1f C  %.1f %%RH  -> HTTP %d\n", t, h, code);
}

// ── serial console ──────────────────────────────────────────────────────────

void handleSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.isEmpty()) return;
  if (line.startsWith("server ")) {
    String nextServer = line.substring(7);
    nextServer.trim();
    while (nextServer.endsWith("/")) nextServer.remove(nextServer.length() - 1);
    if ((!nextServer.startsWith("http://") && !nextServer.startsWith("https://")) ||
        nextServer.length() > 200 || nextServer.indexOf(' ') >= 0) {
      Serial.println("Use: server http://<laptop-LAN-IP>:8000 or server https://<hosted-backend>");
    } else if (!token.isEmpty() && nextServer != server) {
      Serial.println("This node is already paired. Remove it from the old account, type unpair, then set the new server.");
    } else {
      server = nextServer;
      savePrefs();
      Serial.printf("Server saved: %s\n", server.c_str());
    }
  } else if (line.startsWith("pair ")) {
    pendingCode = line.substring(5);
    lastClaim = 0;
    Serial.println("Pairing...");
  } else if (line == "unpair") {
    token = "";
    savePrefs();
    setupState = "idle";
    setupMessage = "Use the AgriResQ app to configure Wi-Fi and pair this sensor.";
    startSetupMode();
    Serial.println("Cleared. Type: pair CODE");
  } else if (line == "read") {
    float t, h;
    if (readDht(t, h)) Serial.printf("%.1f C  %.1f %%RH\n", t, h);
  } else if (line == "status") {
    Serial.printf("Wi-Fi %s  IP %s  server %s  paired %s  last %.1f C %.1f %%RH\n",
                  WiFi.status() == WL_CONNECTED ? "up" : "down", WiFi.localIP().toString().c_str(), server.c_str(),
                  token.isEmpty() ? "no" : "yes", lastT, lastH);
  } else {
    Serial.println("Commands: server URL | pair CODE | unpair | status | read");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\nAgriResQ sensor node %s, MAC %s, DHT22 on GPIO %d\n", FW_VERSION, mac().c_str(), DHT_PIN);
  dht.begin();
  loadPrefs();
  if (token.isEmpty()) startSetupMode();
  connectWifi();
  if (token.isEmpty()) {
    Serial.println("Not paired. Open Devices > Add device > Sensor in the AgriResQ app and join the sensor hotspot.");
  }
}

void loop() {
  handleSerial();
  if (setupMode) {
    setupDns.processNextRequest();
    setupHttp.handleClient();
    handleProvisioning();
  }
  uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t lastTry = 0;
    if (now - lastTry > 15000) {
      lastTry = now;
      connectWifi();
    }
    delay(50);
    return;
  }
  if (token.isEmpty()) {
    if (!pendingCode.isEmpty() && (lastClaim == 0 || now - lastClaim > 15000)) {
      lastClaim = now ? now : 1;
      if (!claim() && pendingCode.isEmpty() && setupMode) {
        setupState = "claim_failed";
        if (setupMessage.isEmpty()) setupMessage = "The pairing code was rejected.";
      }
    }
    delay(50);
    return;
  }
  if (lastBeat == 0 || now - lastBeat >= HEARTBEAT_PERIOD_S * 1000UL) {
    lastBeat = now ? now : 1;
    sendHeartbeat();
  }
  if (lastRead == 0 || now - lastRead >= READ_PERIOD_S * 1000UL) {
    lastRead = now ? now : 1;
    sendReading();
  }
  delay(50);
}
