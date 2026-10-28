/*
 * AgriResQ ESP32 + DHT22 IoT Node
 * Sends temperature/humidity to Django backend via REST API
 *
 * Wiring: DHT22 DATA -> GPIO 4, VCC -> 3.3V, GND -> GND
 * Install: DHT sensor library by Adafruit
 */

#include <Arduino.h>  // Added: Required for PlatformIO C++ compilation
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// -------- CONFIGURE THESE --------
const char* WIFI_SSID     = "HOME_WIFI";
const char* WIFI_PASSWORD = "BV#!$@n02026";
const char* API_URL       = "http://YOUR_SERVER_IP:8000/api/sensor-data/";
const char* DEVICE_TOKEN  = "YOUR_DEVICE_TOKEN_FROM_DJANGO"; // Fixed: Removed the space
const int   BATCH_ID      = 1;  // Crop batch ID linked to this node
// ---------------------------------

#define DHT_PIN  4
#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 900000; // 15 minutes

// Added: Function prototype so C++ knows this exists before loop() calls it
void sendSensorData(); 

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
}

void sendSensorData() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("DHT read failed");
    return;
  }

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  String payload = "{";
  payload += "\"batch_id\":" + String(BATCH_ID) + ",";
  payload += "\"temperature_c\":" + String(temp, 1) + ",";
  payload += "\"humidity_rh\":" + String(hum, 1);
  payload += "}";

  int code = http.POST(payload);
  Serial.printf("POST %d: %s\n", code, http.getString().c_str());
  http.end();
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL) {
    sendSensorData();
    lastSend = millis();
  }
  delay(1000);
}