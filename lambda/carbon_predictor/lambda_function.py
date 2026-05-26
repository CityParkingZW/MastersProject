"""
Carbon Emission Predictor Lambda Function

This Lambda function:
1. Receives sensor data from AWS IoT Core rules
2. Loads the trained ML model from S3
3. Runs prediction for CO2-equivalent emissions
4. Stores predictions in DynamoDB
5. Publishes results back to IoT Core

Trigger: AWS IoT Core Rule on 'facility/sensors/processed' topic

Author: H240486C
Date: 2026
"""

import json
import os
import boto3
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, Any, List, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
iot_data = boto3.client("iot-data")

# Configuration from environment variables
TABLE_PREDICTIONS = os.environ.get("TABLE_PREDICTIONS", "emission_predictions")
TABLE_SENSOR_READINGS = os.environ.get("TABLE_SENSOR_READINGS", "sensor_readings")
MODEL_BUCKET = os.environ.get("MODEL_BUCKET", "carbon-monitor-models")
MODEL_KEY = os.environ.get("MODEL_KEY", "models/carbon_predictor_v1.joblib")
PREDICTION_TOPIC = os.environ.get("PREDICTION_TOPIC", "facility/emissions/predictions")

# GHG Protocol Emission Factors
EMISSION_FACTORS = {
    "ch4_gwp": 28,              # Global Warming Potential for methane (IPCC AR6)
    "co2_gwp": 1,               # CO2 baseline
    "n2o_gwp": 265,             # Nitrous oxide (if measured)
    "grid_ef_zimbabwe": 0.92,   # kg CO2e/kWh for Zimbabwe electricity grid
    "grid_ef_default": 0.5,     # Default grid emission factor
    "diesel_ef": 2.68,          # kg CO2e/L diesel
    "ch4_density": 0.657,       # kg/m3 at STP for volume to mass conversion
}

# Model placeholder (loaded on cold start)
_model = None
_scaler = None


def load_model():
    """
    Load trained ML model from S3.
    
    Returns:
        Tuple of (model, scaler) or (None, None) if loading fails
    """
    global _model, _scaler
    
    if _model is not None:
        return _model, _scaler
    
    try:
        import joblib
        import tempfile
        
        # Download model from S3
        with tempfile.NamedTemporaryFile(suffix=".joblib") as tmp:
            logger.info(f"Loading model from s3://{MODEL_BUCKET}/{MODEL_KEY}")
            s3.download_file(MODEL_BUCKET, MODEL_KEY, tmp.name)
            
            model_data = joblib.load(tmp.name)
            _model = model_data.get("model")
            _scaler = model_data.get("scaler")
            
            logger.info("Model loaded successfully")
            return _model, _scaler
            
    except Exception as e:
        logger.warning(f"Could not load model from S3: {e}")
        logger.info("Using rule-based prediction as fallback")
        return None, None


