# Arduino IDE Setup Guide for ESP32 Carbon Monitor

## Prerequisites

1. **Arduino IDE 2.x** (Download from https://www.arduino.cc/en/software)
2. **ESP32 Board Support**
3. **Required Libraries**

---

## Step 1: Install ESP32 Board Support

1. Open Arduino IDE
2. Go to **File → Preferences**
3. In "Additional Board Manager URLs", add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Click **OK**
5. Go to **Tools → Board → Boards Manager**
6. Search for "esp32"
7. Install **"esp32 by Espressif Systems"** (version 2.0.x or later)

---

## Step 2: Install Required Libraries

Go to **Sketch → Include Library → Manage Libraries** and install:

| Library Name | Author | Purpose |
|-------------|--------|---------|
| **PubSubClient** | Nick O'Leary | MQTT communication |
| **ArduinoJson** | Benoit Blanchon | JSON parsing |
| **DHT sensor library** | Adafruit | DHT22 sensor |
| **Adafruit Unified Sensor** | Adafruit | Sensor abstraction |

### Manual Installation (if needed)

For AWS IoT certificates, you may need to add root CA certificates. The firmware includes the Amazon Root CA embedded.

---

## Step 3: Configure the Firmware

1. Open `/firmware/esp32_carbon_monitor/esp32_carbon_monitor.ino` in Arduino IDE
2. Open `config.h` tab and update these settings:

```cpp
// WiFi Configuration
#define WIFI_SSID "YOUR_WIFI_NETWORK_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// AWS IoT Configuration (get these after running setup_aws_iot.py)
#define AWS_IOT_ENDPOINT "xxxxxx.iot.us-east-1.amazonaws.com"
#define THING_NAME "carbon_monitor_001"

// Device Configuration
#define DEVICE_ID "CM001"
#define FACILITY_ID "FAC001"
```

3. After running the AWS setup script, copy the certificates:
   - Open `certificates/carbon_monitor_001/certificate.pem.crt`
   - Copy contents to `AWS_CERT_CRT` in config.h
   - Open `certificates/carbon_monitor_001/private.pem.key`
   - Copy contents to `AWS_CERT_PRIVATE` in config.h

---

## Step 4: Select Board and Port

1. Go to **Tools → Board → ESP32 Arduino**
2. Select **"ESP32 Dev Module"** (or your specific board)
3. Configure board settings:
   - **Upload Speed**: 921600
   - **CPU Frequency**: 240MHz
   - **Flash Size**: 4MB
   - **Partition Scheme**: Default 4MB with spiffs
4. Go to **Tools → Port** and select your ESP32's COM port
   - Windows: COM3, COM4, etc.
   - Mac: /dev/cu.usbserial-xxxx
   - Linux: /dev/ttyUSB0

---

## Step 5: Wire the Sensors

Refer to `docs/sensor_wiring.md` for detailed wiring instructions.

### Quick Reference:

```
ESP32 Pin    Sensor         Connection
---------    ------         ----------
GPIO 34      MQ-135         AO (Analog Out)
GPIO 35      MQ-4           AO (Analog Out)
GPIO 4       DHT22          DATA
3.3V         All Sensors    VCC
GND          All Sensors    GND
```

**Important for MQ sensors:**
- MQ-135 and MQ-4 require 5V for the heater but output 0-3.3V on AO
- Use a voltage divider if your sensor outputs exceed 3.3V
- Preheat sensors for 24-48 hours for accurate readings

---

## Step 6: Upload the Firmware

1. Connect ESP32 to your computer via USB
2. Click **Verify** (checkmark) to compile
3. Click **Upload** (arrow) to flash
4. Hold the **BOOT** button on ESP32 if upload stalls

---

## Step 7: Monitor Serial Output

1. Go to **Tools → Serial Monitor**
2. Set baud rate to **115200**
3. You should see:

```
=====================================
  Carbon Monitor System Starting
=====================================
Connecting to WiFi...
WiFi connected! IP: 192.168.1.xxx
Connecting to AWS IoT...
AWS IoT Connected!
Preheating sensors...
Sensors ready!
Publishing data...
```

---

## Troubleshooting

### "Failed to connect to ESP32"
- Hold BOOT button while uploading
- Try a different USB cable (data cable, not charging only)
- Install CP210x or CH340 drivers

### "WiFi connection failed"
- Check SSID and password (case-sensitive)
- Ensure 2.4GHz network (ESP32 doesn't support 5GHz)
- Move closer to router

### "AWS IoT connection failed"
- Verify certificates are correctly copied
- Check endpoint URL is correct
- Ensure thing policy allows publish/subscribe
- Check certificate is attached to thing

### "Sensor readings are 0 or 4095"
- Check wiring connections
- Verify sensor VCC has power
- MQ sensors need preheat time (24-48 hours for accuracy)
- Analog pin might be damaged, try another

### "Readings seem wrong"
- MQ sensors are NOT calibrated - values are relative
- For research, establish baseline in clean air first
- Temperature affects readings significantly

---

## Testing Without AWS (Offline Mode)

To test sensors without AWS connection, modify `esp32_carbon_monitor.ino`:

```cpp
// In setup(), comment out:
// mqttClient.setup();

// In loop(), add:
SensorData data = sensors.readAll();
Serial.println("=== Sensor Readings ===");
Serial.print("CO2 (MQ-135): "); Serial.println(data.co2_ppm);
Serial.print("CH4 (MQ-4): "); Serial.println(data.ch4_ppm);
Serial.print("Temperature: "); Serial.println(data.temperature);
Serial.print("Humidity: "); Serial.println(data.humidity);
```

---

## Next Steps

1. **Run AWS Setup**: Execute `python scripts/setup_aws_iot.py` to create IoT resources
2. **Update Config**: Copy certificates and endpoint to config.h
3. **Upload Firmware**: Flash to ESP32
4. **Verify Data**: Check AWS IoT MQTT Test Client for incoming messages
5. **View Dashboard**: Open Grafana to see real-time visualizations
