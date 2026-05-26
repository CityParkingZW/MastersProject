/*
 * ESP32 Carbon Monitor - Main Firmware
 * 
 * IoT-based carbon monitoring system for facility emissions tracking
 * Part of the ZCMA-compliant MRV (Monitoring, Reporting, Verification) system
 * 
 * Hardware:
 * - ESP32 DevKit
 * - MQ-135 (CO2/Air Quality) on GPIO34
 * - MQ-4 (Methane/CH4) on GPIO35
 * - DHT22 (Temperature/Humidity) on GPIO4
 * 
 * Cloud:
 * - AWS IoT Core for MQTT messaging
 * - Data stored in DynamoDB via IoT Rules
 * 
 * Author: H240486C
 * Date: 2026
 */

#include <WiFi.h>
#include <esp_task_wdt.h>
#include "config.h"
#include "sensors.h"
#include "mqtt_client.h"

// ==================== Global Variables ====================
unsigned long lastSensorRead = 0;
unsigned long lastPublish = 0;
bool systemReady = false;
int errorCount = 0;
const int MAX_ERRORS = 10;

// ==================== Setup ====================
void setup() {
    // Initialize serial communication
    Serial.begin(115200);
    delay(1000);
    
    Serial.println();
    Serial.println("============================================");
    Serial.println("   ESP32 Carbon Monitor - Starting Up       ");
    Serial.println("   IoT-based Carbon Emission Monitoring     ");
    Serial.println("============================================");
    Serial.println();
    
    // Print device information
    Serial.printf("Device ID: %s\n", DEVICE_ID);
    Serial.printf("Facility ID: %s\n", FACILITY_ID);
    Serial.printf("ESP32 Chip ID: %llX\n", ESP.getEfuseMac());
    Serial.printf("CPU Frequency: %d MHz\n", ESP.getCpuFreqMHz());
    Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());
    Serial.println();
    
    // Initialize watchdog timer (resets if system hangs)
    Serial.println("[SYSTEM] Configuring watchdog timer...");
    esp_task_wdt_init(WATCHDOG_TIMEOUT, true);
    esp_task_wdt_add(NULL);
    
    // Initialize sensors
    Serial.println("[SYSTEM] Initializing sensors...");
    initSensors();
    
    // Initialize WiFi
    Serial.println("[SYSTEM] Initializing WiFi...");
    if (!initWiFi()) {
        Serial.println("[SYSTEM] WiFi failed - will retry in main loop");
    }
    
    // Initialize MQTT
    Serial.println("[SYSTEM] Initializing MQTT client...");
    initMQTT();
    
    // Connect to AWS IoT Core
    Serial.println("[SYSTEM] Connecting to AWS IoT Core...");
    if (!connectMQTT()) {
        Serial.println("[SYSTEM] MQTT failed - will retry in main loop");
    }
    
    // Wait for sensor warmup
    Serial.println("[SYSTEM] Waiting for MQ sensors to warm up...");
    Serial.println("[SYSTEM] This takes approximately 3 minutes...");
    
    // Print warmup progress
    unsigned long warmupStart = millis();
    while (!sensorsWarmedUp()) {
        unsigned long elapsed = millis() - warmupStart;
        int progress = (elapsed * 100) / SENSOR_WARMUP_TIME;
        Serial.printf("[SYSTEM] Warmup progress: %d%% (%lu/%lu ms)\r", 
                      progress, elapsed, (unsigned long)SENSOR_WARMUP_TIME);
        
        // Keep MQTT connection alive during warmup
        mqttLoop();
        
        // Reset watchdog
        esp_task_wdt_reset();
        
        delay(5000);
    }
    Serial.println();
    
    // Optional: Run calibration (uncomment to calibrate in clean air)
    // calibrateSensors();
    
    systemReady = true;
    Serial.println();
    Serial.println("============================================");
    Serial.println("   System Ready - Starting Monitoring       ");
    Serial.println("============================================");
    Serial.println();
    
    // Take initial reading
    Serial.println("[SYSTEM] Taking initial sensor reading...");
    SensorData data = readAllSensors();
    printSensorData(data);
    
    // Publish initial reading
    if (mqttClient.connected()) {
        publishSensorData(data);
        publishProcessedData(data);
    }
}

