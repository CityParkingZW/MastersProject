"""
Harare ML Service — unified app serving TWO models
====================================================
One FastAPI deployment, two independent models mounted as routers:

  /industrial/predict   legacy ZCMA Ridge model  (CO2e kg from industrial sensors)
  /kgotso/predict        Kgotso GBR CO2 forecaster (hourly ppm forecast + carbon)
  /predict               alias → /kgotso/predict  (backward compatibility)
  /                       health + metrics for both models

Both joblib models load at startup. Keeping them in one service means a single
Render web service and URL serves the old and new project versions at once.
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import model_industrial
import model_kgotso

app = FastAPI(title="Harare ML Service", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(model_industrial.router)
app.include_router(model_kgotso.router)


# ── Backward-compatible alias: /predict → kgotso forecast ──────────────────────
@app.post("/predict")
def predict_alias(req: model_kgotso.ForecastRequest):
    return model_kgotso.predict(req)


@app.get("/")
def health():
    return {
        "status":  "ok",
        "service": "Harare ML Service (dual-model)",
        "models": {
            "industrial": model_industrial.info(),
            "kgotso":     model_kgotso.info(),
        },
        "routes": {
            "industrial_predict": "/industrial/predict",
            "kgotso_predict":     "/kgotso/predict",
            "alias":              "/predict (→ kgotso)",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
