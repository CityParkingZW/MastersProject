/*
 * AWS IoT Core MQTT Client for ESP32 Carbon Monitor
 * 
 * Handles secure MQTT connection with TLS certificates
 * and message publishing/subscribing
 */

#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sensors.h"

// WiFi and MQTT clients
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// Connection state
bool mqttConnected = false;
unsigned long lastMqttReconnectAttempt = 0;
unsigned long lastPublishTime = 0;

// Message buffer for offline storage
struct MessageBuffer {
    String messages[MAX_BUFFER_SIZE];
    int count = 0;
};
MessageBuffer offlineBuffer;

// MQTT message callback
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    Serial.print("[MQTT] Message received on topic: ");
    Serial.println(topic);
    
    // Convert payload to string
    String message;
    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    Serial.println("[MQTT] Payload: " + message);
    
    // Handle different topics
    if (String(topic) == String(MQTT_TOPIC_PREDICTIONS)) {
        // Handle prediction results
        Serial.println("[MQTT] Received prediction data");
    }
}

// Initialize WiFi connection
bool initWiFi() {
    Serial.println("[WIFI] Connecting to WiFi...");
    Serial.print("[WIFI] SSID: ");
    Serial.println(WIFI_SSID);
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.println("[WIFI] Connected!");
        Serial.print("[WIFI] IP Address: ");
        Serial.println(WiFi.localIP());
        Serial.print("[WIFI] Signal Strength (RSSI): ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
        return true;
    }
    
    Serial.println();
    Serial.println("[WIFI] Connection failed!");
    return false;
}

// Check and reconnect WiFi if needed
bool checkWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        return true;
    }
    
    Serial.println("[WIFI] Connection lost, reconnecting...");
    return initWiFi();
}

// Initialize MQTT client with AWS IoT Core certificates
void initMQTT() {
    // Configure SSL/TLS certificates
    wifiClient.setCACert(AWS_CERT_CA);
    wifiClient.setCertificate(AWS_CERT_CRT);
    wifiClient.setPrivateKey(AWS_CERT_PRIVATE);
    
    // Set MQTT server
    mqttClient.setServer(AWS_IOT_ENDPOINT, AWS_IOT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setBufferSize(1024);  // Increase buffer for larger messages
    
    Serial.println("[MQTT] Client initialized");
    Serial.print("[MQTT] Endpoint: ");
    Serial.println(AWS_IOT_ENDPOINT);
}

// Connect to AWS IoT Core
bool connectMQTT() {
    if (mqttClient.connected()) {
        return true;
    }
    
    Serial.println("[MQTT] Connecting to AWS IoT Core...");
    
    // Create client ID with device ID
    String clientId = String(DEVICE_ID);
    
    // Attempt connection
    if (mqttClient.connect(clientId.c_str())) {
        Serial.println("[MQTT] Connected to AWS IoT Core!");
        mqttConnected = true;
        
        // Subscribe to relevant topics
        mqttClient.subscribe(MQTT_TOPIC_PREDICTIONS);
        Serial.println("[MQTT] Subscribed to prediction topic");
        
        // Publish connection status
        String statusMsg = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"status\":\"connected\",\"timestamp\":" + String(millis()) + "}";
        mqttClient.publish(MQTT_TOPIC_STATUS, statusMsg.c_str());
        
        // Flush any buffered messages
        if (offlineBuffer.count > 0) {
            Serial.printf("[MQTT] Flushing %d buffered messages\n", offlineBuffer.count);
            for (int i = 0; i < offlineBuffer.count; i++) {
                mqttClient.publish(MQTT_TOPIC_RAW, offlineBuffer.messages[i].c_str());
                delay(100);  // Small delay between messages
            }
            offlineBuffer.count = 0;
        }
        
        return true;
    }
    
    // Connection failed
    int state = mqttClient.state();
    Serial.print("[MQTT] Connection failed, state: ");
    Serial.println(state);
    
    switch (state) {
        case -4: Serial.println("[MQTT] Error: Connection timeout"); break;
        case -3: Serial.println("[MQTT] Error: Connection lost"); break;
        case -2: Serial.println("[MQTT] Error: Connect failed"); break;
        case -1: Serial.println("[MQTT] Error: Disconnected"); break;
        case 1: Serial.println("[MQTT] Error: Bad protocol"); break;
        case 2: Serial.println("[MQTT] Error: Bad client ID"); break;
        case 3: Serial.println("[MQTT] Error: Unavailable"); break;
        case 4: Serial.println("[MQTT] Error: Bad credentials"); break;
        case 5: Serial.println("[MQTT] Error: Unauthorized"); break;
    }
    
    mqttConnected = false;
    return false;
}

// Reconnect MQTT with backoff
bool reconnectMQTT() {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt < MQTT_RECONNECT_INTERVAL) {
        return false;
    }
    lastMqttReconnectAttempt = now;
    return connectMQTT();
}

