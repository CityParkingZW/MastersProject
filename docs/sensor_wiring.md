# ESP32 Sensor Wiring Guide

## Hardware Components Required

1. **ESP32 DevKit V1** (or any ESP32 with WiFi)
2. **MQ-135** - Air Quality/CO2 Sensor
3. **MQ-4** - Methane (CH4) Sensor
4. **DHT22** - Temperature and Humidity Sensor
5. **10kΩ Resistor** - Pull-up for DHT22
6. **Breadboard and Jumper Wires**

## Wiring Diagram

```
                    ESP32 DevKit
                 ┌───────────────┐
                 │               │
    MQ-135 AOUT ─┤ GPIO34        │
     MQ-4 AOUT ─┤ GPIO35        │
    DHT22 DATA ─┤ GPIO4         │
                 │               │
           3.3V ─┤ 3V3      VIN ├─ 5V (MQ sensors)
            GND ─┤ GND      GND ├─ GND (common)
                 │               │
                 └───────────────┘
```

## Detailed Pin Connections

### MQ-135 (CO2/Air Quality Sensor)
```
MQ-135          ESP32
──────          ─────
VCC     ───────► VIN (5V)
GND     ───────► GND
AOUT    ───────► GPIO34 (Analog)
DOUT    ───────► (Not connected)
```

### MQ-4 (Methane Sensor)
```
MQ-4            ESP32
────            ─────
VCC     ───────► VIN (5V)
GND     ───────► GND
AOUT    ───────► GPIO35 (Analog)
DOUT    ───────► (Not connected)
```

### DHT22 (Temperature/Humidity Sensor)
```
DHT22           ESP32
─────           ─────
VCC     ───────► 3V3
DATA    ───────► GPIO4 (with 10kΩ pull-up to 3V3)
NC      ───────► (Not connected)
GND     ───────► GND
```

## Important Notes

### Power Supply
- MQ sensors require **5V** power supply for proper heating
- DHT22 works on **3.3V** (safer for ESP32 GPIO)
- Use ESP32's VIN pin for 5V (when powered via USB)

### MQ Sensor Warm-up
- MQ-135 and MQ-4 sensors need **3 minutes** warm-up time
- The firmware automatically handles this warm-up period
- During warm-up, readings will be inaccurate

### Calibration
- Calibrate sensors in **clean outdoor air**
- Run the `calibrate` command via Serial Monitor
- Store calibration values in the config.h file

### ADC Limitations
- ESP32 ADC is 12-bit (0-4095)
- Non-linear at extremes; most accurate between 150-2450 mV
- The firmware uses averaging to improve accuracy

## Breadboard Layout

```
┌─────────────────────────────────────────────────────────┐
│  ●───────────────────────────────────────────────────●  │ ← 5V Rail
│                                                         │
│    ┌─────────┐   ┌─────────┐   ┌─────────┐             │
│    │ MQ-135  │   │  MQ-4   │   │  DHT22  │             │
│    │  ┌──┐   │   │  ┌──┐   │   │  ┌──┐   │             │
│    │  │  │   │   │  │  │   │   │  │  │   │             │
│    │  │  │   │   │  │  │   │   │  │  │   │             │
│    │  └──┘   │   │  └──┘   │   │  └──┘   │             │
│    │ V G A D │   │ V G A D │   │ V D N G │             │
│    └─┼─┼─┼─┼─┘   └─┼─┼─┼─┼─┘   └─┼─┼─┼─┼─┘             │
│      │ │ │ │       │ │ │ │       │ │ │ │               │
│      │ │ │ └───────┼─┼─┼─┼───────┼─┼─┼─┘ (not used)   │
│      │ │ │         │ │ │ │       │ │ │                 │
│      │ │ └─────────┼─┼─┼─┼───────┼─┼─┴──► GPIO4       │
│      │ │           │ │ │ │       │ │    (with pullup)  │
│      │ │           │ │ └─┼───────┼─┴────► GPIO35      │
│      │ │           │ │   │       │                     │
│      │ └───────────┼─┴───┼───────┴──────► GND         │
│      │             │     │                             │
│      └─────────────┴─────┴──────────────► 5V          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │                     ESP32                         │  │
│  │   3V3  GPIO4  GPIO34  GPIO35  VIN  GND           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ●───────────────────────────────────────────────────●  │ ← GND Rail
└─────────────────────────────────────────────────────────┘
```

## Parts List with Links

| Component | Quantity | Notes |
|-----------|----------|-------|
| ESP32 DevKit V1 | 1 | Any ESP32 with WiFi works |
| MQ-135 Module | 1 | With breakout board |
| MQ-4 Module | 1 | With breakout board |
| DHT22 Module | 1 | AM2302 also works |
| 10kΩ Resistor | 1 | Pull-up for DHT22 |
| Breadboard | 1 | Half-size is sufficient |
| Jumper Wires | 15+ | Male-to-male |
| USB Cable | 1 | Micro-USB or USB-C for ESP32 |

## Testing the Setup

1. Connect all components as shown above
2. Upload the firmware via Arduino IDE
3. Open Serial Monitor at 115200 baud
4. Wait for 3-minute warm-up
5. Type `read` to see current sensor values
6. Type `status` to check system status

## Troubleshooting

### No readings from MQ sensors
- Check 5V power supply
- Verify AOUT pin connections
- Wait full 3-minute warm-up time

### DHT22 read failures
- Check 10kΩ pull-up resistor
- Try 3.3V instead of 5V for VCC
- Ensure DATA pin is on GPIO4

### WiFi connection issues
- Check SSID and password in config.h
- Ensure 2.4GHz network (ESP32 doesn't support 5GHz)
- Check router proximity

### MQTT connection failures
- Verify AWS IoT endpoint in config.h
- Check certificate placement
- Ensure IoT policy allows publish/subscribe
