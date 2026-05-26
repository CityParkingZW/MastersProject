#!/usr/bin/env python3
"""
IoT Data Simulator for Carbon Monitoring System

Generates realistic sensor data patterns simulating:
- CO2 concentrations (MQ-135)
- Methane concentrations (MQ-4)
- Temperature and humidity (DHT22)
- Energy consumption patterns

Publishes data to AWS IoT Core via MQTT for system testing
without requiring physical sensors.

Usage:
    uv run data_simulator.py --mode mqtt      # Publish to AWS IoT Core
    uv run data_simulator.py --mode file      # Save to CSV file
    uv run data_simulator.py --mode console   # Print to console only

Author: H240486C
Date: 2026
"""

import argparse
import json
import time
import random
import math
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import sys

import numpy as np
import pandas as pd

# AWS IoT SDK (imported conditionally for MQTT mode)
try:
    from awsiot import mqtt_connection_builder
    from awscrt import mqtt
    AWS_SDK_AVAILABLE = True
except ImportError:
    AWS_SDK_AVAILABLE = False
    print("[WARNING] AWS IoT SDK not available. MQTT mode disabled.")


# ==================== Configuration ====================

# AWS IoT Core settings (update these with your values)
AWS_IOT_ENDPOINT = "YOUR_ENDPOINT.iot.YOUR_REGION.amazonaws.com"
AWS_IOT_PORT = 8883
AWS_IOT_CLIENT_ID = "simulator-device-01"
AWS_IOT_CERT_PATH = "../certs/device-certificate.pem.crt"
AWS_IOT_KEY_PATH = "../certs/private.pem.key"
AWS_IOT_ROOT_CA_PATH = "../certs/AmazonRootCA1.pem"

# MQTT Topics
MQTT_TOPIC_RAW = "facility/sensors/raw"
MQTT_TOPIC_PROCESSED = "facility/sensors/processed"

# Device and facility identifiers
DEVICE_ID = "simulator-device-01"
FACILITY_ID = "facility-001"

# Simulation parameters
PUBLISH_INTERVAL_SECONDS = 60  # How often to publish data


# ==================== Facility Scenarios ====================

class FacilityScenario:
    """Defines different facility operation scenarios for realistic data generation."""
    
    @staticmethod
    def normal_operations() -> Dict[str, Any]:
        """Normal day-to-day operations."""
        return {
            "name": "normal_operations",
            "co2_base": 450,       # ppm - slightly above atmospheric
            "co2_variance": 50,
            "ch4_base": 2.0,       # ppm - trace amounts
            "ch4_variance": 0.5,
            "temp_base": 25,       # Celsius
            "temp_variance": 3,
            "humidity_base": 55,   # %
            "humidity_variance": 10,
            "energy_base": 15,     # kWh per hour
            "energy_variance": 5
        }
    
    @staticmethod
    def waste_processing() -> Dict[str, Any]:
        """Waste processing facility - higher methane emissions."""
        return {
            "name": "waste_processing",
            "co2_base": 800,
            "co2_variance": 150,
            "ch4_base": 50,        # High methane from decomposition
            "ch4_variance": 20,
            "temp_base": 30,       # Warmer due to decomposition
            "temp_variance": 5,
            "humidity_base": 70,   # Higher humidity
            "humidity_variance": 10,
            "energy_base": 25,
            "energy_variance": 8
        }
    
    @staticmethod
    def industrial_combustion() -> Dict[str, Any]:
        """Industrial facility with combustion processes."""
        return {
            "name": "industrial_combustion",
            "co2_base": 1500,      # High CO2 from burning
            "co2_variance": 300,
            "ch4_base": 5,         # Some unburned fuel
            "ch4_variance": 2,
            "temp_base": 35,       # Hot environment
            "temp_variance": 8,
            "humidity_base": 40,   # Lower humidity
            "humidity_variance": 10,
            "energy_base": 100,    # High energy usage
            "energy_variance": 30
        }
    
    @staticmethod
    def agricultural() -> Dict[str, Any]:
        """Agricultural facility with livestock."""
        return {
            "name": "agricultural",
            "co2_base": 600,
            "co2_variance": 100,
            "ch4_base": 200,       # Very high methane from livestock
            "ch4_variance": 50,
            "temp_base": 22,
            "temp_variance": 5,
            "humidity_base": 65,
            "humidity_variance": 15,
            "energy_base": 20,
            "energy_variance": 10
        }


