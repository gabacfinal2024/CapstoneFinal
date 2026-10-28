/*
 * AgriResQ ESP32-CAM node  (AI-Thinker ESP32-CAM, OV2640 or OV5640)
 *
 * Smart-home style setup. Nothing is hard-coded; the stall operator sets the camera up
 * from the AgriResQ app (docs/IOT_DEVICE_API.md):
 *
 *  SETUP mode  – no Wi-Fi saved: opens hotspot "AgriResQ-XXXX" (password "agriresq").
 *                The app (or a browser at http://192.168.4.1) sends the stall Wi-Fi,
 *                the server URL and a pairing code. The camera joins the Wi-Fi and
 *                claims itself with Django (POST /api/devices/claim/).
 *  NORMAL mode – heartbeat every 5 s (receives settings + commands), auto freshness
 *                scans (JPEG -> /api/devices/upload-scan/), optional DHT22 readings,
 *                live view: http://<ip>/capture  and  http://<ip>:81/stream
 *
 * Reset to setup mode: power-cycle 3 times within 10 s, or "Forget Wi-Fi" in the app.
 * Red LED (GPIO33): slow blink = setup mode, fast blink = connecting, off = running.
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "esp_camera.h"
#include "mbedtls/base64.h"
#include "mbedtls/md.h"
#include "esp_http_server.h"

#define FW_VERSION "1.1.1"

// AI-Thinker ESP32-CAM pins
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22
#define FLASH_LED_PIN 4
#define STATUS_LED_PIN 33  // red LED on the back, active LOW

static const char *AP_PASSWORD = "agriresq";
static const uint32_t WIFI_JOIN_TIMEOUT_MS = 20000;
static const uint32_t FALLBACK_TO_SETUP_MS = 60000;
static const uint32_t DHT_PERIOD_MS = 60000;
static const uint16_t DISCOVERY_PORT = 41234;  // backend answers 'where is the server?' here

Preferences prefs;
DNSServer dns;
httpd_handle_t web_httpd = NULL;     // port 80
httpd_handle_t stream_httpd = NULL;  // port 81

enum Mode { MODE_SETUP, MODE_NORMAL };
Mode mode = MODE_SETUP;
bool cameraOk = false;
String apName;
String macStr;

// saved in NVS
String cfgSsid, cfgPass, cfgServer, cfgToken;

// settings received from the server in every heartbeat
struct DeviceConfig {
  String cropType = "EGGPLANT";
  bool autoScan = true;
  uint32_t scanIntervalS = 300;
  int dhtPin = -1;
  bool flashOnScan = false;
  uint32_t heartbeatS = 5;
} conf;

// setup-mode provisioning state (read by GET /status)
volatile bool provisionRequested = false;
String provSsid, provPass, provServer, provCode;
String setupState = "idle";
String setupMessage = "Waiting for Wi-Fi details from the AgriResQ app.";

DHT *dht = NULL;
int dhtActivePin = -1;
uint32_t lastHeartbeat = 0, lastScan = 0, lastDht = 0, lastWifiOk = 0, lastSetupRetry = 0;

// ───────────────────────────── helpers ─────────────────────────────

void statusLed(bool on) { digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH); }

void loadPrefs() {
  prefs.begin("agriresq", true);
  cfgSsid = prefs.getString("ssid", "");
  cfgPass = prefs.getString("pass", "");
  cfgServer = prefs.getString("server", "");
  cfgToken = prefs.getString("token", "");
  prefs.end();
}

void savePrefs() {
  prefs.begin("agriresq", false);
  prefs.putString("ssid", cfgSsid);
  prefs.putString("pass", cfgPass);
  prefs.putString("server", cfgServer);
  prefs.putString("token", cfgToken);
  prefs.end();
}

void factoryReset(const char *why) {
  Serial.printf("Resetting to setup mode: %s\n", why);
  cfgSsid = cfgPass = cfgToken = "";
  savePrefs();
  delay(300);
  ESP.restart();
}

// Power-cycle 3x within 10 s → setup mode (no buttons are free on the ESP32-CAM).
void checkTripleReset() {
  prefs.begin("agriresq", false);
  int count = prefs.getInt("rst", 0) + 1;
  prefs.putInt("rst", count);
  prefs.end();
  if (count >= 3) {
    prefs.begin("agriresq", false);
    prefs.putInt("rst", 0);
    prefs.end();
    factoryReset("power-cycled 3 times");
  }
}

void clearTripleReset() {
  static bool cleared = false;
  if (!cleared && millis() > 10000) {
    prefs.begin("agriresq", false);
    prefs.putInt("rst", 0);
    prefs.end();
    cleared = true;
  }
}

String jsonEscape(const String &s) {
  String out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    if ((uint8_t)c >= 0x20) out += c;
  }
  return out;
}

// ───────────────────────────── camera ─────────────────────────────

void applyCameraTuning(sensor_t *s);

// Colour/exposure defaults. The OV5640 module ships with a strong magenta cast under
// indoor light unless white balance is explicitly enabled; the freshness CNN relies on
// colour, so a neutral image matters. Tune live over USB serial: "set wb_mode 1" etc.
void applyCameraTuning(sensor_t *s) {
  if (!s) return;
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 0);        // 0 auto, 1 sunny, 2 cloudy, 3 office, 4 home
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_lenc(s, 1);           // lens shading correction (removes the dark/tinted corners)
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_saturation(s, 0);
}

bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM; c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_VGA;  // 640x480: enough for the 288 px CNN, light on Wi-Fi
  c.jpeg_quality = 12;
  c.fb_count = psramFound() ? 2 : 1;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  Serial.printf("Camera ready (sensor PID 0x%x)\n", s ? s->id.PID : 0);
  return true;
}

// Fresh frame for a scan: drop the buffered one so exposure/flash are current.
camera_fb_t *captureFresh(bool flash) {
  if (flash) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(120);
  }
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  if (flash) digitalWrite(FLASH_LED_PIN, LOW);
  return fb;
}

// ───────────────────────────── HTTP (device side) ─────────────────────────────

void cors(httpd_req_t *req) {
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
  // lets an https page (Chrome Private Network Access) reach the camera on the LAN
  httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
}

esp_err_t sendJson(httpd_req_t *req, const String &body, const char *status = "200 OK") {
  cors(req);
  httpd_resp_set_status(req, status);
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body.c_str(), body.length());
}

esp_err_t optionsHandler(httpd_req_t *req) {
  cors(req);
  httpd_resp_set_status(req, "204 No Content");
  return httpd_resp_send(req, NULL, 0);
}

esp_err_t infoHandler(httpd_req_t *req) {
  String body = String("{\"device\":\"AgriResQ-CAM\",\"mac\":\"") + macStr + "\",\"fw\":\"" FW_VERSION
                "\",\"mode\":\"" + (mode == MODE_SETUP ? "setup" : "normal") + "\",\"camera\":" +
                (cameraOk ? "true" : "false") + ",\"name\":\"" + apName + "\"}";
  return sendJson(req, body);
}

esp_err_t captureHandler(httpd_req_t *req) {
  if (!cameraOk) return sendJson(req, "{\"error\":\"camera not ready\"}", "503 Service Unavailable");
  char q[32] = {0}, flash[4] = {0};
  bool useFlash = httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK &&
                  httpd_query_key_value(q, "flash", flash, sizeof(flash)) == ESP_OK && flash[0] == '1';
  camera_fb_t *fb = captureFresh(useFlash);
  if (!fb) return sendJson(req, "{\"error\":\"capture failed\"}", "500 Internal Server Error");
  cors(req);
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

#define PART_BOUNDARY "agriresqframe"
esp_err_t streamHandler(httpd_req_t *req) {
  if (!cameraOk) return sendJson(req, "{\"error\":\"camera not ready\"}", "503 Service Unavailable");
  cors(req);
  httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" PART_BOUNDARY);
  char part[96];
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) return ESP_FAIL;
    size_t hlen = snprintf(part, sizeof(part),
                           "\r\n--" PART_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                           (unsigned)fb->len);
    esp_err_t res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) return res;  // viewer closed the page
    delay(80);                      // ~10 fps keeps the CPU free for scans and heartbeats
  }
}

esp_err_t networksHandler(httpd_req_t *req) {
  int n = WiFi.scanNetworks(false, false);
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.isEmpty()) continue;
    bool dup = false;
    for (JsonObject o : arr) {
      if (o["ssid"] == ssid) { dup = true; break; }
    }
    if (dup) continue;
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = ssid;
    o["rssi"] = WiFi.RSSI(i);
    o["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  WiFi.scanDelete();
  String body;
  serializeJson(doc, body);
  return sendJson(req, body);
}

esp_err_t provisionHandler(httpd_req_t *req) {
  if (req->content_len == 0 || req->content_len > 1024)
    return sendJson(req, "{\"ok\":false,\"error\":\"bad request\"}", "400 Bad Request");
  char buf[1025];
  int got = 0;
  while (got < (int)req->content_len) {
    int r = httpd_req_recv(req, buf + got, req->content_len - got);
    if (r <= 0) return ESP_FAIL;
    got += r;
  }
  buf[got] = 0;
  JsonDocument doc;
  if (deserializeJson(doc, buf)) return sendJson(req, "{\"ok\":false,\"error\":\"invalid JSON\"}", "400 Bad Request");
  String ssid = doc["ssid"] | "", pass = doc["password"] | "", server = doc["server"] | "", code = doc["code"] | "";
  server.trim();
  while (server.endsWith("/") || server.endsWith(".")) server.remove(server.length() - 1);  // stray "." / "/" from typing
  code.trim();
  code.toUpperCase();
  if (ssid.isEmpty() || server.isEmpty() || code.length() < 4)
    return sendJson(req, "{\"ok\":false,\"error\":\"ssid, server and code are required\"}", "400 Bad Request");
  if (!server.startsWith("http://") && !server.startsWith("https://")) server = "http://" + server;
  provSsid = ssid; provPass = pass; provServer = server; provCode = code;
  setupState = "connecting";
  setupMessage = "Connecting to " + ssid + "...";
  provisionRequested = true;
  return sendJson(req, "{\"ok\":true}");
}

esp_err_t statusHandler(httpd_req_t *req) {
  String body = "{\"state\":\"" + setupState + "\",\"message\":\"" + jsonEscape(setupMessage) +
                "\",\"mode\":\"" + (mode == MODE_SETUP ? "setup" : "normal") + "\",\"ip\":\"" +
                WiFi.localIP().toString() + "\"}";
  return sendJson(req, body);
}

static const char SETUP_PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AgriResQ Camera Setup</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f2;margin:0;padding:16px;color:#1d2b22}
.card{background:#fff;border-radius:14px;padding:18px;max-width:420px;margin:auto;box-shadow:0 2px 10px #0001}
h1{font-size:20px;color:#2A6B48;margin:0 0 4px}p{font-size:14px;color:#555}label{display:block;font-size:13px;
font-weight:600;margin:12px 0 4px}input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd;
border-radius:8px;font-size:15px}button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;
background:#2A6B48;color:#fff;font-size:16px;font-weight:600}#msg{margin-top:12px;font-size:14px}</style></head>
<body><div class="card"><h1>AgriResQ Camera Setup</h1>
<p>Easiest: use <b>Add device</b> in the AgriResQ app. Or enter the details from the app here.</p>
<label>Stall Wi-Fi (2.4 GHz)</label><select id="ssid"><option>Scanning...</option></select>
<input id="ssid2" placeholder="or type the Wi-Fi name" style="margin-top:6px">
<label>Wi-Fi password</label><input id="pass" type="password">
<label>Pairing code (from the app)</label><input id="code" maxlength="8" style="text-transform:uppercase">
<label>Server address (from the app)</label><input id="server" placeholder="http://192.168.1.4:8000">
<button onclick="go()">Connect camera</button><div id="msg"></div></div>
<script>
const $=id=>document.getElementById(id);
fetch('/networks').then(r=>r.json()).then(l=>{$('ssid').innerHTML=l.map(n=>`<option>${n.ssid}</option>`).join('')||'<option value="">No networks found</option>'});
async function go(){const b={ssid:$('ssid2').value||$('ssid').value,password:$('pass').value,code:$('code').value,server:$('server').value};
$('msg').textContent='Sending...';const r=await fetch('/provision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const j=await r.json();if(!j.ok){$('msg').textContent=j.error;return}poll()}
async function poll(){try{const s=await (await fetch('/status')).json();$('msg').textContent=s.message;
if(s.state==='done'||s.state.endsWith('failed'))return}catch(e){$('msg').textContent='Camera is joining your Wi-Fi. Reconnect this phone to your normal Wi-Fi and check the app.';return}
setTimeout(poll,1500)}
</script></body></html>)HTML";

esp_err_t setupPageHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, SETUP_PAGE, HTTPD_RESP_USE_STRLEN);
}

// Captive portal: any unknown URL (e.g. Android's generate_204) opens the setup page.
esp_err_t captiveRedirect(httpd_req_t *req) {
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
  return httpd_resp_send(req, NULL, 0);
}

void registerUri(httpd_handle_t h, const char *uri, httpd_method_t m, esp_err_t (*fn)(httpd_req_t *)) {
  httpd_uri_t u = {};
  u.uri = uri;
  u.method = m;
  u.handler = fn;
  httpd_register_uri_handler(h, &u);
}

void startWebServer(bool setup) {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = 80;
  cfg.ctrl_port = 32768;
  cfg.max_uri_handlers = 16;
  cfg.uri_match_fn = httpd_uri_match_wildcard;
  cfg.lru_purge_enable = true;
  if (httpd_start(&web_httpd, &cfg) != ESP_OK) return;
  registerUri(web_httpd, "/info", HTTP_GET, infoHandler);
  registerUri(web_httpd, "/status", HTTP_GET, statusHandler);
  registerUri(web_httpd, "/capture", HTTP_GET, captureHandler);
  registerUri(web_httpd, "/*", HTTP_OPTIONS, optionsHandler);
  if (setup) {
    registerUri(web_httpd, "/", HTTP_GET, setupPageHandler);
    registerUri(web_httpd, "/networks", HTTP_GET, networksHandler);
    registerUri(web_httpd, "/provision", HTTP_POST, provisionHandler);
    registerUri(web_httpd, "/*", HTTP_GET, captiveRedirect);
  } else {
    httpd_config_t scfg = HTTPD_DEFAULT_CONFIG();
    scfg.server_port = 81;
    scfg.ctrl_port = 32769;
    if (httpd_start(&stream_httpd, &scfg) == ESP_OK) registerUri(stream_httpd, "/stream", HTTP_GET, streamHandler);
  }
}

// ───────────────────────────── HTTP (server side) ─────────────────────────────

int postJson(const String &path, const String &body, String &response, bool withToken = true) {
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(cfgServer + path)) return -1;
  http.addHeader("Content-Type", "application/json");
  if (withToken) http.addHeader("X-Device-Token", cfgToken);
  int code = http.POST(body);
  response = code > 0 ? http.getString() : http.errorToString(code);
  http.end();
  return code;
}

void handleServerAuthFailure(int code) {
  if (code == 401) factoryReset("device was removed in the app");
}

void applyConfig(JsonObject c) {
  if (c.isNull()) return;
  conf.cropType = c["crop_type"] | conf.cropType;
  conf.autoScan = c["auto_scan"] | conf.autoScan;
  conf.scanIntervalS = max<uint32_t>(15, c["scan_interval_s"] | conf.scanIntervalS);
  conf.dhtPin = c["dht_pin"] | conf.dhtPin;
  conf.flashOnScan = c["flash_on_scan"] | conf.flashOnScan;
  conf.heartbeatS = max<uint32_t>(2, c["heartbeat_s"] | conf.heartbeatS);
}

void doScan(const char *source) {
  if (!cameraOk) return;
  camera_fb_t *fb = captureFresh(conf.flashOnScan);
  if (!fb) {
    Serial.println("Scan: capture failed");
    return;
  }
  HTTPClient http;
  http.setTimeout(20000);
  http.begin(cfgServer + "/api/devices/upload-scan/");
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Token", cfgToken);
  http.addHeader("X-Scan-Source", source);
  int code = http.POST(fb->buf, fb->len);
  String resp = code > 0 ? http.getString() : http.errorToString(code);
  http.end();
  esp_camera_fb_return(fb);
  Serial.printf("Scan (%s): HTTP %d %s\n", source, code, resp.substring(0, 120).c_str());
  handleServerAuthFailure(code);
}

bool discoverServer();

void heartbeat() {
  String body = String("{\"ip\":\"") + WiFi.localIP().toString() + "\",\"rssi\":" + WiFi.RSSI() +
                ",\"fw\":\"" FW_VERSION "\",\"uptime_s\":" + (millis() / 1000) + ",\"wifi_ssid\":\"" +
                jsonEscape(WiFi.SSID()) + "\"}";
  String resp;
  int code = postJson("/api/devices/heartbeat/", body, resp);
  static uint8_t failStreak = 0;
  if (code != 200) {
    Serial.printf("Heartbeat: HTTP %d %s\n", code, resp.substring(0, 80).c_str());
    handleServerAuthFailure(code);
    // server unreachable (not "removed"): its address probably changed
    if (code <= 0 && ++failStreak >= 3) {
      failStreak = 0;
      Serial.println("Server unreachable: searching the network for it...");
      if (discoverServer()) Serial.println("Server found.");
    }
    return;
  }
  failStreak = 0;
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  applyConfig(doc["config"]);
  String cmd = doc["command"] | "";
  if (cmd.isEmpty()) return;
  Serial.printf("Command: %s\n", cmd.c_str());
  if (cmd == "scan_now") doScan("MANUAL");
  else if (cmd == "scan_auto") doScan("AUTO");   // scheduled capture window / heat emergency (server-initiated)
  else if (cmd == "reboot") { delay(200); ESP.restart(); }
  else if (cmd == "forget_wifi" || cmd == "unpair") factoryReset("requested from the app");
}

void readDht() {
  if (conf.dhtPin < 0) return;
  if (conf.dhtPin != dhtActivePin) {
    delete dht;
    dht = new DHT(conf.dhtPin, DHT22);
    dht->begin();
    dhtActivePin = conf.dhtPin;
    delay(2000);  // DHT22 needs ~2 s after power-up
  }
  float t = dht->readTemperature(), h = dht->readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.printf("DHT22 on GPIO %d: no reading (check wiring)\n", conf.dhtPin);
    return;
  }
  String resp;
  int code = postJson("/api/devices/reading/",
                      String("{\"temperature_c\":") + String(t, 1) + ",\"humidity_rh\":" + String(h, 1) + "}", resp);
  Serial.printf("Reading %.1f C %.1f%%: HTTP %d\n", t, h, code);
  handleServerAuthFailure(code);
}

// ───────────────────────────── modes ─────────────────────────────

bool joinWifi(const String &ssid, const String &pass, uint32_t timeoutMs) {
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    statusLed((millis() / 150) % 2);
    if (mode == MODE_SETUP) dns.processNextRequest();
    delay(50);
  }
  statusLed(false);
  return WiFi.status() == WL_CONNECTED;
}

void startSetupMode() {
  mode = MODE_SETUP;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apName.c_str(), AP_PASSWORD);
  delay(200);
  dns.start(53, "*", WiFi.softAPIP());
  startWebServer(true);
  Serial.printf("SETUP MODE: join Wi-Fi \"%s\" (password %s) and open http://%s\n", apName.c_str(), AP_PASSWORD,
                WiFi.softAPIP().toString().c_str());
}

void runProvisioning() {
  provisionRequested = false;
  WiFi.disconnect();
  if (!joinWifi(provSsid, provPass, WIFI_JOIN_TIMEOUT_MS)) {
    WiFi.disconnect();
    setupState = "wifi_failed";
    setupMessage = "Could not join \"" + provSsid + "\". Check the password and that it is a 2.4 GHz network.";
    Serial.println(setupMessage);
    return;
  }
  setupState = "claiming";
  setupMessage = "Joined Wi-Fi (" + WiFi.localIP().toString() + "). Registering with AgriResQ...";
  Serial.println(setupMessage);

  cfgServer = provServer;
  String body = String("{\"code\":\"") + jsonEscape(provCode) + "\",\"mac\":\"" + macStr + "\",\"fw\":\"" FW_VERSION
                "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"wifi_ssid\":\"" + jsonEscape(provSsid) + "\"}";
  String resp;
  int code = postJson("/api/devices/claim/", body, resp, false);
  JsonDocument doc;
  if (code != 201 || deserializeJson(doc, resp) || !doc["device_token"].is<const char *>()) {
    String detail = doc["detail"] | "";
    setupState = "claim_failed";
    setupMessage = code <= 0 ? "Joined Wi-Fi but cannot reach the AgriResQ server at " + provServer +
                                   ". Is the server running on the same network?"
                             : "Server refused the pairing (" + String(code) + "): " + detail;
    Serial.println(setupMessage);
    WiFi.disconnect();
    return;
  }
  cfgSsid = provSsid;
  cfgPass = provPass;
  cfgToken = doc["device_token"].as<String>();
  savePrefs();
  setupState = "done";
  setupMessage = "Camera connected! Reconnect your phone to your normal Wi-Fi.";
  Serial.println(setupMessage);
  uint32_t t = millis();
  while (millis() - t < 4000) { dns.processNextRequest(); delay(20); }  // let the app read /status
  ESP.restart();
}

void setupLoop() {
  dns.processNextRequest();
  statusLed((millis() / 700) % 2);
  if (provisionRequested) runProvisioning();
  // Saved Wi-Fi came back (router reboot / power cut)? Go back to normal mode.
  if (!cfgSsid.isEmpty() && !cfgToken.isEmpty() && setupState == "idle" &&
      millis() - lastSetupRetry > FALLBACK_TO_SETUP_MS) {
    lastSetupRetry = millis();
    if (joinWifi(cfgSsid, cfgPass, 8000)) ESP.restart();
    WiFi.disconnect();
  }
}

void normalLoop() {
  uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    statusLed((now / 150) % 2);
    if (now - lastWifiOk > FALLBACK_TO_SETUP_MS) {
      Serial.println("Saved Wi-Fi unreachable for 60 s: opening setup hotspot");
      httpd_stop(web_httpd);
      httpd_stop(stream_httpd);
      lastSetupRetry = millis();
      startSetupMode();
    }
    return;
  }
  lastWifiOk = now;
  statusLed(false);
  if (now - lastHeartbeat >= conf.heartbeatS * 1000UL) {
    lastHeartbeat = now;
    heartbeat();
  }
  if (conf.autoScan && now - lastScan >= conf.scanIntervalS * 1000UL) {
    lastScan = millis();
    doScan("AUTO");
  }
  if (conf.dhtPin >= 0 && now - lastDht >= DHT_PERIOD_MS) {
    lastDht = millis();
    readDht();
  }
}

// ───────────────────────────── server discovery ─────────────────────────────
// The laptop running the backend gets a new IP whenever the router or Wi-Fi changes.
// Instead of orphaning the camera, it broadcasts "where is the server?" on the LAN; the
// backend answers with its address, signed with this device's token (so nobody on the
// network can redirect the camera).

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

bool discoverServer() {
  if (cfgToken.length() < 8 || WiFi.status() != WL_CONNECTED) return false;
  WiFiUDP udp;
  if (!udp.begin(DISCOVERY_PORT + 1)) return false;
  String nonce = String((uint32_t)esp_random(), HEX);
  String q = "{\"nonce\":\"" + nonce + "\",\"tid\":\"" + cfgToken.substring(0, 8) + "\"}";
  IPAddress bcast((uint32_t)WiFi.localIP() | ~(uint32_t)WiFi.subnetMask());
  udp.beginPacket(bcast, DISCOVERY_PORT);
  udp.print(q);
  udp.endPacket();
  uint32_t t = millis();
  while (millis() - t < 2500) {
    int n = udp.parsePacket();
    if (n > 0) {
      char buf[257];
      int len = udp.read(buf, 256);
      buf[len > 0 ? len : 0] = 0;
      JsonDocument d;
      if (!deserializeJson(d, buf)) {
        String server = d["server"] | "", sig = d["sig"] | "";
        if (!server.isEmpty() && sig == hmacHex(cfgToken, nonce + server)) {
          udp.stop();
          if (server != cfgServer) {
            Serial.printf("Server moved: %s -> %s\n", cfgServer.c_str(), server.c_str());
            cfgServer = server;
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

// ───────────────────────────── USB serial console ─────────────────────────────
// Open the serial monitor (115200) and type:  help

void serialSnap() {
  if (!cameraOk) { Serial.println("SNAP_FAIL camera not ready"); return; }
  camera_fb_t *fb = captureFresh(false);
  if (!fb) { Serial.println("SNAP_FAIL"); return; }
  Serial.printf("<<SNAP %u>>\n", (unsigned)fb->len);
  uint8_t out[1025];
  for (size_t pos = 0; pos < fb->len; pos += 768) {
    size_t n = min((size_t)768, fb->len - pos), olen = 0;
    mbedtls_base64_encode(out, sizeof(out), &olen, fb->buf + pos, n);
    Serial.write(out, olen);
  }
  Serial.println("\n<<END>>");
  esp_camera_fb_return(fb);
}

void serialSet(const String &name, int v) {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) { Serial.println("no camera"); return; }
  int r = -99;
  if (name == "wb_mode") r = s->set_wb_mode(s, v);
  else if (name == "whitebal") r = s->set_whitebal(s, v);
  else if (name == "awb_gain") r = s->set_awb_gain(s, v);
  else if (name == "saturation") r = s->set_saturation(s, v);
  else if (name == "contrast") r = s->set_contrast(s, v);
  else if (name == "brightness") r = s->set_brightness(s, v);
  else if (name == "sharpness") r = s->set_sharpness(s, v);
  else if (name == "lenc") r = s->set_lenc(s, v);
  else if (name == "ae_level") r = s->set_ae_level(s, v);
  else if (name == "aec") r = s->set_exposure_ctrl(s, v);
  else if (name == "aec2") r = s->set_aec2(s, v);
  else if (name == "aec_value") r = s->set_aec_value(s, v);
  else if (name == "agc") r = s->set_gain_ctrl(s, v);
  else if (name == "agc_gain") r = s->set_agc_gain(s, v);
  else if (name == "gainceiling") r = s->set_gainceiling(s, (gainceiling_t)v);
  else if (name == "special_effect") r = s->set_special_effect(s, v);
  else if (name == "raw_gma") r = s->set_raw_gma(s, v);
  else if (name == "dcw") r = s->set_dcw(s, v);
  else if (name == "hmirror") r = s->set_hmirror(s, v);
  else if (name == "vflip") r = s->set_vflip(s, v);
  else if (name == "quality") r = s->set_quality(s, v);
  else if (name == "framesize") r = s->set_framesize(s, (framesize_t)v);
  Serial.printf("set %s=%d -> %d%s\n", name.c_str(), v, r, r == -99 ? " (unknown name)" : "");
}

String serialLine;
void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (serialLine.length() < 300) serialLine += c; continue; }
    String line = serialLine;
    serialLine = "";
    line.trim();
    if (line.isEmpty()) continue;
    if (line == "help") {
      Serial.println("snap                      print a JPEG frame as base64 (<<SNAP n>> ... <<END>>)\n"
                     "set <name> <value>        tune camera (wb_mode, whitebal, saturation, aec_value, ...)\n"
                     "status                    mode, Wi-Fi, server\n"
                     "wifi ssid|password|server|code   set up over USB (setup mode only)\n"
                     "reset                     forget Wi-Fi + pairing, back to setup mode");
    } else if (line == "snap") serialSnap();
    else if (line.startsWith("set ")) {
      int sp = line.indexOf(' ', 4);
      if (sp > 0) serialSet(line.substring(4, sp), line.substring(sp + 1).toInt());
    } else if (line == "status") {
      Serial.printf("fw %s  mode %s  wifi %s  ip %s  server %s  paired %s  mac %s\n", FW_VERSION,
                    mode == MODE_SETUP ? "setup" : "normal", WiFi.isConnected() ? WiFi.SSID().c_str() : "-",
                    WiFi.localIP().toString().c_str(), cfgServer.c_str(), cfgToken.isEmpty() ? "no" : "yes",
                    macStr.c_str());
    } else if (line.startsWith("wifi ")) {
      if (mode != MODE_SETUP) { Serial.println("Not in setup mode. Type: reset"); continue; }
      int a = line.indexOf('|'), b = line.indexOf('|', a + 1), d = line.indexOf('|', b + 1);
      if (a < 0 || b < 0 || d < 0) { Serial.println("usage: wifi ssid|password|server|code"); continue; }
      provSsid = line.substring(5, a); provPass = line.substring(a + 1, b);
      provServer = line.substring(b + 1, d); provCode = line.substring(d + 1);
      provServer.trim(); provCode.trim(); provCode.toUpperCase();
      while (provServer.endsWith("/") || provServer.endsWith(".")) provServer.remove(provServer.length() - 1);
      if (!provServer.startsWith("http")) provServer = "http://" + provServer;
      setupState = "connecting";
      setupMessage = "Connecting to " + provSsid + "...";
      provisionRequested = true;
    } else if (line == "reset") factoryReset("serial command");
    else Serial.println("unknown command; type: help");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== AgriResQ ESP32-CAM  fw " FW_VERSION " ===");
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  statusLed(true);

  macStr = WiFi.macAddress();
  String suffix = macStr.substring(12);
  suffix.replace(":", "");
  apName = "AgriResQ-" + suffix;

  checkTripleReset();
  loadPrefs();
  cameraOk = initCamera();

  if (cfgSsid.isEmpty() || cfgToken.isEmpty() || cfgServer.isEmpty()) {
    startSetupMode();
    return;
  }
  mode = MODE_NORMAL;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // smoother live view
  WiFi.setAutoReconnect(true);
  Serial.printf("Joining \"%s\"...\n", cfgSsid.c_str());
  if (joinWifi(cfgSsid, cfgPass, WIFI_JOIN_TIMEOUT_MS)) {
    Serial.printf("Online: http://%s/capture  stream http://%s:81/stream  server %s\n",
                  WiFi.localIP().toString().c_str(), WiFi.localIP().toString().c_str(), cfgServer.c_str());
  }
  lastWifiOk = millis();
  startWebServer(false);
  lastScan = millis() - conf.scanIntervalS * 1000UL + 15000;  // first auto-scan ~15 s after boot
}

void loop() {
  handleSerial();
  clearTripleReset();
  if (mode == MODE_SETUP) setupLoop();
  else normalLoop();
  delay(10);
}
