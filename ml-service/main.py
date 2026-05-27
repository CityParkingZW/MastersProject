"""
Harare Carbon Emission ML Service
==================================
FastAPI app deployed on Render.com.
Loads the trained Harare Ridge model and serves predictions
via POST /predict.
"""

import math
import os
from datetime import datetime

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Harare Carbon ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model once at startup
MODEL_PATH = os.path.join(os.path.dirname(__file__), "carbon_predictor_v1.joblib")
_pkg = joblib.load(MODEL_PATH)
_model        = _pkg["model"]
_scaler       = _pkg["scaler"]
_feature_names = _pkg["feature_names"]
_metrics      = _pkg.get("metrics", {})

RAINY_MONTHS  = {11, 12, 1, 2, 3}
ZESA_GRID_EF  = 0.92
CH4_GWP       = 28
CH4_DENSITY   = 0.657
CO2_DENSITY   = 1.977
VOL           = 100
ATM_CO2       = 420
ATM_CH4       = 1.9


class SensorReading(BaseModel):
    co2_ppm:     float
    ch4_ppm:     float
    temperature: float
    humidity:    float
    energy_kwh:  float
    facility_id: str = ""
    hour:        int | None = None
    month:       int | None = None
    is_weekend:  bool = False
    zesa_online: bool = True


def build_features(r: SensorReading) -> np.ndarray:
    now   = datetime.utcnow()
    hour  = r.hour  if r.hour  is not None else now.hour
    month = r.month if r.month is not None else now.month

    ch4_excess = max(0.0, r.ch4_ppm  - ATM_CH4)
    co2_excess = max(0.0, r.co2_ppm  - ATM_CO2)

    feat_map = {
        "co2_ppm":         r.co2_ppm,
        "ch4_ppm":         r.ch4_ppm,
        "temperature":     r.temperature,
        "humidity":        r.humidity,
        "energy_kwh":      r.energy_kwh,
        "hour":            float(hour),
        "is_weekend":      1.0 if r.is_weekend else 0.0,
        "is_rainy_season": 1.0 if month in RAINY_MONTHS else 0.0,
        "zesa_online":     1.0 if r.zesa_online else 0.0,
        "hour_sin":        math.sin(2 * math.pi * hour / 24),
        "hour_cos":        math.cos(2 * math.pi * hour / 24),
        "ch4_excess":      ch4_excess,
        "co2_excess":      co2_excess,
        "energy_per_co2":  r.energy_kwh / (r.co2_ppm + 1),
        "temp_humidity":   r.temperature * r.humidity / 100,
    }

    return np.array([feat_map.get(f, 0.0) for f in _feature_names]).reshape(1, -1)


def ghg_breakdown(r: SensorReading) -> dict:
    ch4_excess       = max(0.0, r.ch4_ppm - ATM_CH4)
    ch4_scope1_kg    = (ch4_excess / 1e6) * VOL * CH4_DENSITY * CH4_GWP
    co2_excess       = max(0.0, r.co2_ppm - ATM_CO2)
    co2_direct_kg    = (co2_excess / 1e6) * VOL * CO2_DENSITY
    energy_scope2_kg = r.energy_kwh * ZESA_GRID_EF
    return {
        "energy_scope2_kg": round(energy_scope2_kg, 6),
        "ch4_scope1_kg":    round(ch4_scope1_kg,    6),
        "co2_direct_kg":    round(co2_direct_kg,    6),
    }


@app.get("/")
def health():
    return {
        "status":       "ok",
        "model":        "Ridge-Harare-v1",
        "r2":           _metrics.get("r2"),
        "features":     len(_feature_names),
        "training": {
            "facilities": 7,
            "rows":       120960,
            "grid_ef":    ZESA_GRID_EF,
            "altitude_m": 1483,
        },
    }


@app.post("/predict")
def predict(reading: SensorReading):
    try:
        X = build_features(reading)
        X_scaled   = _scaler.transform(X)
        predicted  = float(max(0.0, _model.predict(X_scaled)[0]))
        uncertainty = 0.05

        return {
            "success": True,
            "prediction": {
                "predicted_co2e_kg":  round(predicted, 6),
                "confidence_lower":   round(predicted * (1 - uncertainty), 6),
                "confidence_upper":   round(predicted * (1 + uncertainty), 6),
                "breakdown":          ghg_breakdown(reading),
                "model_version":      "Ridge-Harare-v1 (R2=1.00)",
                "method":             "ml_ridge",
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
