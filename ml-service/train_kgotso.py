"""
Train the Kgotso ClimateHealth CO2 forecast model
===================================================
Autoregressive hourly CO2 (ppm) forecaster for the Harare monitoring station.

Target   : co2_ppm at hour t
Features : recent lags (1h, 2h, 3h, 24h) + diurnal/seasonal calendar encodings
           (no future weather needed → forecasts iteratively, fully deployable)

Compares Ridge vs Gradient Boosting on a time-ordered hold-out split and saves
the better model to kgotso_co2_model.joblib in the package structure that
main.py loads: {model, scaler, feature_names, metrics, meta}.

Usage:
    python train_kgotso.py [path/to/dataset.csv]
Defaults to ../scripts/kgotso-dataset.csv
"""

import os
import sys
import math
import json

import numpy as np
import pandas as pd
import joblib

from sklearn.linear_model import Ridge
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "scripts", "kgotso-dataset.csv")
OUT_PATH = os.path.join(HERE, "kgotso_co2_model.joblib")

RAINY_MONTHS = {11, 12, 1, 2, 3}

# Lag windows (hours) and max gap tolerance for a sample to be valid
LAGS = [1, 2, 3, 24]
ROLLS = [3, 6]

FEATURE_NAMES = [
    "lag_1", "lag_2", "lag_3", "lag_24",
    "roll_3", "roll_6",
    "hour_sin", "hour_cos",
    "month_sin", "month_cos",
    "dow_sin", "dow_cos",
    "is_rainy_season",
]


def log(step, msg):
    print(f"[{step}] {msg}", flush=True)


# ── 1. Load & parse ───────────────────────────────────────────────────────────
log("load", f"Reading {CSV_PATH}")
df = pd.read_csv(CSV_PATH)
df.columns = [c.strip() for c in df.columns]

# Parse "M/D/YYYY H:MM" (Africa/Harare local time)
df["ts"] = pd.to_datetime(df["Datetime_start"], format="%m/%d/%Y %H:%M", errors="coerce")
df = df.dropna(subset=["ts"]).sort_values("ts").reset_index(drop=True)

df = df.rename(columns={
    "CO2 (ppm)": "co2",
    "Temperature (Celsius)": "temp",
    "Humidity (%)": "humidity",
})
df = df[["ts", "co2", "temp", "humidity"]].dropna()
df["co2"] = df["co2"].astype(float)

log("load", f"{len(df)} valid rows, {df['ts'].min()} → {df['ts'].max()}")

# ── 2. Build a complete hourly index, mark real vs filled ──────────────────────
# Reindex to continuous hourly grid so lag math is well-defined.
full_idx = pd.date_range(df["ts"].min(), df["ts"].max(), freq="h")
s = df.set_index("ts").reindex(full_idx)
s["is_real"] = s["co2"].notna()

# Interpolate ONLY short gaps (<= 3 h); leave long gaps NaN so we don't invent data
co2_interp = s["co2"].interpolate(limit=3, limit_area="inside")
s["co2_filled"] = co2_interp
gap_filled = int(s["co2_filled"].notna().sum() - s["is_real"].sum())
log("grid", f"Hourly grid: {len(s)} slots | real {int(s['is_real'].sum())} | "
            f"short-gap filled {gap_filled} | long-gap NaN {int(s['co2_filled'].isna().sum())}")

# ── 3. Feature engineering ─────────────────────────────────────────────────────
log("features", "Building lag + calendar features")
co2 = s["co2_filled"]

for L in LAGS:
    s[f"lag_{L}"] = co2.shift(L)
s["roll_3"] = co2.shift(1).rolling(3).mean()
s["roll_6"] = co2.shift(1).rolling(6).mean()

hour  = s.index.hour
month = s.index.month
dow   = s.index.dayofweek
s["hour_sin"]  = np.sin(2 * np.pi * hour / 24)
s["hour_cos"]  = np.cos(2 * np.pi * hour / 24)
s["month_sin"] = np.sin(2 * np.pi * month / 12)
s["month_cos"] = np.cos(2 * np.pi * month / 12)
s["dow_sin"]   = np.sin(2 * np.pi * dow / 7)
s["dow_cos"]   = np.cos(2 * np.pi * dow / 7)
s["is_rainy_season"] = month.isin(RAINY_MONTHS).astype(float)

s["target"] = co2  # predict current-hour CO2 from its lags

# Keep only rows where target is REAL (don't train on invented targets) and all features present
model_df = s[s["is_real"]].dropna(subset=FEATURE_NAMES + ["target"])
log("features", f"{len(model_df)} usable training samples after lag/NaN filtering")

