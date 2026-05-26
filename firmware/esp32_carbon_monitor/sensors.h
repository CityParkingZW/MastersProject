/*
 * Sensor reading and calibration functions for ESP32 Carbon Monitor
 * 
 * Supports: MQ-135 (CO2/Air Quality), MQ-4 (Methane), DHT22 (Temp/Humidity)
 */

#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>
#include <DHT.h>
#include "config.h"

// DHT sensor instance
DHT dht(DHT22_PIN, DHT22);

// Sensor reading structure
struct SensorData {
    float co2_ppm;           // CO2 concentration from MQ-135
    float ch4_ppm;           // Methane concentration from MQ-4
    float temperature;       // Temperature in Celsius
    float humidity;          // Relative humidity in %
    float mq135_raw;         // Raw ADC value from MQ-135
    float mq4_raw;           // Raw ADC value from MQ-4
    float mq135_resistance;  // Calculated sensor resistance
    float mq4_resistance;    // Calculated sensor resistance
    bool valid;              // Data validity flag
    unsigned long timestamp; // Reading timestamp
};

// Calibration data stored in EEPROM
struct CalibrationData {
    float mq135_ro;    // MQ-135 resistance in clean air
    float mq4_ro;      // MQ-4 resistance in clean air
    bool calibrated;   // Calibration status
};

// Global calibration data
CalibrationData calibration = {
    .mq135_ro = MQ135_RO_CLEAN_AIR,
    .mq4_ro = MQ4_RO_CLEAN_AIR,
    .calibrated = false
};

// Initialize all sensors
void initSensors() {
    // Configure ADC pins
    pinMode(MQ135_PIN, INPUT);
    pinMode(MQ4_PIN, INPUT);
    
    // Configure ADC resolution (12-bit = 4095)
    analogReadResolution(12);
    
    // Set ADC attenuation for 3.3V full scale
    analogSetPinAttenuation(MQ135_PIN, ADC_11db);
    analogSetPinAttenuation(MQ4_PIN, ADC_11db);
    
    // Initialize DHT22
    dht.begin();
    
    // Status LED
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
    
    Serial.println("[SENSORS] Initialized all sensors");
    Serial.println("[SENSORS] Waiting for MQ sensors to warm up...");
}

// Calculate sensor resistance from ADC reading
// Rs = RL * (Vc - Vout) / Vout
float calculateResistance(int adcValue, float rl, float voltage) {
    if (adcValue == 0) return 0;
    
    float vout = (adcValue / (float)ADC_RESOLUTION) * voltage;
    float rs = rl * ((voltage - vout) / vout);
    
    return rs;
}

// Read raw analog value with averaging
int readAnalogAverage(int pin, int samples = 10) {
    long sum = 0;
    for (int i = 0; i < samples; i++) {
        sum += analogRead(pin);
        delay(10);
    }
    return sum / samples;
}

// MQ-135 CO2 PPM calculation
// Using datasheet curve approximation: ppm = a * (Rs/Ro)^b
// For CO2: a = 116.6020682, b = -2.769034857
float calculateCO2PPM(float rs, float ro) {
    if (ro == 0 || rs == 0) return 0;
    
    float ratio = rs / ro;
    
    // Curve fitting coefficients for CO2 from MQ-135 datasheet
    float a = 116.6020682;
    float b = -2.769034857;
    
    float ppm = a * pow(ratio, b);
    
    // Clamp to reasonable range (400-5000 ppm for indoor)
    if (ppm < 400) ppm = 400;
    if (ppm > 5000) ppm = 5000;
    
    return ppm;
}

// MQ-4 Methane PPM calculation
// Using datasheet curve approximation: ppm = a * (Rs/Ro)^b
// For CH4: a = 1012.7, b = -2.786
float calculateCH4PPM(float rs, float ro) {
    if (ro == 0 || rs == 0) return 0;
    
    float ratio = rs / ro;
    
    // Curve fitting coefficients for CH4 from MQ-4 datasheet
    float a = 1012.7;
    float b = -2.786;
    
    float ppm = a * pow(ratio, b);
    
    // Clamp to reasonable range (0-10000 ppm)
    if (ppm < 0) ppm = 0;
    if (ppm > 10000) ppm = 10000;
    
    return ppm;
}

// Temperature compensation for MQ sensors
// Gas sensor readings vary with temperature and humidity
float temperatureCompensation(float ppm, float temperature, float humidity) {
    // Reference conditions: 20°C, 65% RH
    float tempFactor = 1.0 + 0.02 * (temperature - 20.0);
    float humFactor = 1.0 + 0.01 * (humidity - 65.0);
    
    return ppm / (tempFactor * humFactor);
}

