"""
Kgotso ClimateHealth CO2 forecast model — router under /kgotso
===============================================================
Autoregressive hourly CO2 (ppm) forecaster for the Harare monitoring station.
Predicts CO2[t] from recent lags (1/2/3/24 h) + diurnal/seasonal calendar
features, so forecasts are produced iteratively by feeding predictions back in.
"""

import os
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/kgotso", tags=["kgotso"])

# ── Load model once at import ──────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "kgotso_co2_model.joblib")
_pkg = joblib.load(MODEL_PATH)
_model         = _pkg["model"]
_scaler        = _pkg["scaler"]
_feature_names = _pkg["feature_names"]
_needs_scaler  = _pkg.get("needs_scaler", False)
_metrics       = _pkg.get("metrics", {})
_meta          = _pkg.get("meta", {})

RAINY_MONTHS = set(_meta.get("rainy_months", [11, 12, 1, 2, 3]))

# ── Carbon constants (3,000 m³ Kgotso coverage area, Harare 1,483 m) ───────────
MONITORING_VOL_M3  = 3_000
HARARE_AIR_DENSITY = 1.09
CO2_MOL_MASS       = 44.01
AIR_MOL_MASS       = 28.97
AMBIENT_CO2_PPM    = 420.0
CO2_SCALE          = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (CO2_MOL_MASS / AIR_MOL_MASS)) / 1e6


def excess_kg_per_hour(co2_ppm: float) -> float:
    return max(0.0, co2_ppm - AMBIENT_CO2_PPM) * CO2_SCALE


class ForecastRequest(BaseModel):
    recent_co2:     list[float]
    last_timestamp: str | None = None
    forecast_hours: int = 24


def _feature_row(hist: list[float], when: datetime) -> np.ndarray:
    def lag(n): return hist[-n] if len(hist) >= n else hist[0]
    roll_3 = float(np.mean(hist[-3:]))
    roll_6 = float(np.mean(hist[-6:]))
    h, m, dow = when.hour, when.month, when.weekday()
    feat = {
        "lag_1": lag(1), "lag_2": lag(2), "lag_3": lag(3), "lag_24": lag(24),
        "roll_3": roll_3, "roll_6": roll_6,
        "hour_sin":  np.sin(2 * np.pi * h / 24),
        "hour_cos":  np.cos(2 * np.pi * h / 24),
        "month_sin": np.sin(2 * np.pi * m / 12),
        "month_cos": np.cos(2 * np.pi * m / 12),
        "dow_sin":   np.sin(2 * np.pi * dow / 7),
        "dow_cos":   np.cos(2 * np.pi * dow / 7),
        "is_rainy_season": 1.0 if m in RAINY_MONTHS else 0.0,
    }
    return np.array([feat[f] for f in _feature_names]).reshape(1, -1)


def _predict_one(hist: list[float], when: datetime) -> float:
    X = _feature_row(hist, when)
    if _needs_scaler:
        X = _scaler.transform(X)
    return float(_model.predict(X)[0])


def info() -> dict:
    return {
        "model":   _metrics.get("model_type", "unknown"),
        "metrics": _metrics,
        "meta":    _meta,
        "carbon": {
            "monitoring_vol_m3": MONITORING_VOL_M3,
            "ambient_ppm":       AMBIENT_CO2_PPM,
            "kg_per_ppm_hour":   round(CO2_SCALE, 6),
        },
    }


def run_forecast(req: ForecastRequest) -> dict:
    if not req.recent_co2:
        raise ValueError("recent_co2 must contain at least one reading")

    hist = [float(x) for x in req.recent_co2]
    hrs  = max(1, min(req.forecast_hours, 48))

    if req.last_timestamp:
        base = datetime.fromisoformat(req.last_timestamp.replace("Z", "+00:00"))
    else:
        base = datetime.now(timezone.utc)

    forecast = []
    for i in range(1, hrs + 1):
        when      = base + timedelta(hours=i)
        predicted = max(380.0, _predict_one(hist, when))
        hist.append(predicted)
        band = _metrics.get("rmse", 6.0) * (1 + 0.04 * i)
        forecast.append({
            "hour_offset":   i,
            "predicted_ppm": round(predicted, 1),
            "lower_ppm":     round(max(380.0, predicted - band), 1),
            "upper_ppm":     round(predicted + band, 1),
            "carbon_kg_h":   round(excess_kg_per_hour(predicted), 6),
        })

    total_kg = sum(p["carbon_kg_h"] for p in forecast)
    return {
        "success":        True,
        "model_version":  f"{_metrics.get('model_type','model')}-Kgotso-v2 "
                          f"(R2={_metrics.get('r2')}, RMSE={_metrics.get('rmse')} ppm)",
        "baseline_ppm":   round(float(np.mean(req.recent_co2[-6:])), 1),
        "forecast_hours": hrs,
        "forecast":       forecast,
        "carbon_summary": {
            "forecast_window_kg":       round(total_kg, 4),
            "monthly_projection_tco2e": round(total_kg / hrs * 24 * 30 / 1000, 4),
            "monitoring_vol_m3":        MONITORING_VOL_M3,
            "method": "GBR autoregressive forecast + Harare altitude carbon density",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/predict")
def predict(req: ForecastRequest):
    try:
        return run_forecast(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