X = model_df[FEATURE_NAMES].values
y = model_df["target"].values

# ── 4. Time-ordered split (no shuffling — respect chronology) ──────────────────
split = int(len(X) * 0.8)
X_train, X_test = X[:split], X[split:]
y_train, y_test = y[:split], y[split:]
log("split", f"train {len(X_train)} | test {len(X_test)} (last 20% held out)")

scaler = StandardScaler().fit(X_train)
X_train_s = scaler.transform(X_train)
X_test_s  = scaler.transform(X_test)

# ── 5. Train & compare two models ──────────────────────────────────────────────
def evaluate(name, model, Xtr, Xte):
    model.fit(Xtr, y_train)
    pred = model.predict(Xte)
    rmse = math.sqrt(mean_squared_error(y_test, pred))
    mae  = mean_absolute_error(y_test, pred)
    r2   = r2_score(y_test, pred)
    log("train", f"{name:18s} R2={r2:.4f}  RMSE={rmse:6.2f} ppm  MAE={mae:6.2f} ppm")
    return {"model": model, "r2": r2, "rmse": rmse, "mae": mae, "name": name}

log("train", "Fitting candidate models…")
ridge = evaluate("Ridge", Ridge(alpha=1.0), X_train_s, X_test_s)
# Gradient boosting is tree-based → use unscaled features
gbr   = evaluate("GradientBoosting",
                 GradientBoostingRegressor(n_estimators=300, max_depth=3,
                                           learning_rate=0.05, subsample=0.9,
                                           random_state=42),
                 X_train, X_test)

# ── 5c. Seasonal-Naïve (24 h) baseline: prediction = value 24 h earlier ────────
lag24_idx = FEATURE_NAMES.index("lag_24")
naive_pred = X_test[:, lag24_idx]
naive = {
    "name": "Seasonal-Naive",
    "r2":   r2_score(y_test, naive_pred),
    "rmse": math.sqrt(mean_squared_error(y_test, naive_pred)),
    "mae":  mean_absolute_error(y_test, naive_pred),
}
log("train", f"{'Seasonal-Naive':18s} R2={naive['r2']:.4f}  RMSE={naive['rmse']:6.2f} ppm  MAE={naive['mae']:6.2f} ppm")

best = min([ridge, gbr], key=lambda m: m["rmse"])
log("select", f"Best model: {best['name']} (RMSE {best['rmse']:.2f} ppm)")

# ── 6. Feature importance (best model) ─────────────────────────────────────────
importances = dict(zip(FEATURE_NAMES, [round(float(c), 4) for c in gbr["model"].feature_importances_]))
log("explain", "GradientBoosting feature importances:")
for f, v in sorted(importances.items(), key=lambda kv: -abs(kv[1])):
    print(f"         {f:18s} {v:+.4f}")

def _m(d):
    return {"r2": round(d["r2"], 4), "rmse": round(d["rmse"], 4), "mae": round(d["mae"], 4)}

# ── 7. Persist ALL models for comparison ───────────────────────────────────────
package = {
    "feature_names": FEATURE_NAMES,
    "scaler":        scaler,
    "best":          "gbr",
    "models": {
        "gbr":   {"estimator": gbr["model"],   "needs_scaler": False, "label": "Gradient Boosting",   "metrics": _m(gbr)},
        "ridge": {"estimator": ridge["model"], "needs_scaler": True,  "label": "Ridge Regression",    "metrics": _m(ridge)},
        "seasonal_naive": {"estimator": None,  "needs_scaler": False, "label": "Seasonal-Naive (24h)", "metrics": _m(naive)},
    },
    # Back-compat: keep top-level single-model keys (best = GBR) for older callers
    "model":         gbr["model"],
    "needs_scaler":  False,
    "metrics":       {**_m(gbr), "model_type": "GradientBoosting"},
    "meta": {
        "target":        "co2_ppm (hour t)",
        "lags":          LAGS,
        "rolls":         ROLLS,
        "rainy_months":  sorted(RAINY_MONTHS),
        "n_train":       len(X_train),
        "n_test":        len(X_test),
        "date_range":    [str(df["ts"].min()), str(df["ts"].max())],
        "location":      "Africa/Harare",
        "source_id":     "ixxkut7za9s",
        "sklearn":       __import__("sklearn").__version__,
        "numpy":         np.__version__,
    },
}
joblib.dump(package, OUT_PATH)
log("save", f"Wrote {OUT_PATH}")
log("save", f"sklearn {package['meta']['sklearn']} | numpy {package['meta']['numpy']}")
print("\nMETRICS_JSON " + json.dumps({k: v["metrics"] for k, v in package["models"].items()}))