// Calibrate sensors in clean air
// Run this when sensors are in a well-ventilated area with fresh air
void calibrateSensors() {
    Serial.println("[SENSORS] Starting calibration in clean air...");
    Serial.println("[SENSORS] Please ensure sensors are in fresh air!");
    
    // Take multiple readings for averaging
    const int samples = 50;
    float mq135_sum = 0;
    float mq4_sum = 0;
    
    for (int i = 0; i < samples; i++) {
        int mq135_adc = readAnalogAverage(MQ135_PIN, 5);
        int mq4_adc = readAnalogAverage(MQ4_PIN, 5);
        
        mq135_sum += calculateResistance(mq135_adc, MQ135_RL, MQ135_VOLTAGE);
        mq4_sum += calculateResistance(mq4_adc, MQ4_RL, MQ4_VOLTAGE);
        
        delay(100);
        
        if (i % 10 == 0) {
            Serial.printf("[SENSORS] Calibration progress: %d%%\n", (i * 100) / samples);
        }
    }
    
    calibration.mq135_ro = mq135_sum / samples / MQ135_RO_CLEAN_AIR;
    calibration.mq4_ro = mq4_sum / samples / MQ4_RO_CLEAN_AIR;
    calibration.calibrated = true;
    
    Serial.printf("[SENSORS] Calibration complete!\n");
    Serial.printf("[SENSORS] MQ-135 Ro: %.2f kOhm\n", calibration.mq135_ro);
    Serial.printf("[SENSORS] MQ-4 Ro: %.2f kOhm\n", calibration.mq4_ro);
}

// Read all sensors and return data structure
SensorData readAllSensors() {
    SensorData data;
    data.timestamp = millis();
    data.valid = true;
    
    // Read MQ-135 (CO2/Air Quality)
    int mq135_adc = readAnalogAverage(MQ135_PIN, 10);
    data.mq135_raw = mq135_adc;
    data.mq135_resistance = calculateResistance(mq135_adc, MQ135_RL, MQ135_VOLTAGE);
    
    // Read MQ-4 (Methane)
    int mq4_adc = readAnalogAverage(MQ4_PIN, 10);
    data.mq4_raw = mq4_adc;
    data.mq4_resistance = calculateResistance(mq4_adc, MQ4_RL, MQ4_VOLTAGE);
    
    // Read DHT22 (Temperature/Humidity)
    data.temperature = dht.readTemperature();
    data.humidity = dht.readHumidity();
    
    // Check for DHT22 read errors
    if (isnan(data.temperature) || isnan(data.humidity)) {
        Serial.println("[SENSORS] Warning: DHT22 read failed!");
        data.temperature = 25.0;  // Default fallback
        data.humidity = 50.0;
        data.valid = false;
    }
    
    // Calculate gas concentrations
    data.co2_ppm = calculateCO2PPM(data.mq135_resistance, calibration.mq135_ro);
    data.ch4_ppm = calculateCH4PPM(data.mq4_resistance, calibration.mq4_ro);
    
    // Apply temperature compensation
    data.co2_ppm = temperatureCompensation(data.co2_ppm, data.temperature, data.humidity);
    data.ch4_ppm = temperatureCompensation(data.ch4_ppm, data.temperature, data.humidity);
    
    // Blink LED to indicate reading
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(50);
    digitalWrite(STATUS_LED_PIN, LOW);
    
    return data;
}

// Print sensor data to Serial
void printSensorData(SensorData& data) {
    Serial.println("========== Sensor Readings ==========");
    Serial.printf("Timestamp: %lu ms\n", data.timestamp);
    Serial.printf("CO2 (MQ-135): %.2f ppm\n", data.co2_ppm);
    Serial.printf("CH4 (MQ-4): %.2f ppm\n", data.ch4_ppm);
    Serial.printf("Temperature: %.2f °C\n", data.temperature);
    Serial.printf("Humidity: %.2f %%\n", data.humidity);
    Serial.printf("MQ-135 Raw ADC: %.0f\n", data.mq135_raw);
    Serial.printf("MQ-4 Raw ADC: %.0f\n", data.mq4_raw);
    Serial.printf("Valid: %s\n", data.valid ? "Yes" : "No");
    Serial.println("=====================================");
}

// Check if sensors are warmed up (MQ sensors need ~3 minutes)
bool sensorsWarmedUp() {
    return millis() > SENSOR_WARMUP_TIME;
}

// Get sensor status as JSON string
String getSensorStatusJSON() {
    String json = "{";
    json += "\"mq135_ro\":" + String(calibration.mq135_ro, 2) + ",";
    json += "\"mq4_ro\":" + String(calibration.mq4_ro, 2) + ",";
    json += "\"calibrated\":" + String(calibration.calibrated ? "true" : "false") + ",";
    json += "\"warmed_up\":" + String(sensorsWarmedUp() ? "true" : "false");
    json += "}";
    return json;
}

#endif // SENSORS_H
