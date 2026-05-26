"""
Firebase Cloud Function — Carbon Emission Predictor
====================================================
HTTP endpoint that loads the trained Harare Ridge model from
Firebase Storage and returns a CO2e prediction for a sensor reading.

Endpoint: POST /predictEmissions
Body: { co2_ppm, ch4_ppm, temperature, humidity, energy_kwh, facility_id? }

Deploy:
    firebase deploy --only functions
"""

import os
import json
import tempfile
import math
import logging
from datetime import datetime

import functions_framework
from firebase_admin import initialize_app, storage
import firebase_admin

logger = logging.getLogger(__name__)

# Initialise Firebase Admin once (survives warm starts)
if not firebase_admin._apps:
    initialize_app()

# Model cache — persists across warm invocations
_model_package = None

MODEL_STORAGE_PATH = "models/carbon_predictor_v1.joblib"
RAINY_MONTHS = {11, 12, 1, 2, 3}

# Emission factors (must match training script)
ZESA_GRID_EF      = 0.92
CH4_GWP           = 28
CH4_DENSITY       = 0.657
CO2_DENSITY       = 1.977
MONITORING_VOL_M3 = 100
ATMOSPHERIC_CO2   = 420
ATMOSPHERIC_CH4   = 1.9


def load_model():
    """Download model from Firebase Storage and cache it."""
    global _model_package
    if _model_package is not None:
        return _model_package

    try:
        import joblib
        bucket = storage.bucket()
        blob   = bucket.blob(MODEL_STORAGE_PATH)

        with tempfile.NamedTemporaryFile(suffix=".joblib", delete=False) as tmp:
            blob.download_to_filename(tmp.name)
            _model_package = joblib.load(tmp.name)

        logger.info("Model loaded from Firebase Storage")
        return _model_package

    except Exception as e:
        logger.warning(f"Could not load model: {e} — using rule-based fallback")
        return None


def build_features(data: dict) -> list:
    """Build the feature vector in the same order as training."""
    import numpy as np

    now   = datetime.utcnow()
    hour  = data.get("hour",  now.hour)
    month = data.get("month", now.month)
    dow   = now.weekday()

    co2_ppm     = float(data.get("co2_ppm",     420))
    ch4_ppm     = float(data.get("ch4_ppm",     1.9))
    temperature = float(data.get("temperature", 25))
    humidity    = float(data.get("humidity",    55))
    energy_kwh  = float(data.get("energy_kwh",  0))

    co2_excess = max(0, co2_ppm  - ATMOSPHERIC_CO2)
    ch4_excess = max(0, ch4_ppm  - ATMOSPHERIC_CH4)

    features = {
        "co2_ppm":           co2_ppm,
        "ch4_ppm":           ch4_ppm,
        "temperature":       temperature,
        "humidity":          humidity,
        "energy_kwh":        energy_kwh,
        "hour":              hour,
        "day_of_week":       dow,
        "is_weekend":        1 if dow >= 5 else 0,
        "month":             month,
        "is_rainy_season":   1 if month in RAINY_MONTHS else 0,
        "zesa_online":       1,
        "dormant":           0,
        "hour_sin":          math.sin(2 * math.pi * hour / 24),
        "hour_cos":          math.cos(2 * math.pi * hour / 24),
        "dow_sin":           math.sin(2 * math.pi * dow / 7),
        "dow_cos":           math.cos(2 * math.pi * dow / 7),
        "month_sin":         math.sin(2 * math.pi * month / 12),
        "month_cos":         math.cos(2 * math.pi * month / 12),
        "co2_ch4_ratio":     co2_ppm / (ch4_ppm + 0.1),
        "temp_humidity_idx": temperature * humidity / 100,
        "energy_per_co2":    energy_kwh / (co2_ppm + 1),
        "co2_excess":        co2_excess,
        "ch4_excess":        ch4_excess,
        # Rolling/lag features default to current values when no history
        "co2_ppm_roll5":     co2_ppm,
        "ch4_ppm_roll5":     ch4_ppm,
        "energy_kwh_roll5":  energy_kwh,
        "co2_ppm_roll12":    co2_ppm,
        "ch4_ppm_roll12":    ch4_ppm,
        "co2_ppm_diff":      0,
        "ch4_ppm_diff":      0,
        "co2_lag1":          co2_ppm,
        "ch4_lag1":          ch4_ppm,
        "co2_lag3":          co2_ppm,
        "ch4_lag3":          ch4_ppm,
        "isic_num":          0,
    }

    # Facility dummy
    facility_id = data.get("facility_id", "")
    if facility_id:
        features[f"fac_{facility_id}"] = 1

    return features


