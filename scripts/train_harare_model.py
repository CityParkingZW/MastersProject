#!/usr/bin/env python3
"""
Harare Carbon Emission Model - Training Pipeline
=================================================
Reads harare_training_data.csv, engineers features, trains
Random Forest + Gradient Boosting + Ridge, picks the best by R2,
and saves models/carbon_predictor_v1.joblib for Lambda deployment.

Usage:
    python scripts/train_harare_model.py
"""

import os
import sys
import json
import warnings
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")   # headless - no display needed
import matplotlib.pyplot as plt

from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

warnings.filterwarnings("ignore")

# -- Constants (must match Lambda function) ------------------------------------
ZESA_GRID_EF       = 0.92   # kg CO2e / kWh
CH4_GWP            = 28     # IPCC AR6
CO2_DENSITY        = 1.977  # kg/m3 at STP
CH4_DENSITY        = 0.657  # kg/m3 at STP
MONITORING_VOL_M3  = 100
RANDOM_STATE       = 42
TEST_SIZE          = 0.20

DATA_PATH   = "scripts/harare_training_data.csv"
OUTPUT_DIR  = "models"
MODEL_FILE  = os.path.join(OUTPUT_DIR, "carbon_predictor_v1.joblib")
META_FILE   = os.path.join(OUTPUT_DIR, "model_metadata.json")
PLOTS_DIR   = os.path.join(OUTPUT_DIR, "plots")


# -- Target: CO2-equivalent emissions (kg) per 5-min reading ------------------

def compute_target(df):
    """GHG Protocol calculation - becomes the y label."""
    # Methane fugitive (Scope 1)
    ch4_excess  = np.maximum(0, df["ch4_ppm"] - 1.9)
    ch4_mass_kg = (ch4_excess / 1e6) * MONITORING_VOL_M3 * CH4_DENSITY
    ch4_co2e    = ch4_mass_kg * CH4_GWP

    # Direct CO2 above background (Scope 1 stationary combustion)
    co2_excess   = np.maximum(0, df["co2_ppm"] - 420)
    co2_mass_kg  = (co2_excess / 1e6) * MONITORING_VOL_M3 * CO2_DENSITY

    # Energy / grid electricity (Scope 2)
    energy_co2e = df["energy_kwh"] * ZESA_GRID_EF

    return ch4_co2e + co2_mass_kg + energy_co2e


# -- Feature engineering -------------------------------------------------------

def engineer_features(df):
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Cyclical time encoding
    df["hour_sin"]   = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"]   = np.cos(2 * np.pi * df["hour"] / 24)
    df["dow_sin"]    = np.sin(2 * np.pi * df["day_of_week"] / 7)
    df["dow_cos"]    = np.cos(2 * np.pi * df["day_of_week"] / 7)
    df["month_sin"]  = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"]  = np.cos(2 * np.pi * df["month"] / 12)

    # Interaction features
    df["co2_ch4_ratio"]     = df["co2_ppm"]    / (df["ch4_ppm"] + 0.1)
    df["temp_humidity_idx"] = df["temperature"] * df["humidity"] / 100
    df["energy_per_co2"]    = df["energy_kwh"]  / (df["co2_ppm"] + 1)

    # Excess above background
    df["co2_excess"] = np.maximum(0, df["co2_ppm"] - 420)
    df["ch4_excess"] = np.maximum(0, df["ch4_ppm"] - 1.9)

    # Rolling stats per facility (avoid cross-facility leakage)
    for col in ["co2_ppm", "ch4_ppm", "energy_kwh", "temperature"]:
        df[f"{col}_roll5"]  = (df.groupby("facility_id")[col]
                                 .transform(lambda x: x.rolling(5,  min_periods=1).mean()))
        df[f"{col}_roll12"] = (df.groupby("facility_id")[col]
                                 .transform(lambda x: x.rolling(12, min_periods=1).mean()))
        df[f"{col}_diff"]   = (df.groupby("facility_id")[col]
                                 .transform(lambda x: x.diff().fillna(0)))

    # Lag features
    for lag in [1, 3, 6]:
        df[f"co2_lag{lag}"] = (df.groupby("facility_id")["co2_ppm"]
                                  .transform(lambda x: x.shift(lag).ffill()))
        df[f"ch4_lag{lag}"] = (df.groupby("facility_id")["ch4_ppm"]
                                  .transform(lambda x: x.shift(lag).ffill()))

    # One-hot encode facility (7 sites)
    fac_dummies = pd.get_dummies(df["facility_id"], prefix="fac", dtype=int)
    df = pd.concat([df, fac_dummies], axis=1)

    # ISIC sector numeric code
    isic_map = {"A01": 1, "C10": 3, "C12": 3, "C22": 3, "C24": 3, "E38": 5, "H49": 8}
    df["isic_num"] = df["isic_code"].map(isic_map).fillna(0).astype(int)

    return df


