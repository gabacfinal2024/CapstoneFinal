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
 * First start:
 *   1. copy include/secrets.h.example to include/secrets.h and fill in Wi-Fi
 *   2. pio run -t upload, then pio device monitor (115200)
 *   3. in the AgriResQ app: Devices > Add device > Sensor, copy the server URL and 6-letter code
 *   4. type   server URL   then   pair CODE   in the serial monitor.
 * Serial commands: server URL | pair CODE | unpair | status | read | help
 */
#include <Arduino.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

#include "secrets.h"   // WIFI_SSID, WIFI_PASSWORD, SERVER_URL (and optionally PAIRING_CODE)

#ifndef DHT_PIN
#define DHT_PIN 4
#endif
#ifndef PAIRING_CODE
#define PAIRING_CODE ""
#endif

static const char *FW_VERSION = "sensor-1.0.0";
static const uint16_t DISCOVERY_PORT = 41234;
static const uint32_t READ_PERIOD_S = 30;
static const uint32_t HEARTBEAT_PERIOD_S = 15;
static const uint32_t WIFI_TIMEOUT_MS = 20000;

DHT dht(DHT_PIN, DHT22);
Preferences prefs;
String server, token, pendingCode = PAIRING_CODE;
uint32_t lastBeat = 0, lastRead = 0, lastClaim = 0, lastGoodHttp = 0;
float lastT = NAN, lastH = NAN;

String mac() { return WiFi.macAddress(); }   // upper-case "AA:BB:CC:DD:EE:FF"

void loadPrefs() {
  prefs.begin("agrinode", true);
  token = prefs.getString("token", "");
  server = prefs.getString("server", "");
  prefs.end();
  if (server.isEmpty()) server = SERVER_URL;
}

void savePrefs() {
  prefs.begin("agrinode", false);
  prefs.putString("token", token);
  prefs.putString("server", server);
  prefs.end();
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("Wi-Fi: joining %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
  return true;
}

// ── talking to the hub ──────────────────────────────────────────────────────

int postJson(const String &path, const String &body, String &resp, bool withToken = true) {
  if (server.isEmpty()) return -1;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  http.begin(server + path);
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

void claim() {
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
      return;
    }
  }
  if (code <= 0) {
    Serial.printf("Pairing: cannot reach the hub at %s (check SERVER_URL, same Wi-Fi, firewall)\n", server.c_str());
  } else {
    JsonDocument r;
    deserializeJson(r, resp);
    Serial.printf("Pairing failed (HTTP %d): %s\n", code, (const char *)(r["detail"] | "unknown error"));
    if (code == 400 || code == 409) pendingCode = "";   // a bad or used code will not start working by retrying
  }
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
      savePrefs();
      Serial.println("Unpaired from the app.");
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
    if (!nextServer.startsWith("http://") ||
        nextServer.length() > 200 || nextServer.indexOf(' ') >= 0) {
      Serial.println("This firmware uses the local laptop backend. Use: server http://<laptop-LAN-IP>:8000");
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
  connectWifi();
  if (token.isEmpty() && pendingCode.isEmpty()) {
    Serial.println("Not paired. In Devices > Add device > Sensor, type the shown server URL, then pair CODE.");
  }
}

void loop() {
  handleSerial();
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
      claim();
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