def rule_based_prediction(data: dict) -> dict:
    """GHG Protocol fallback if model is unavailable."""
    co2_ppm    = float(data.get("co2_ppm",    420))
    ch4_ppm    = float(data.get("ch4_ppm",    1.9))
    energy_kwh = float(data.get("energy_kwh", 0))

    ch4_excess      = max(0, ch4_ppm - ATMOSPHERIC_CH4)
    ch4_mass_kg     = (ch4_excess / 1e6) * MONITORING_VOL_M3 * CH4_DENSITY
    ch4_scope1_kg   = ch4_mass_kg * CH4_GWP

    co2_excess      = max(0, co2_ppm - ATMOSPHERIC_CO2)
    co2_direct_kg   = (co2_excess / 1e6) * MONITORING_VOL_M3 * CO2_DENSITY

    energy_scope2_kg = energy_kwh * ZESA_GRID_EF
    total            = ch4_scope1_kg + co2_direct_kg + energy_scope2_kg

    return {
        "predicted_co2e_kg": round(total, 6),
        "breakdown": {
            "energy_scope2_kg": round(energy_scope2_kg, 6),
            "ch4_scope1_kg":    round(ch4_scope1_kg,    6),
            "co2_direct_kg":    round(co2_direct_kg,    6),
        },
        "method":        "rule_based_ghg_protocol",
        "model_version": "fallback",
    }


@functions_framework.http
def predict_emissions(request):
    """HTTP Cloud Function entry point."""

    # CORS headers for the Next.js app
    headers = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    }

    if request.method == "OPTIONS":
        return ("", 204, headers)

    if request.method != "POST":
        return (json.dumps({"error": "POST required"}), 405, headers)

    try:
        data = request.get_json(force=True)
        if not data:
            return (json.dumps({"error": "JSON body required"}), 400, headers)

        required = ["co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh"]
        missing  = [f for f in required if f not in data]
        if missing:
            return (json.dumps({"error": f"Missing fields: {missing}"}), 400, headers)

        pkg = load_model()

        if pkg and pkg.get("model"):
            import numpy as np
            model  = pkg["model"]
            scaler = pkg.get("scaler")
            feat_names = pkg["feature_names"]

            features_dict = build_features(data)
            X = np.array([features_dict.get(f, 0) for f in feat_names]).reshape(1, -1)

            if scaler:
                X = scaler.transform(X)

            predicted = float(max(0, model.predict(X)[0]))
            uncertainty = 0.05

            result = {
                "predicted_co2e_kg": round(predicted, 6),
                "confidence_lower":  round(predicted * (1 - uncertainty), 6),
                "confidence_upper":  round(predicted * (1 + uncertainty), 6),
                "breakdown":         rule_based_prediction(data)["breakdown"],
                "method":            "ml_ridge_harare_v1",
                "model_version":     pkg.get("version", "v1"),
            }
        else:
            result = rule_based_prediction(data)

        result["timestamp"] = datetime.utcnow().isoformat() + "Z"
        return (json.dumps({"success": True, "prediction": result}), 200, headers)

    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return (json.dumps({"error": str(e)}), 500, headers)
