/*
 * ESP32 Carbon Monitor - Simplified HTTP Version
 *
 * Sends sensor data directly to the Next.js dashboard via HTTP POST.
 * No AWS or cloud setup required.
 *
 * Hardware:
 *   MQ-135 (CO2)  → GPIO34
 *   MQ-4  (CH4)   → GPIO35
 *   DHT22 (Temp/Humidity) → GPIO4
 *
 * Setup:
 *   1. Set WIFI_SSID and WIFI_PASSWORD below
 *   2. Set SERVER_IP to your computer's local IP address
 *      (run 'ipconfig' on Windows to find it, e.g. 192.168.1.5)
 *   3. Make sure your computer and ESP32 are on the same WiFi network
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ── Configure these ─────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_IP     = "192.168.1.100"; // Your PC's local IP
const int   SERVER_PORT   = 3000;
// ────────────────────────────────────────────────────────────

#define MQ135_PIN     34
#define MQ4_PIN       35
#define DHT22_PIN     4
#define STATUS_LED    2
#define SEND_INTERVAL 10000  // Send every 10 seconds

DHT dht(DHT22_PIN, DHT22);
unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  analogSetPinAttenuation(MQ4_PIN, ADC_11db);
  dht.begin();

  Serial.println("\n=== ESP32 Carbon Monitor ===");

  // Connect to WiFi
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("Sending data to http://%s:%d/api/sensor-data\n", SERVER_IP, SERVER_PORT);
  Serial.println("Warming up MQ sensors (3 minutes)...");
}

// Average multiple ADC reads to reduce noise
int readADC(int pin) {
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(pin);
    delay(10);
  }
  return sum / 10;
}

// Convert MQ-135 ADC reading to approximate CO2 ppm
float co2FromADC(int adc) {
  if (adc == 0) return 400.0;
  float voltage = (adc / 4095.0) * 3.3;
  float rs = 10.0 * ((3.3 - voltage) / voltage);
  float ro = 3.6;
  float ratio = rs / ro;
  float ppm = 116.6020682 * pow(ratio, -2.769034857);
  return constrain(ppm, 400.0, 5000.0);
}

// Convert MQ-4 ADC reading to approximate CH4 ppm
float ch4FromADC(int adc) {
  if (adc == 0) return 0.0;
  float voltage = (adc / 4095.0) * 3.3;
  float rs = 20.0 * ((3.3 - voltage) / voltage);
  float ro = 4.4;
  float ratio = rs / ro;
  float ppm = 1012.7 * pow(ratio, -2.786);
  return constrain(ppm, 0.0, 100.0);
}

void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected, reconnecting...");
    WiFi.reconnect();
    return;
  }

  // Read sensors
  int mq135adc = readADC(MQ135_PIN);
  int mq4adc   = readADC(MQ4_PIN);
  float temp   = dht.readTemperature();
  float hum    = dht.readHumidity();

  if (isnan(temp)) temp = 25.0;
  if (isnan(hum))  hum  = 50.0;

  float co2 = co2FromADC(mq135adc);
  float ch4 = ch4FromADC(mq4adc);

  // Print to serial for monitoring
  Serial.println("──────────── Sensor Reading ────────────");
  Serial.printf("CO2:         %.1f ppm\n", co2);
  Serial.printf("CH4:         %.2f ppm\n", ch4);
  Serial.printf("Temperature: %.1f °C\n", temp);
  Serial.printf("Humidity:    %.1f %%\n", hum);

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["co2_ppm"]     = round(co2 * 10) / 10.0;
  doc["ch4_ppm"]     = round(ch4 * 100) / 100.0;
  doc["temperature"] = round(temp * 10) / 10.0;
  doc["humidity"]    = round(hum * 10) / 10.0;
  doc["uptime_ms"]   = millis();

  String payload;
  serializeJson(doc, payload);

  // POST to Next.js API
  HTTPClient http;
  String url = "http://" + String(SERVER_IP) + ":" + String(SERVER_PORT) + "/api/sensor-data";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  if (code == 200) {
    Serial.println("Sent to dashboard ✓");
    digitalWrite(STATUS_LED, HIGH);
    delay(100);
    digitalWrite(STATUS_LED, LOW);
  } else {
    Serial.printf("HTTP error: %d\n", code);
  }
  http.end();
}

void loop() {
  unsigned long now = millis();

  // Wait 3 minutes for MQ sensors to warm up before sending
  if (now < 180000) {
    int remaining = (180000 - now) / 1000;
    if (now % 10000 < 100) {
      Serial.printf("Warming up... %d seconds remaining\n", remaining);
    }
    delay(100);
    return;
  }

  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;
    sendData();
  }
}