FEATURE_COLS_BASE = [
    "co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh",
    "hour", "day_of_week", "is_weekend", "month",
    "is_rainy_season", "zesa_online", "dormant",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
    "co2_ch4_ratio", "temp_humidity_idx", "energy_per_co2",
    "co2_excess", "ch4_excess",
    "co2_ppm_roll5",  "ch4_ppm_roll5",  "energy_kwh_roll5",
    "co2_ppm_roll12", "ch4_ppm_roll12",
    "co2_ppm_diff",   "ch4_ppm_diff",
    "co2_lag1", "ch4_lag1", "co2_lag3", "ch4_lag3",
    "isic_num",
]


def prepare_matrices(df):
    y = compute_target(df).values
    fac_cols  = [c for c in df.columns if c.startswith("fac_")]
    feat_cols = [c for c in FEATURE_COLS_BASE + fac_cols if c in df.columns]
    # Forward-fill then zero-fill any NaNs left by rolling/lag at group boundaries
    feature_df = df[feat_cols].ffill().fillna(0)
    X = feature_df.values
    return X, y, feat_cols


# -- Model training ------------------------------------------------------------

def train_all(X_tr, y_tr, X_te, y_te, feat_names):
    scaler = StandardScaler()
    Xtr_s  = scaler.fit_transform(X_tr)
    Xte_s  = scaler.transform(X_te)

    results = {}

    # 1 - Ridge (linear baseline)
    print("  [1/3] Ridge Regression ...")
    rr = Ridge(alpha=1.0)
    rr.fit(Xtr_s, y_tr)
    yp = rr.predict(Xte_s)
    results["ridge"] = {
        "model": rr, "needs_scaling": True,
        "r2":   float(r2_score(y_te, yp)),
        "rmse": float(np.sqrt(mean_squared_error(y_te, yp))),
        "mae":  float(mean_absolute_error(y_te, yp)),
        "y_pred": yp,
    }
    print(f"         R2 {results['ridge']['r2']:.4f}  RMSE {results['ridge']['rmse']:.5f}")

    # 2 - Random Forest
    print("  [2/3] Random Forest ...")
    rf = RandomForestRegressor(
        n_estimators=200, max_depth=14,
        min_samples_split=4, min_samples_leaf=2,
        n_jobs=-1, random_state=RANDOM_STATE,
    )
    rf.fit(X_tr, y_tr)
    yp = rf.predict(X_te)
    results["random_forest"] = {
        "model": rf, "needs_scaling": False,
        "r2":   float(r2_score(y_te, yp)),
        "rmse": float(np.sqrt(mean_squared_error(y_te, yp))),
        "mae":  float(mean_absolute_error(y_te, yp)),
        "y_pred": yp,
        "feature_importance": dict(zip(feat_names, rf.feature_importances_)),
    }
    print(f"         R2 {results['random_forest']['r2']:.4f}  RMSE {results['random_forest']['rmse']:.5f}")

    # 3 - Gradient Boosting
    print("  [3/3] Gradient Boosting ...")
    gb = GradientBoostingRegressor(
        n_estimators=200, max_depth=6, learning_rate=0.08,
        subsample=0.8, min_samples_split=4, random_state=RANDOM_STATE,
    )
    gb.fit(X_tr, y_tr)
    yp = gb.predict(X_te)
    results["gradient_boosting"] = {
        "model": gb, "needs_scaling": False,
        "r2":   float(r2_score(y_te, yp)),
        "rmse": float(np.sqrt(mean_squared_error(y_te, yp))),
        "mae":  float(mean_absolute_error(y_te, yp)),
        "y_pred": yp,
        "feature_importance": dict(zip(feat_names, gb.feature_importances_)),
    }
    print(f"         R2 {results['gradient_boosting']['r2']:.4f}  RMSE {results['gradient_boosting']['rmse']:.5f}")

    results["_scaler"] = scaler
    return results


