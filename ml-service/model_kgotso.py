"""
Kgotso ClimateHealth CO2 forecast models — router under /kgotso
================================================================
Autoregressive hourly CO2 (ppm) forecasting for the Harare monitoring station.
The joblib package holds THREE models for comparison:
  - gbr             Gradient Boosting   (best)
  - ridge           Ridge Regression
  - seasonal_naive  Seasonal-Naive (value 24 h earlier) baseline

Routes:
  POST /kgotso/predict   best-model forecast + carbon (dashboard / reports)
  POST /kgotso/compare   all three models' forecasts + held-out metrics
"""

import os
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/kgotso", tags=["kgotso"])

# ── Load package once at import ────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "kgotso_co2_model.joblib")
_pkg = joblib.load(MODEL_PATH)
_feature_names = _pkg["feature_names"]
_scaler        = _pkg["scaler"]
_meta          = _pkg.get("meta", {})
_best          = _pkg.get("best", "gbr")
_models        = _pkg.get("models", {
    # back-compat if an old single-model package is ever loaded
    "gbr": {"estimator": _pkg.get("model"), "needs_scaler": _pkg.get("needs_scaler", False),
            "label": "Gradient Boosting", "metrics": _pkg.get("metrics", {})},
})

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
    h, m, dow = when.hour, when.month, when.weekday()
    feat = {
        "lag_1": lag(1), "lag_2": lag(2), "lag_3": lag(3), "lag_24": lag(24),
        "roll_3": float(np.mean(hist[-3:])), "roll_6": float(np.mean(hist[-6:])),
        "hour_sin":  np.sin(2*np.pi*h/24),  "hour_cos":  np.cos(2*np.pi*h/24),
        "month_sin": np.sin(2*np.pi*m/12),  "month_cos": np.cos(2*np.pi*m/12),
        "dow_sin":   np.sin(2*np.pi*dow/7), "dow_cos":   np.cos(2*np.pi*dow/7),
        "is_rainy_season": 1.0 if m in RAINY_MONTHS else 0.0,
    }
    return np.array([feat[f] for f in _feature_names]).reshape(1, -1)


def _step(model_key: str, hist: list[float], when: datetime) -> float:
    if model_key == "seasonal_naive":
        return hist[-24] if len(hist) >= 24 else hist[0]
    spec = _models[model_key]
    X = _feature_row(hist, when)
    if spec.get("needs_scaler"):
        X = _scaler.transform(X)
    return float(spec["estimator"].predict(X)[0])


def _iterative(model_key: str, recent: list[float], base: datetime, hrs: int) -> list[float]:
    hist = [float(x) for x in recent]
    out  = []
    for i in range(1, hrs + 1):
        pred = max(380.0, _step(model_key, hist, base + timedelta(hours=i)))
        hist.append(pred)
        out.append(round(pred, 1))
    return out


def _base_time(req: ForecastRequest) -> datetime:
    if req.last_timestamp:
        return datetime.fromisoformat(req.last_timestamp.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def info() -> dict:
    return {
        "best":   _best,
        "models": {k: {"label": v["label"], "metrics": v["metrics"]} for k, v in _models.items()},
        "meta":   _meta,
        "carbon": {"monitoring_vol_m3": MONITORING_VOL_M3, "ambient_ppm": AMBIENT_CO2_PPM,
                   "kg_per_ppm_hour": round(CO2_SCALE, 6)},
    }


def run_forecast(req: ForecastRequest) -> dict:
    """Best-model (GBR) forecast with confidence band + carbon."""
    if not req.recent_co2:
        raise ValueError("recent_co2 must contain at least one reading")
    hrs  = max(1, min(req.forecast_hours, 48))
    base = _base_time(req)
    preds = _iterative(_best, req.recent_co2, base, hrs)
    rmse  = _models[_best]["metrics"].get("rmse", 6.0)

    forecast = []
    for i, p in enumerate(preds, start=1):
        band = rmse * (1 + 0.04 * i)
        forecast.append({
            "hour_offset": i, "predicted_ppm": p,
            "lower_ppm": round(max(380.0, p - band), 1),
            "upper_ppm": round(p + band, 1),
            "carbon_kg_h": round(excess_kg_per_hour(p), 6),
        })
    total_kg = sum(f["carbon_kg_h"] for f in forecast)
    return {
        "success": True,
        "model_version": f"{_models[_best]['label']}-Kgotso-v2 "
                         f"(R2={_models[_best]['metrics'].get('r2')}, RMSE={_models[_best]['metrics'].get('rmse')} ppm)",
        "baseline_ppm": round(float(np.mean(req.recent_co2[-6:])), 1),
        "forecast_hours": hrs, "forecast": forecast,
        "carbon_summary": {
            "forecast_window_kg": round(total_kg, 4),
            "monthly_projection_tco2e": round(total_kg / hrs * 24 * 30 / 1000, 4),
            "monitoring_vol_m3": MONITORING_VOL_M3,
            "method": "GBR autoregressive forecast + Harare altitude carbon density",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def run_compare(req: ForecastRequest) -> dict:
    """All three models' forecasts over the same horizon + held-out metrics."""
    if not req.recent_co2:
        raise ValueError("recent_co2 must contain at least one reading")
    hrs  = max(1, min(req.forecast_hours, 48))
    base = _base_time(req)

    order = ["gbr", "ridge", "seasonal_naive"]
    models_out = []
    for key in order:
        if key not in _models:
            continue
        preds = _iterative(key, req.recent_co2, base, hrs)
        models_out.append({
            "key":      key,
            "label":    _models[key]["label"],
            "metrics":  _models[key]["metrics"],
            "is_best":  key == _best,
            "forecast": [{"hour_offset": i + 1, "predicted_ppm": p} for i, p in enumerate(preds)],
        })

    return {
        "success": True,
        "best": _best,
        "baseline_ppm": round(float(np.mean(req.recent_co2[-6:])), 1),
        "forecast_hours": hrs,
        "models": models_out,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/predict")
def predict(req: ForecastRequest):
    try:
        return run_forecast(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare")
def compare(req: ForecastRequest):
    try:
        return run_compare(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