// ==================== Main Loop ====================
void loop() {
    unsigned long currentTime = millis();
    
    // Reset watchdog
    esp_task_wdt_reset();
    
    // Check WiFi connection
    if (!checkWiFi()) {
        errorCount++;
        if (errorCount >= MAX_ERRORS) {
            Serial.println("[ERROR] Too many WiFi errors, restarting...");
            ESP.restart();
        }
        delay(WIFI_RECONNECT_INTERVAL);
        return;
    }
    
    // Process MQTT
    mqttLoop();
    
    // Read sensors at defined interval
    if (currentTime - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentTime;
        
        // Check if sensors are warmed up
        if (!sensorsWarmedUp()) {
            Serial.println("[SYSTEM] Sensors still warming up...");
            return;
        }
        
        // Read all sensors
        Serial.println("[SYSTEM] Reading sensors...");
        SensorData data = readAllSensors();
        
        // Print to serial for debugging
        printSensorData(data);
        
        // Check for valid readings
        if (!data.valid) {
            Serial.println("[WARNING] Invalid sensor reading!");
            errorCount++;
        } else {
            errorCount = 0;  // Reset error count on successful read
        }
        
        // Publish to AWS IoT Core
        if (currentTime - lastPublish >= MQTT_PUBLISH_INTERVAL) {
            lastPublish = currentTime;
            
            Serial.println("[SYSTEM] Publishing to AWS IoT Core...");
            
            // Publish raw data
            if (publishSensorData(data)) {
                // Also publish processed data for AI model
                publishProcessedData(data);
            }
            
            // Print system status
            Serial.println("[STATUS] System Status:");
            Serial.printf("  - WiFi RSSI: %d dBm\n", WiFi.RSSI());
            Serial.printf("  - MQTT Connected: %s\n", mqttClient.connected() ? "Yes" : "No");
            Serial.printf("  - Free Heap: %d bytes\n", ESP.getFreeHeap());
            Serial.printf("  - Uptime: %lu seconds\n", currentTime / 1000);
            Serial.printf("  - Error Count: %d\n", errorCount);
            Serial.println();
        }
    }
    
    // Small delay to prevent tight loop
    delay(100);
}

// ==================== Helper Functions ====================

// Handle serial commands for testing/calibration
void handleSerialCommand() {
    if (Serial.available()) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        
        if (command == "status") {
            Serial.println("[CMD] System Status:");
            Serial.printf("  WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
            Serial.printf("  MQTT: %s\n", mqttClient.connected() ? "Connected" : "Disconnected");
            Serial.printf("  Sensors: %s\n", getSensorStatusJSON().c_str());
            Serial.printf("  MQTT: %s\n", getMQTTStatusJSON().c_str());
        }
        else if (command == "read") {
            SensorData data = readAllSensors();
            printSensorData(data);
        }
        else if (command == "calibrate") {
            calibrateSensors();
        }
        else if (command == "publish") {
            SensorData data = readAllSensors();
            publishSensorData(data);
        }
        else if (command == "restart") {
            Serial.println("[CMD] Restarting...");
            ESP.restart();
        }
        else if (command == "help") {
            Serial.println("[CMD] Available commands:");
            Serial.println("  status    - Show system status");
            Serial.println("  read      - Read sensors now");
            Serial.println("  calibrate - Calibrate MQ sensors");
            Serial.println("  publish   - Publish reading now");
            Serial.println("  restart   - Restart ESP32");
            Serial.println("  help      - Show this help");
        }
        else {
            Serial.println("[CMD] Unknown command. Type 'help' for list.");
        }
    }
}

// Error recovery function
void handleError(const char* errorMsg) {
    Serial.printf("[ERROR] %s\n", errorMsg);
    errorCount++;
    
    // Blink LED rapidly to indicate error
    for (int i = 0; i < 5; i++) {
        digitalWrite(STATUS_LED_PIN, HIGH);
        delay(100);
        digitalWrite(STATUS_LED_PIN, LOW);
        delay(100);
    }
    
    if (errorCount >= MAX_ERRORS) {
        Serial.println("[ERROR] Maximum errors reached, restarting...");
        delay(1000);
        ESP.restart();
    }
}