def calculate_emissions_rule_based(sensor_data: Dict[str, Any]) -> Dict[str, float]:
    """
    Calculate CO2-equivalent emissions using rule-based approach.
    
    This is used as a fallback when ML model is not available,
    and follows GHG Protocol methodology.
    
    Args:
        sensor_data: Dictionary containing sensor readings
        
    Returns:
        Dictionary with emission calculations
    """
    # Extract sensor values with defaults
    ch4_ppm = sensor_data.get("ch4_ppm", 0)
    co2_ppm = sensor_data.get("co2_ppm", 400)  # Atmospheric baseline
    temperature = sensor_data.get("temperature", 25)
    humidity = sensor_data.get("humidity", 50)
    energy_kwh = sensor_data.get("energy_kwh", 0)
    
    # Time period for accumulation (default: 1 hour)
    hours = 1
    
    # Calculate methane emissions
    # Convert PPM to mass: ppm * air_volume * ch4_density / 1e6
    # Assuming monitoring area of ~100m3
    monitoring_volume_m3 = 100
    ch4_excess_ppm = max(0, ch4_ppm - 2.0)  # Above atmospheric baseline (~2 ppm)
    ch4_mass_kg = (ch4_excess_ppm / 1e6) * monitoring_volume_m3 * EMISSION_FACTORS["ch4_density"] * hours
    ch4_co2e = ch4_mass_kg * EMISSION_FACTORS["ch4_gwp"]
    
    # Calculate direct CO2 emissions (excess above atmospheric)
    co2_excess_ppm = max(0, co2_ppm - 420)  # Above atmospheric baseline (~420 ppm)
    co2_density_kg_m3 = 1.977  # kg/m3 at STP
    co2_mass_kg = (co2_excess_ppm / 1e6) * monitoring_volume_m3 * co2_density_kg_m3 * hours
    direct_co2 = co2_mass_kg * EMISSION_FACTORS["co2_gwp"]
    
    # Calculate energy-related emissions
    grid_ef = EMISSION_FACTORS["grid_ef_zimbabwe"]
    energy_co2e = energy_kwh * hours * grid_ef
    
    # Total CO2-equivalent
    total_co2e = ch4_co2e + direct_co2 + energy_co2e
    
    # Calculate uncertainty (simplified approach)
    uncertainty_pct = 15.0  # Typical uncertainty for facility-level estimates
    
    return {
        "total_co2e_kg": round(total_co2e, 6),
        "ch4_co2e_kg": round(ch4_co2e, 6),
        "direct_co2_kg": round(direct_co2, 6),
        "energy_co2e_kg": round(energy_co2e, 6),
        "ch4_mass_kg": round(ch4_mass_kg, 9),
        "co2_mass_kg": round(co2_mass_kg, 9),
        "uncertainty_pct": uncertainty_pct,
        "method": "rule_based",
        "emission_factors": {
            "ch4_gwp": EMISSION_FACTORS["ch4_gwp"],
            "grid_ef": grid_ef
        }
    }


def calculate_emissions_ml(sensor_data: Dict[str, Any], model, scaler) -> Dict[str, float]:
    """
    Calculate CO2-equivalent emissions using ML model.
    
    Args:
        sensor_data: Dictionary containing sensor readings
        model: Trained ML model
        scaler: Feature scaler
        
    Returns:
        Dictionary with emission predictions
    """
    import numpy as np
    
    # Extract features in the order expected by the model
    features = [
        sensor_data.get("co2_ppm", 400),
        sensor_data.get("ch4_ppm", 2),
        sensor_data.get("temperature", 25),
        sensor_data.get("humidity", 50),
        sensor_data.get("energy_kwh", 0),
        datetime.utcnow().hour,  # Hour of day
        datetime.utcnow().weekday()  # Day of week
    ]
    
    # Scale features
    X = np.array(features).reshape(1, -1)
    if scaler:
        X = scaler.transform(X)
    
    # Make prediction
    prediction = model.predict(X)[0]
    
    # Get prediction confidence (if model supports it)
    confidence = 85.0  # Default confidence
    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(X)
            confidence = float(max(proba[0])) * 100
        except:
            pass
    
    # Also calculate rule-based for comparison
    rule_based = calculate_emissions_rule_based(sensor_data)
    
    return {
        "total_co2e_kg": round(float(prediction), 6),
        "ch4_co2e_kg": rule_based["ch4_co2e_kg"],
        "direct_co2_kg": rule_based["direct_co2_kg"],
        "energy_co2e_kg": rule_based["energy_co2e_kg"],
        "rule_based_estimate": rule_based["total_co2e_kg"],
        "ml_confidence": round(confidence, 2),
        "method": "ml_prediction",
        "model_version": os.environ.get("MODEL_VERSION", "v1")
    }