# ==================== Data Generation ====================

class SensorDataGenerator:
    """Generates realistic time-series sensor data with patterns."""
    
    def __init__(self, scenario: Dict[str, Any], seed: Optional[int] = None):
        """
        Initialize the generator with a facility scenario.
        
        Args:
            scenario: Dictionary containing baseline values and variances
            seed: Random seed for reproducibility
        """
        self.scenario = scenario
        if seed is not None:
            np.random.seed(seed)
            random.seed(seed)
        
        # Track state for realistic time-series behavior
        self.last_values = {
            "co2_ppm": scenario["co2_base"],
            "ch4_ppm": scenario["ch4_base"],
            "temperature": scenario["temp_base"],
            "humidity": scenario["humidity_base"],
            "energy_kwh": scenario["energy_base"]
        }
        
        # Time tracking
        self.start_time = datetime.utcnow()
        self.reading_count = 0
    
    def _add_diurnal_pattern(self, base_value: float, hour: int, amplitude: float) -> float:
        """
        Add diurnal (day/night) variation pattern.
        
        Args:
            base_value: The base value to modify
            hour: Hour of day (0-23)
            amplitude: Maximum variation from base
        
        Returns:
            Modified value with diurnal pattern
        """
        # Peak at 14:00 (2 PM), lowest at 02:00 (2 AM)
        phase = (hour - 14) * (2 * math.pi / 24)
        variation = amplitude * math.cos(phase)
        return base_value + variation
    
    def _add_random_walk(self, current: float, target: float, step_size: float) -> float:
        """
        Add smooth random walk towards target value.
        
        Args:
            current: Current value
            target: Target value to drift towards
            step_size: Maximum step per iteration
        
        Returns:
            New value after random walk step
        """
        diff = target - current
        step = np.clip(diff * 0.1 + np.random.normal(0, step_size), -step_size, step_size)
        return current + step
    
    def _add_noise(self, value: float, noise_level: float) -> float:
        """Add Gaussian noise to a value."""
        return value + np.random.normal(0, noise_level)
    
    def _simulate_anomaly(self, value: float, probability: float = 0.02) -> tuple[float, bool]:
        """
        Occasionally simulate anomalous readings (spikes/drops).
        
        Args:
            value: Current value
            probability: Probability of anomaly occurring
        
        Returns:
            Tuple of (modified value, is_anomaly flag)
        """
        if random.random() < probability:
            # Anomaly: 50% chance of spike, 50% chance of drop
            factor = random.uniform(1.5, 3.0) if random.random() > 0.5 else random.uniform(0.3, 0.7)
            return value * factor, True
        return value, False
    
    def generate_reading(self, timestamp: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Generate a single sensor reading with realistic patterns.
        
        Args:
            timestamp: Optional timestamp (uses current time if not provided)
        
        Returns:
            Dictionary containing all sensor values and metadata
        """
        if timestamp is None:
            timestamp = datetime.utcnow()
        
        hour = timestamp.hour
        self.reading_count += 1
        
        # Generate CO2 with diurnal pattern and drift
        co2_target = self._add_diurnal_pattern(
            self.scenario["co2_base"], 
            hour, 
            self.scenario["co2_variance"] * 0.3
        )
        co2 = self._add_random_walk(
            self.last_values["co2_ppm"],
            co2_target,
            self.scenario["co2_variance"] * 0.1
        )
        co2 = self._add_noise(co2, self.scenario["co2_variance"] * 0.05)
        co2, co2_anomaly = self._simulate_anomaly(co2)
        co2 = max(350, min(5000, co2))  # Clamp to realistic range
        
        # Generate CH4 with similar patterns
        ch4_target = self._add_diurnal_pattern(
            self.scenario["ch4_base"],
            hour,
            self.scenario["ch4_variance"] * 0.2
        )
        ch4 = self._add_random_walk(
            self.last_values["ch4_ppm"],
            ch4_target,
            self.scenario["ch4_variance"] * 0.1
        )
        ch4 = self._add_noise(ch4, self.scenario["ch4_variance"] * 0.1)
        ch4, ch4_anomaly = self._simulate_anomaly(ch4)
        ch4 = max(0.5, min(10000, ch4))  # Clamp to realistic range
        
        # Generate temperature with strong diurnal pattern
        temp_target = self._add_diurnal_pattern(
            self.scenario["temp_base"],
            hour,
            self.scenario["temp_variance"]
        )
        temp = self._add_random_walk(
            self.last_values["temperature"],
            temp_target,
            self.scenario["temp_variance"] * 0.1
        )
        temp = self._add_noise(temp, 0.3)
        temp = max(-10, min(50, temp))
        
        # Generate humidity (inverse correlation with temperature)
        humidity_target = self.scenario["humidity_base"] - 0.5 * (temp - self.scenario["temp_base"])
        humidity = self._add_random_walk(
            self.last_values["humidity"],
            humidity_target,
            self.scenario["humidity_variance"] * 0.1
        )
        humidity = self._add_noise(humidity, 1.0)
        humidity = max(20, min(95, humidity))
        
        # Generate energy consumption (higher during work hours)
        work_hour_factor = 1.5 if 8 <= hour <= 18 else 0.7
        energy_target = self.scenario["energy_base"] * work_hour_factor
        energy = self._add_random_walk(
            self.last_values["energy_kwh"],
            energy_target,
            self.scenario["energy_variance"] * 0.2
        )
        energy = self._add_noise(energy, self.scenario["energy_variance"] * 0.1)
        energy = max(0, energy)
        
        # Update state
        self.last_values = {
            "co2_ppm": co2,
            "ch4_ppm": ch4,
            "temperature": temp,
            "humidity": humidity,
            "energy_kwh": energy
        }
        
        # Build reading object
        reading = {
            "device_id": DEVICE_ID,
            "facility_id": FACILITY_ID,
            "timestamp": int(timestamp.timestamp() * 1000),  # Milliseconds
            "iso_time": timestamp.isoformat() + "Z",
            "sensors": {
                "co2_ppm": round(co2, 2),
                "ch4_ppm": round(ch4, 2),
                "temperature": round(temp, 2),
                "humidity": round(humidity, 2)
            },
            "energy_kwh": round(energy, 2),
            "raw": {
                "mq135_adc": int(np.interp(co2, [350, 5000], [2000, 3800])),
                "mq4_adc": int(np.interp(ch4, [0.5, 1000], [1500, 3500])),
                "mq135_rs": round(random.uniform(10, 50), 2),
                "mq4_rs": round(random.uniform(15, 60), 2)
            },
            "meta": {
                "valid": True,
                "calibrated": True,
                "scenario": self.scenario["name"],
                "reading_number": self.reading_count,
                "simulated": True,
                "anomaly_detected": co2_anomaly or ch4_anomaly
            }
        }
        
        return reading
    
    def generate_historical_data(self, hours: int = 24, interval_minutes: int = 1) -> pd.DataFrame:
        """
        Generate historical data for training ML models.
        
        Args:
            hours: Number of hours of data to generate
            interval_minutes: Minutes between readings
        
        Returns:
            DataFrame with all generated readings
        """
        readings = []
        start = datetime.utcnow() - timedelta(hours=hours)
        
        total_readings = int((hours * 60) / interval_minutes)
        
        for i in range(total_readings):
            timestamp = start + timedelta(minutes=i * interval_minutes)
            reading = self.generate_reading(timestamp)
            
            # Flatten for DataFrame
            flat_reading = {
                "timestamp": reading["iso_time"],
                "device_id": reading["device_id"],
                "co2_ppm": reading["sensors"]["co2_ppm"],
                "ch4_ppm": reading["sensors"]["ch4_ppm"],
                "temperature": reading["sensors"]["temperature"],
                "humidity": reading["sensors"]["humidity"],
                "energy_kwh": reading["energy_kwh"],
                "scenario": self.scenario["name"]
            }
            readings.append(flat_reading)
        
        return pd.DataFrame(readings)


# ==================== MQTT Publisher ====================

class MQTTPublisher:
    """Publishes sensor data to AWS IoT Core via MQTT."""
    
    def __init__(self, endpoint: str, client_id: str, 
                 cert_path: str, key_path: str, ca_path: str):
        """
        Initialize MQTT connection to AWS IoT Core.
        
        Args:
            endpoint: AWS IoT Core endpoint
            client_id: Unique client identifier
            cert_path: Path to device certificate
            key_path: Path to private key
            ca_path: Path to root CA certificate
        """
        if not AWS_SDK_AVAILABLE:
            raise ImportError("AWS IoT SDK not installed. Run: pip install awsiotsdk")
        
        self.endpoint = endpoint
        self.client_id = client_id
        self.connected = False
        
        print(f"[MQTT] Connecting to {endpoint}...")
        
        self.connection = mqtt_connection_builder.mtls_from_path(
            endpoint=endpoint,
            port=AWS_IOT_PORT,
            cert_filepath=cert_path,
            pri_key_filepath=key_path,
            ca_filepath=ca_path,
            client_id=client_id,
            clean_session=False,
            keep_alive_secs=30
        )
        
        connect_future = self.connection.connect()
        connect_future.result()
        self.connected = True
        print("[MQTT] Connected to AWS IoT Core!")
    
    def publish(self, topic: str, payload: Dict[str, Any]) -> bool:
        """
        Publish a message to an MQTT topic.
        
        Args:
            topic: MQTT topic to publish to
            payload: Dictionary to publish as JSON
        
        Returns:
            True if successful, False otherwise
        """
        try:
            message = json.dumps(payload)
            self.connection.publish(
                topic=topic,
                payload=message,
                qos=mqtt.QoS.AT_LEAST_ONCE
            )
            print(f"[MQTT] Published to {topic}")
            return True
        except Exception as e:
            print(f"[MQTT] Publish failed: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from AWS IoT Core."""
        if self.connected:
            disconnect_future = self.connection.disconnect()
            disconnect_future.result()
            self.connected = False
            print("[MQTT] Disconnected from AWS IoT Core")


# ==================== Main Functions ====================

def run_mqtt_mode(scenario: Dict[str, Any], duration_minutes: int = 60):
    """
    Run simulator in MQTT mode, publishing to AWS IoT Core.
    
    Args:
        scenario: Facility scenario to simulate
        duration_minutes: How long to run (0 for indefinite)
    """
    print(f"\n[SIMULATOR] Starting MQTT mode with scenario: {scenario['name']}")
    print(f"[SIMULATOR] Publishing every {PUBLISH_INTERVAL_SECONDS} seconds")
    
    generator = SensorDataGenerator(scenario)
    
    try:
        publisher = MQTTPublisher(
            endpoint=AWS_IOT_ENDPOINT,
            client_id=AWS_IOT_CLIENT_ID,
            cert_path=AWS_IOT_CERT_PATH,
            key_path=AWS_IOT_KEY_PATH,
            ca_path=AWS_IOT_ROOT_CA_PATH
        )
    except Exception as e:
        print(f"[ERROR] Failed to connect: {e}")
        print("[INFO] Make sure AWS IoT certificates are in the certs/ folder")
        return
    
    start_time = time.time()
    reading_count = 0
    
    try:
        while True:
            # Check duration limit
            if duration_minutes > 0:
                elapsed = (time.time() - start_time) / 60
                if elapsed >= duration_minutes:
                    print(f"\n[SIMULATOR] Duration limit reached ({duration_minutes} minutes)")
                    break
            
            # Generate and publish reading
            reading = generator.generate_reading()
            reading_count += 1
            
            print(f"\n[READING #{reading_count}] {reading['iso_time']}")
            print(f"  CO2: {reading['sensors']['co2_ppm']:.1f} ppm")
            print(f"  CH4: {reading['sensors']['ch4_ppm']:.1f} ppm")
            print(f"  Temp: {reading['sensors']['temperature']:.1f}°C")
            print(f"  Humidity: {reading['sensors']['humidity']:.1f}%")
            print(f"  Energy: {reading['energy_kwh']:.2f} kWh")
            
            # Publish to both raw and processed topics
            publisher.publish(MQTT_TOPIC_RAW, reading)
            
            # Create processed version (simplified)
            processed = {
                "device_id": reading["device_id"],
                "facility_id": reading["facility_id"],
                "timestamp": reading["timestamp"],
                "co2_ppm": reading["sensors"]["co2_ppm"],
                "ch4_ppm": reading["sensors"]["ch4_ppm"],
                "temperature": reading["sensors"]["temperature"],
                "humidity": reading["sensors"]["humidity"],
                "energy_kwh": reading["energy_kwh"]
            }
            publisher.publish(MQTT_TOPIC_PROCESSED, processed)
            
            # Wait for next interval
            time.sleep(PUBLISH_INTERVAL_SECONDS)
            
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Interrupted by user")
    finally:
        publisher.disconnect()
        print(f"[SIMULATOR] Total readings published: {reading_count}")


def run_file_mode(scenario: Dict[str, Any], hours: int = 24, output_path: str = "sensor_data.csv"):
    """
    Run simulator in file mode, generating historical data.
    
    Args:
        scenario: Facility scenario to simulate
        hours: Hours of historical data to generate
        output_path: Path to save CSV file
    """
    print(f"\n[SIMULATOR] Generating {hours} hours of historical data...")
    print(f"[SIMULATOR] Scenario: {scenario['name']}")
    
    generator = SensorDataGenerator(scenario, seed=42)
    df = generator.generate_historical_data(hours=hours, interval_minutes=1)
    
    df.to_csv(output_path, index=False)
    print(f"[SIMULATOR] Saved {len(df)} readings to {output_path}")
    
    # Print summary statistics
    print("\n[SUMMARY] Data Statistics:")
    print(df.describe())
    
    return df


def run_console_mode(scenario: Dict[str, Any], count: int = 10):
    """
    Run simulator in console mode, printing readings.
    
    Args:
        scenario: Facility scenario to simulate
        count: Number of readings to generate
    """
    print(f"\n[SIMULATOR] Console mode - generating {count} readings")
    print(f"[SIMULATOR] Scenario: {scenario['name']}\n")
    
    generator = SensorDataGenerator(scenario)
    
    for i in range(count):
        reading = generator.generate_reading()
        print(f"Reading {i+1}:")
        print(json.dumps(reading, indent=2))
        print()


# ==================== Entry Point ====================

def main():
    parser = argparse.ArgumentParser(
        description="IoT Data Simulator for Carbon Monitoring System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run data_simulator.py --mode console --scenario normal
  uv run data_simulator.py --mode file --scenario waste_processing --hours 168
  uv run data_simulator.py --mode mqtt --scenario industrial_combustion
        """
    )
    
    parser.add_argument(
        "--mode",
        choices=["mqtt", "file", "console"],
        default="console",
        help="Output mode: mqtt (publish to AWS), file (save CSV), console (print)"
    )
    
    parser.add_argument(
        "--scenario",
        choices=["normal", "waste_processing", "industrial_combustion", "agricultural"],
        default="normal",
        help="Facility scenario to simulate"
    )
    
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Hours of data to generate (file mode)"
    )
    
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Duration in minutes to run (mqtt mode, 0=indefinite)"
    )
    
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Number of readings to generate (console mode)"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        default="sensor_data.csv",
        help="Output file path (file mode)"
    )
    
    args = parser.parse_args()
    
    # Select scenario
    scenarios = {
        "normal": FacilityScenario.normal_operations(),
        "waste_processing": FacilityScenario.waste_processing(),
        "industrial_combustion": FacilityScenario.industrial_combustion(),
        "agricultural": FacilityScenario.agricultural()
    }
    scenario = scenarios[args.scenario]
    
    print("=" * 60)
    print("   IoT Carbon Monitor - Data Simulator")
    print("=" * 60)
    
    # Run selected mode
    if args.mode == "mqtt":
        run_mqtt_mode(scenario, args.duration)
    elif args.mode == "file":
        run_file_mode(scenario, args.hours, args.output)
    else:
        run_console_mode(scenario, args.count)


if __name__ == "__main__":
    main()