// Create JSON payload from sensor data
String createSensorPayload(SensorData& data) {
    StaticJsonDocument<JSON_BUFFER_SIZE> doc;
    
    // Device identification
    doc["device_id"] = DEVICE_ID;
    doc["facility_id"] = FACILITY_ID;
    doc["timestamp"] = data.timestamp;
    doc["iso_time"] = ""; // Will be set by IoT Core rule or Lambda
    
    // Sensor readings
    JsonObject sensors = doc.createNestedObject("sensors");
    sensors["co2_ppm"] = round(data.co2_ppm * 100) / 100.0;
    sensors["ch4_ppm"] = round(data.ch4_ppm * 100) / 100.0;
    sensors["temperature"] = round(data.temperature * 100) / 100.0;
    sensors["humidity"] = round(data.humidity * 100) / 100.0;
    
    // Raw values for debugging/calibration
    JsonObject raw = doc.createNestedObject("raw");
    raw["mq135_adc"] = data.mq135_raw;
    raw["mq4_adc"] = data.mq4_raw;
    raw["mq135_rs"] = round(data.mq135_resistance * 100) / 100.0;
    raw["mq4_rs"] = round(data.mq4_resistance * 100) / 100.0;
    
    // Metadata
    JsonObject meta = doc.createNestedObject("meta");
    meta["valid"] = data.valid;
    meta["calibrated"] = calibration.calibrated;
    meta["wifi_rssi"] = WiFi.RSSI();
    meta["uptime_ms"] = millis();
    meta["free_heap"] = ESP.getFreeHeap();
    
    // Serialize to string
    String payload;
    serializeJson(doc, payload);
    
    return payload;
}

// Publish sensor data to AWS IoT Core
bool publishSensorData(SensorData& data) {
    String payload = createSensorPayload(data);
    
    Serial.println("[MQTT] Publishing sensor data...");
    Serial.println("[MQTT] Payload: " + payload);
    
    if (!mqttClient.connected()) {
        // Buffer message for later if offline
        if (offlineBuffer.count < MAX_BUFFER_SIZE) {
            offlineBuffer.messages[offlineBuffer.count] = payload;
            offlineBuffer.count++;
            Serial.printf("[MQTT] Buffered message (count: %d)\n", offlineBuffer.count);
        } else {
            Serial.println("[MQTT] Buffer full, message dropped!");
        }
        return false;
    }
    
    // Publish to raw topic
    bool success = mqttClient.publish(MQTT_TOPIC_RAW, payload.c_str());
    
    if (success) {
        Serial.println("[MQTT] Published successfully");
        lastPublishTime = millis();
    } else {
        Serial.println("[MQTT] Publish failed!");
    }
    
    return success;
}

// Publish processed/calibrated data
bool publishProcessedData(SensorData& data) {
    StaticJsonDocument<JSON_BUFFER_SIZE> doc;
    
    doc["device_id"] = DEVICE_ID;
    doc["facility_id"] = FACILITY_ID;
    doc["timestamp"] = data.timestamp;
    
    // Only calibrated, compensated values
    doc["co2_ppm"] = round(data.co2_ppm * 100) / 100.0;
    doc["ch4_ppm"] = round(data.ch4_ppm * 100) / 100.0;
    doc["temperature"] = round(data.temperature * 100) / 100.0;
    doc["humidity"] = round(data.humidity * 100) / 100.0;
    
    // Energy placeholder (for SCT-013 current sensor integration)
    doc["energy_kwh"] = 0.0;
    
    String payload;
    serializeJson(doc, payload);
    
    return mqttClient.publish(MQTT_TOPIC_PROCESSED, payload.c_str());
}

// Process MQTT client loop
void mqttLoop() {
    if (!mqttClient.connected()) {
        reconnectMQTT();
    }
    mqttClient.loop();
}

// Get MQTT status as JSON
String getMQTTStatusJSON() {
    String json = "{";
    json += "\"connected\":" + String(mqttConnected ? "true" : "false") + ",";
    json += "\"last_publish\":" + String(lastPublishTime) + ",";
    json += "\"buffered_messages\":" + String(offlineBuffer.count);
    json += "}";
    return json;
}

#endif // MQTT_CLIENT_H