def store_prediction(device_id: str, timestamp: int, prediction: Dict[str, Any]):
    """
    Store prediction in DynamoDB.
    
    Args:
        device_id: Device identifier
        timestamp: Unix timestamp in milliseconds
        prediction: Prediction results dictionary
    """
    table = dynamodb.Table(TABLE_PREDICTIONS)
    
    # Convert floats to Decimal for DynamoDB
    def convert_to_decimal(obj):
        if isinstance(obj, float):
            return Decimal(str(round(obj, 9)))
        elif isinstance(obj, dict):
            return {k: convert_to_decimal(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_decimal(i) for i in obj]
        return obj
    
    item = {
        "device_id": device_id,
        "timestamp": timestamp,
        "iso_time": datetime.utcfromtimestamp(timestamp / 1000).isoformat() + "Z",
        "predicted_co2e": convert_to_decimal(prediction["total_co2e_kg"]),
        "prediction_details": convert_to_decimal(prediction),
        "model_version": prediction.get("model_version", "rule_based"),
        "created_at": datetime.utcnow().isoformat() + "Z"
    }
    
    table.put_item(Item=item)
    logger.info(f"Stored prediction for device {device_id} at {timestamp}")


def publish_prediction(device_id: str, prediction: Dict[str, Any]):
    """
    Publish prediction results back to IoT Core.
    
    Args:
        device_id: Device identifier
        prediction: Prediction results
    """
    message = {
        "device_id": device_id,
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "prediction": prediction
    }
    
    try:
        iot_data.publish(
            topic=PREDICTION_TOPIC,
            qos=1,
            payload=json.dumps(message)
        )
        logger.info(f"Published prediction to {PREDICTION_TOPIC}")
    except Exception as e:
        logger.error(f"Failed to publish prediction: {e}")


def get_historical_data(device_id: str, hours: int = 24) -> List[Dict[str, Any]]:
    """
    Retrieve historical sensor data for time-series predictions.
    
    Args:
        device_id: Device identifier
        hours: Number of hours of history to retrieve
        
    Returns:
        List of historical readings
    """
    table = dynamodb.Table(TABLE_SENSOR_READINGS)
    
    # Calculate time range
    end_time = int(datetime.utcnow().timestamp() * 1000)
    start_time = int((datetime.utcnow() - timedelta(hours=hours)).timestamp() * 1000)
    
    try:
        response = table.query(
            KeyConditionExpression="device_id = :did AND #ts BETWEEN :start AND :end",
            ExpressionAttributeNames={"#ts": "timestamp"},
            ExpressionAttributeValues={
                ":did": device_id,
                ":start": start_time,
                ":end": end_time
            },
            ScanIndexForward=True  # Oldest first
        )
        
        return response.get("Items", [])
        
    except Exception as e:
        logger.error(f"Error fetching historical data: {e}")
        return []


def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Main Lambda handler function.
    
    Args:
        event: Event data from IoT Core rule or direct invocation
        context: Lambda context object
        
    Returns:
        Response dictionary
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Extract sensor data from event
        # Handle both direct IoT Core trigger and API Gateway invocations
        if "body" in event:
            # API Gateway invocation
            sensor_data = json.loads(event["body"])
        else:
            # Direct IoT Core trigger
            sensor_data = event
        
        # Validate required fields
        device_id = sensor_data.get("device_id")
        if not device_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing device_id"})
            }
        
        timestamp = sensor_data.get("timestamp", int(datetime.utcnow().timestamp() * 1000))
        
        # Load ML model (cached across invocations)
        model, scaler = load_model()
        
        # Calculate emissions
        if model is not None:
            prediction = calculate_emissions_ml(sensor_data, model, scaler)
        else:
            prediction = calculate_emissions_rule_based(sensor_data)
        
        # Add metadata
        prediction["device_id"] = device_id
        prediction["facility_id"] = sensor_data.get("facility_id", "unknown")
        prediction["timestamp"] = timestamp
        prediction["input_data"] = {
            "co2_ppm": sensor_data.get("co2_ppm"),
            "ch4_ppm": sensor_data.get("ch4_ppm"),
            "temperature": sensor_data.get("temperature"),
            "humidity": sensor_data.get("humidity"),
            "energy_kwh": sensor_data.get("energy_kwh")
        }
        
        # Store prediction
        store_prediction(device_id, timestamp, prediction)
        
        # Publish to IoT Core
        publish_prediction(device_id, prediction)
        
        logger.info(f"Prediction complete: {prediction['total_co2e_kg']} kg CO2e")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "success": True,
                "prediction": prediction
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing event: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": str(e),
                "event": event
            })
        }


# For local testing
if __name__ == "__main__":
    # Test event
    test_event = {
        "device_id": "test-device-01",
        "facility_id": "facility-001",
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "co2_ppm": 800,
        "ch4_ppm": 50,
        "temperature": 28,
        "humidity": 65,
        "energy_kwh": 25
    }
    
    # Mock context
    class MockContext:
        function_name = "carbon_predictor"
        memory_limit_in_mb = 128
        invoked_function_arn = "arn:aws:lambda:us-east-1:123456789:function:carbon_predictor"
        aws_request_id = "test-request-id"
    
    result = lambda_handler(test_event, MockContext())
    print(json.dumps(json.loads(result["body"]), indent=2))