# -- Plots ---------------------------------------------------------------------

def make_plots(y_te, results, best_name):
    os.makedirs(PLOTS_DIR, exist_ok=True)
    model_names  = [n for n in results if not n.startswith("_")]
    y_pred_best  = results[best_name]["y_pred"]

    # Actual vs Predicted
    plt.figure(figsize=(8, 6))
    plt.scatter(y_te, y_pred_best, alpha=0.3, s=6, c="#2563eb")
    lo, hi = y_te.min(), y_te.max()
    plt.plot([lo, hi], [lo, hi], "r--", lw=1.5, label="Perfect fit")
    plt.xlabel("Actual CO2e (kg)")
    plt.ylabel("Predicted CO2e (kg)")
    plt.title("Actual vs Predicted - " + best_name.replace("_", " ").title())
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "actual_vs_predicted.png"), dpi=150)
    plt.close()

    # Model comparison bar chart
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    labels = [n.replace("_", " ").title() for n in model_names]
    r2s    = [results[n]["r2"]   for n in model_names]
    rmses  = [results[n]["rmse"] for n in model_names]
    colors = ["#16a34a" if n == best_name else "#94a3b8" for n in model_names]

    axes[0].barh(labels, r2s,   color=colors)
    axes[0].set_xlabel("R2 Score")
    axes[0].set_title("R2 Score (higher = better)")
    axes[0].set_xlim(0, 1)
    axes[1].barh(labels, rmses, color=colors)
    axes[1].set_xlabel("RMSE (kg CO2e)")
    axes[1].set_title("RMSE (lower = better)")
    plt.suptitle("Harare Carbon Model - Model Comparison", fontsize=13, fontweight="bold")
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "model_comparison.png"), dpi=150)
    plt.close()

    # Feature importance
    if "feature_importance" in results[best_name]:
        imp  = results[best_name]["feature_importance"]
        top  = sorted(imp.items(), key=lambda x: x[1], reverse=True)[:18]
        names_fi = [t[0] for t in top]
        vals_fi  = [t[1] for t in top]
        plt.figure(figsize=(10, 7))
        plt.barh(names_fi, vals_fi, color="#0891b2")
        plt.gca().invert_yaxis()
        plt.xlabel("Importance")
        plt.title("Top Feature Importances - " + best_name.replace("_", " ").title())
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "feature_importance.png"), dpi=150)
        plt.close()

    # Residuals histogram
    residuals = y_te - y_pred_best
    plt.figure(figsize=(8, 5))
    plt.hist(residuals, bins=60, color="#7c3aed", edgecolor="white", alpha=0.8)
    plt.axvline(0, color="red", linestyle="--", lw=1.5)
    plt.xlabel("Residual (Actual - Predicted kg CO2e)")
    plt.ylabel("Count")
    plt.title("Residual Distribution")
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "residuals.png"), dpi=150)
    plt.close()

    print("  Plots saved to " + PLOTS_DIR + "/")


# -- Save ----------------------------------------------------------------------

