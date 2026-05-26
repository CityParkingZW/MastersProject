/*
 * Configuration file for ESP32 Carbon Monitor
 * 
 * IMPORTANT: Replace placeholder values with your actual credentials
 * before uploading to ESP32
 */

#ifndef CONFIG_H
#define CONFIG_H

// ==================== WiFi Configuration ====================
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ==================== AWS IoT Core Configuration ====================
#define AWS_IOT_ENDPOINT "YOUR_ENDPOINT.iot.YOUR_REGION.amazonaws.com"
#define AWS_IOT_PORT 8883
#define DEVICE_ID "carbon-monitor-device-01"
#define FACILITY_ID "facility-001"

// MQTT Topics
#define MQTT_TOPIC_RAW "facility/sensors/raw"
#define MQTT_TOPIC_PROCESSED "facility/sensors/processed"
#define MQTT_TOPIC_PREDICTIONS "facility/emissions/predictions"
#define MQTT_TOPIC_STATUS "facility/device/status"

// ==================== Sensor Pin Configuration ====================
#define MQ135_PIN 34        // Analog pin for MQ-135 (CO2/Air Quality)
#define MQ4_PIN 35          // Analog pin for MQ-4 (Methane)
#define DHT22_PIN 4         // Digital pin for DHT22 (Temp/Humidity)
#define STATUS_LED_PIN 2    // Built-in LED for status indication

// ==================== Sensor Calibration Values ====================
// MQ-135 calibration (adjust based on your sensor in clean air)
#define MQ135_RO_CLEAN_AIR 3.6    // Sensor resistance in clean air / RO
#define MQ135_RL 10.0              // Load resistance in kOhm
#define MQ135_VOLTAGE 3.3          // ADC reference voltage

// MQ-4 calibration (adjust based on your sensor in clean air)
#define MQ4_RO_CLEAN_AIR 4.4       // Sensor resistance in clean air / RO
#define MQ4_RL 20.0                // Load resistance in kOhm
#define MQ4_VOLTAGE 3.3            // ADC reference voltage

// ADC configuration
#define ADC_RESOLUTION 4095        // 12-bit ADC resolution

// ==================== Timing Configuration ====================
#define SENSOR_READ_INTERVAL 60000     // Read sensors every 60 seconds (1 minute)
#define MQTT_PUBLISH_INTERVAL 60000    // Publish data every 60 seconds
#define WIFI_RECONNECT_INTERVAL 30000  // Retry WiFi connection every 30 seconds
#define MQTT_RECONNECT_INTERVAL 5000   // Retry MQTT connection every 5 seconds
#define SENSOR_WARMUP_TIME 180000      // MQ sensors warmup time (3 minutes)

// ==================== Data Buffer Configuration ====================
#define MAX_BUFFER_SIZE 10             // Maximum readings to buffer if offline
#define JSON_BUFFER_SIZE 512           // JSON document buffer size

// ==================== Watchdog Configuration ====================
#define WATCHDOG_TIMEOUT 120           // Watchdog timeout in seconds

// ==================== AWS IoT Certificates ====================
// Replace with your actual certificates from AWS IoT Core

// Amazon Root CA 1
static const char AWS_CERT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----
)EOF";

// Device Certificate (REPLACE WITH YOUR CERTIFICATE)
static const char AWS_CERT_CRT[] PROGMEM = R"KEY(
-----BEGIN CERTIFICATE-----
PASTE_YOUR_DEVICE_CERTIFICATE_HERE
-----END CERTIFICATE-----
)KEY";

// Device Private Key (REPLACE WITH YOUR PRIVATE KEY)
static const char AWS_CERT_PRIVATE[] PROGMEM = R"KEY(
-----BEGIN RSA PRIVATE KEY-----
PASTE_YOUR_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----
)KEY";

#endif // CONFIG_H
