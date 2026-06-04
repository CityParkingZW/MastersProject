"""
Harare Industrial Carbon model — router under /industrial
==========================================================
The original ZCMA-era Ridge model that predicts CO2e emissions (kg) from
industrial sensor readings (CO2/CH4 in mg/m3, energy kWh, ZESA grid status).
Preserved so the legacy version's predictions remain available from the same
deployment as the Kgotso air-quality forecaster.
"""

import math
import os
from datetime import datetime, timezone

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/industrial", tags=["industrial"])

# ── Load model once at import ──────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "carbon_predictor_v1.joblib")
_pkg = joblib.load(MODEL_PATH)
_model         = _pkg["model"]
_scaler        = _pkg["scaler"]
_feature_names = _pkg["feature_names"]
_metrics       = _pkg.get("metrics", {})

RAINY_MONTHS  = {11, 12, 1, 2, 3}
ZESA_GRID_EF  = 0.92
CH4_GWP       = 28
CH4_DENSITY   = 0.657
CO2_DENSITY   = 1.977
VOL           = 100
ATM_CO2       = 420
ATM_CH4       = 1.9
CO2_MG_TO_PPM = 24.45 / 44.01
CH4_MG_TO_PPM = 24.45 / 16.04


class SensorReading(BaseModel):
    co2_mg_m3:   float
    ch4_mg_m3:   float
    temperature: float
    humidity:    float
    energy_kwh:  float
    facility_id: str = ""
    hour:        int | None = None
    month:       int | None = None
    is_weekend:  bool = False
    zesa_online: bool = True


def build_features(r: SensorReading) -> np.ndarray:
    now   = datetime.now(timezone.utc)
    hour  = r.hour  if r.hour  is not None else now.hour
    month = r.month if r.month is not None else now.month

    co2_ppm = r.co2_mg_m3 * CO2_MG_TO_PPM
    ch4_ppm = r.ch4_mg_m3 * CH4_MG_TO_PPM
    ch4_excess = max(0.0, ch4_ppm - ATM_CH4)
    co2_excess = max(0.0, co2_ppm - ATM_CO2)

    feat_map = {
        "co2_ppm":         co2_ppm,
        "ch4_ppm":         ch4_ppm,
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
        "energy_per_co2":  r.energy_kwh / (co2_ppm + 1),
        "temp_humidity":   r.temperature * r.humidity / 100,
    }
    return np.array([feat_map.get(f, 0.0) for f in _feature_names]).reshape(1, -1)


def ghg_breakdown(r: SensorReading) -> dict:
    co2_ppm          = r.co2_mg_m3 * CO2_MG_TO_PPM
    ch4_ppm          = r.ch4_mg_m3 * CH4_MG_TO_PPM
    ch4_excess       = max(0.0, ch4_ppm - ATM_CH4)
    ch4_scope1_kg    = (ch4_excess / 1e6) * VOL * CH4_DENSITY * CH4_GWP
    co2_excess       = max(0.0, co2_ppm - ATM_CO2)
    co2_direct_kg    = (co2_excess / 1e6) * VOL * CO2_DENSITY
    energy_scope2_kg = r.energy_kwh * ZESA_GRID_EF
    return {
        "energy_scope2_kg": round(energy_scope2_kg, 6),
        "ch4_scope1_kg":    round(ch4_scope1_kg,    6),
        "co2_direct_kg":    round(co2_direct_kg,    6),
    }


def info() -> dict:
    return {
        "model":    "Ridge-Harare-v1",
        "r2":       _metrics.get("r2"),
        "features": len(_feature_names),
        "training": {"facilities": 7, "rows": 120960, "grid_ef": ZESA_GRID_EF, "altitude_m": 1483},
    }


@router.post("/predict")
def predict(reading: SensorReading):
    try:
        X = build_features(reading)
        x_scaled  = _scaler.transform(X)
        predicted = float(max(0.0, _model.predict(x_scaled)[0]))
        uncertainty = 0.05
        return {
            "success": True,
            "prediction": {
                "predicted_co2e_kg": round(predicted, 6),
                "confidence_lower":  round(predicted * (1 - uncertainty), 6),
                "confidence_upper":  round(predicted * (1 + uncertainty), 6),
                "breakdown":         ghg_breakdown(reading),
                "model_version":     "Ridge-Harare-v1",
                "method":            "ml_ridge",
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