def save_model(best_name, results, feat_cols):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    r = results[best_name]

    package = {
        "model":         r["model"],
        "scaler":        results["_scaler"] if r["needs_scaling"] else None,
        "needs_scaling": r["needs_scaling"],
        "feature_names": feat_cols,
        "model_type":    best_name,
        "metrics":       {"r2": r["r2"], "rmse": r["rmse"], "mae": r["mae"]},
        "emission_factors": {
            "grid_ef_zimbabwe":     ZESA_GRID_EF,
            "ch4_gwp":              CH4_GWP,
            "ch4_density":          CH4_DENSITY,
            "co2_density":          CO2_DENSITY,
            "monitoring_volume_m3": MONITORING_VOL_M3,
        },
        "created_at": datetime.utcnow().isoformat(),
        "version":    "v1",
        "training_notes": (
            "Trained on 7 Harare industrial facilities: Msasa Metal Works, "
            "Workington Food Processing, Pomona Waste, Ruwa Tobacco, "
            "Goromonzi Livestock, Southerton Logistics, Chitungwiza Plastics. "
            "60-day synthesised dataset with ZESA load-shedding, Harare altitude "
            "correction (1483 m), rainy/dry seasonal patterns."
        ),
    }

    joblib.dump(package, MODEL_FILE)

    meta = {k: v for k, v in package.items() if k not in ("model", "scaler")}
    with open(META_FILE, "w") as f:
        json.dump(meta, f, indent=2)

    print("  Model    -> " + MODEL_FILE)
    print("  Metadata -> " + META_FILE)


# -- Entry point ---------------------------------------------------------------

def main():
    print("=" * 62)
    print("  Harare Carbon Monitor - Model Training Pipeline")
    print("=" * 62)

    # 1. Load data
    if not os.path.exists(DATA_PATH):
        print("\n[ERROR] Training data not found at " + DATA_PATH)
        print("  Run: python scripts/harare_dataset_generator.py first")
        sys.exit(1)

    print("\n[1/5] Loading " + DATA_PATH + " ...")
    df_raw = pd.read_csv(DATA_PATH)
    print(f"       {len(df_raw):,} rows x {len(df_raw.columns)} cols")
    print(f"       Facilities : {df_raw['facility_id'].nunique()}")
    print(f"       Date range : {df_raw['timestamp'].min()[:10]}  to  {df_raw['timestamp'].max()[:10]}")

    # 2. Feature engineering
    print("\n[2/5] Engineering features ...")
    df = engineer_features(df_raw)
    X, y, feat_cols = prepare_matrices(df)
    print(f"       Feature matrix : {X.shape}")
    print(f"       Target range   : [{y.min():.5f}, {y.max():.4f}] kg CO2e")
    print(f"       Target mean    : {y.mean():.5f} kg CO2e per 5-min reading")

    # 3. Split
    print("\n[3/5] Splitting 80/20 ...")
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    print(f"       Train : {X_tr.shape[0]:,}   Test : {X_te.shape[0]:,}")

    # 4. Train
    print("\n[4/5] Training models ...")
    results = train_all(X_tr, y_tr, X_te, y_te, feat_cols)

    # Select best by R2
    model_names = [n for n in results if not n.startswith("_")]
    best_name   = max(model_names, key=lambda n: results[n]["r2"])
    best        = results[best_name]
    print("\n  Best model : " + best_name.replace("_", " ").title())
    print(f"    R2   = {best['r2']:.4f}")
    print(f"    RMSE = {best['rmse']:.5f} kg CO2e")
    print(f"    MAE  = {best['mae']:.5f} kg CO2e")

    # 5. Save + plots
    print("\n[5/5] Saving model and generating plots ...")
    save_model(best_name, results, feat_cols)
    make_plots(y_te, results, best_name)

    print("\n" + "=" * 62)
    print("  Training complete!")
    print("=" * 62)
    print("""
  Next steps:
    1. Upload to S3:
       aws s3 cp models/carbon_predictor_v1.joblib s3://carbon-monitor-models/models/

    2. The Next.js API route /api/predict will load this model
       and replace the client-side simulator predictions.
""")


if __name__ == "__main__":
    main()
