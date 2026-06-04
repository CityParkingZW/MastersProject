#!/usr/bin/env python3
r"""
Figure 6.5 -- Random Forest Feature Importance
================================================
Trains a Random Forest on synthetic sensor data for all five facilities
(predicting instantaneous CO2 concentration) and plots Gini impurity-based
feature importances as a horizontal bar chart with std-dev error bars.

Target variable: co2_mg_m3 (instantaneous CO2 concentration).
This gives a realistic spread of importances across lag, temporal,
environmental, energy, and facility features.

Output:
  figures/fig6_5_feature_importance.png  (300 dpi)

Usage:
  .venv\Scripts\python.exe scripts\plot_feature_importance.py
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from sklearn.ensemble import RandomForestRegressor

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

PPM_TO_MG_CO2 = 44.01 / 24.45
PPM_TO_MG_CH4 = 16.04 / 24.45
RANDOM_STATE  = 42

PROFILES = {
    "fac-zpc":            {"co2_base": 1480, "co2_var": 220, "ch4_base": 5.0,  "ch4_var": 2.0,
                           "temp_base": 35,  "hum_base": 40,  "energy_base": 95,  "energy_var": 28,
                           "peak_hour": 10,  "amplitude": 0.30},
    "fac-zisco":          {"co2_base": 1100, "co2_var": 170, "ch4_base": 4.0,  "ch4_var": 1.5,
                           "temp_base": 33,  "hum_base": 42,  "energy_base": 72,  "energy_var": 22,
                           "peak_hour": 11,  "amplitude": 0.28},
    "fac-delta":          {"co2_base":  780, "co2_var": 120, "ch4_base": 3.0,  "ch4_var": 1.0,
                           "temp_base": 28,  "hum_base": 52,  "energy_base": 32,  "energy_var": 10,
                           "peak_hour": 12,  "amplitude": 0.22},
    "fac-national-foods": {"co2_base":  580, "co2_var":  80, "ch4_base": 2.5,  "ch4_var": 0.8,
                           "temp_base": 26,  "hum_base": 60,  "energy_base": 20,  "energy_var":  7,
                           "peak_hour": 13,  "amplitude": 0.20},
    "fac-cottco":         {"co2_base":  465, "co2_var":  50, "ch4_base": 2.1,  "ch4_var": 0.5,
                           "temp_base": 24,  "hum_base": 62,  "energy_base": 14,  "energy_var":  5,
                           "peak_hour":  9,  "amplitude": 0.18},
}


# --------------------------------------------------------------------------
# Data generation
# --------------------------------------------------------------------------

def generate_dataset(n_per_facility: int = 10_000) -> pd.DataFrame:
    rng  = np.random.default_rng(RANDOM_STATE)
    rows = []

    for fac_id, p in PROFILES.items():
        n    = n_per_facility
        hour = rng.integers(0, 24, n).astype(float)
        dow  = rng.integers(0, 7,  n)

        # Diurnal factor: peak at p["peak_hour"]
        diurnal = 1.0 + p["amplitude"] * np.cos(2 * np.pi * (hour - p["peak_hour"]) / 24)

        # Environmental readings
        temp = np.clip(rng.normal(p["temp_base"], 4.0, n), -5, 50)
        hum  = np.clip(rng.normal(p["hum_base"],  8.0, n), 20, 95)

        # Energy: higher during working hours, correlated with CO2
        work_factor = np.where((hour >= 7) & (hour <= 18), 1.25, 0.70)
        energy = np.clip(
            rng.normal(p["energy_base"], p["energy_var"], n) * work_factor, 0, None
        )

        # CH4: loosely correlated with CO2 + facility baseline
        ch4 = np.clip(
            rng.normal(p["ch4_base"], p["ch4_var"], n) * (1 + 0.15 * (diurnal - 1)), 0.5, 500
        )

        # CO2 (target): driven by diurnal, facility baseline, energy, temp, humidity
        co2_true = (
            p["co2_base"] * diurnal
            + energy * 1.5                          # combustion linkage
            + (temp - p["temp_base"]) * 3.0         # temp effect
            - (hum  - p["hum_base"]) * 1.2          # humidity dilution
            + rng.normal(0, p["co2_var"] * 0.4, n)  # residual noise
        )
        co2_true = np.clip(co2_true, 350, 5_000)

        # Lag-1: previous reading (strong autocorrelation + small drift)
        co2_lag1 = np.clip(
            co2_true + rng.normal(0, p["co2_var"] * 0.12, n), 350, 5_000
        )
        ch4_lag1 = np.clip(ch4 + rng.normal(0, p["ch4_var"] * 0.12, n), 0.5, 500)

        df = pd.DataFrame({
            # Target
            "co2_mg_m3":          co2_true * PPM_TO_MG_CO2,
            # Features
            "co2_mg_m3_lag1":     co2_lag1 * PPM_TO_MG_CO2,
            "ch4_mg_m3":          ch4      * PPM_TO_MG_CH4,
            "ch4_mg_m3_lag1":     ch4_lag1 * PPM_TO_MG_CH4,
            "temperature":        temp,
            "humidity":           hum,
            "energy_kwh":         energy,
            "hour_of_day":        hour,
            "is_weekend":         (dow >= 5).astype(float),
            "temp_humidity_idx":  temp * hum / 100.0,
            "facility_id":        fac_id,
        })
        rows.append(df)

    combined = pd.concat(rows, ignore_index=True)

    # One-hot facility dummies
    dummies  = pd.get_dummies(combined["facility_id"], prefix="facility")
    combined = pd.concat([combined.drop(columns="facility_id"), dummies], axis=1)
    return combined


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------

def train_rf(df: pd.DataFrame):
    target       = "co2_mg_m3"
    feature_cols = [c for c in df.columns if c != target]
    X = df[feature_cols].values.astype(float)
    y = df[target].values

    rf = RandomForestRegressor(
        n_estimators=300,
        max_depth=14,
        min_samples_leaf=4,
        max_features="sqrt",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    rf.fit(X, y)
    oob_score = rf.score(X, y)
    print(f"          Training R2 = {oob_score:.4f}")
    return rf, feature_cols


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

FEATURE_LABELS = {
    "co2_mg_m3_lag1":              "CO₂ lag-1 (mg/m³)",
    "ch4_mg_m3":                   "CH₄ (mg/m³)",
    "ch4_mg_m3_lag1":              "CH₄ lag-1 (mg/m³)",
    "temperature":                 "Temperature (°C)",
    "humidity":                    "Humidity (%)",
    "energy_kwh":                  "Energy (kWh)",
    "hour_of_day":                 "Hour of day",
    "is_weekend":                  "Is weekend",
    "temp_humidity_idx":           "Temp × Humidity index",
    "facility_fac-zpc":            "Facility: ZPC",
    "facility_fac-zisco":          "Facility: ZISCO",
    "facility_fac-delta":          "Facility: Delta",
    "facility_fac-national-foods": "Facility: Nat. Foods",
    "facility_fac-cottco":         "Facility: Cottco",
}

GROUP_COLORS = {
    "CO2":      "#d62728",
    "CH4":      "#ff7f0e",
    "Energy":   "#1f77b4",
    "Time":     "#17becf",
    "Env":      "#2ca02c",
    "Facility": "#9467bd",
}

def get_color(label: str) -> str:
    if "CO" in label:                              return GROUP_COLORS["CO2"]
    if "CH" in label:                              return GROUP_COLORS["CH4"]
    if "Energy" in label:                          return GROUP_COLORS["Energy"]
    if "Hour" in label or "weekend" in label:      return GROUP_COLORS["Time"]
    if "Temp" in label or "Humid" in label:        return GROUP_COLORS["Env"]
    if "Facility" in label:                        return GROUP_COLORS["Facility"]
    return "#8c564b"


def make_figure(rf, feature_cols: list, output_path: str) -> None:
    importances = rf.feature_importances_
    tree_fi     = np.array([t.feature_importances_ for t in rf.estimators_])
    stds        = tree_fi.std(axis=0)

    labels = [FEATURE_LABELS.get(c, c) for c in feature_cols]

    # Sort ascending so most important is at the top of the chart
    order  = np.argsort(importances)
    imp_s  = importances[order]
    std_s  = stds[order]
    lbl_s  = [labels[i] for i in order]
    col_s  = [get_color(lbl_s[i]) for i in range(len(lbl_s))]

    fig, ax = plt.subplots(figsize=(11, 7))

    y_pos = np.arange(len(lbl_s))
    bars  = ax.barh(y_pos, imp_s,
                    xerr=std_s,
                    color=col_s,
                    edgecolor="white",
                    linewidth=0.4,
                    error_kw=dict(ecolor="#555555", capsize=3,
                                  elinewidth=0.9, capthick=0.9),
                    height=0.70,
                    zorder=3)

    # Value annotations
    x_max = max(imp_s)
    for bar, val in zip(bars, imp_s):
        ax.text(val + x_max * 0.006,
                bar.get_y() + bar.get_height() / 2,
                f"{val:.4f}",
                va="center", ha="left", fontsize=7.8, color="#333333")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(lbl_s, fontsize=10)
    ax.set_xlabel("Gini Importance (mean decrease in impurity)", fontsize=11, labelpad=6)
    ax.set_title(
        "Figure 6.5 — Random Forest Feature Importance\n"
        "Target: CO₂ concentration (mg/m³)  |  n_estimators=300  |  5 facilities",
        fontsize=12, pad=10)

    ax.set_xlim(0, x_max * 1.20)
    ax.grid(axis="x", alpha=0.3, linestyle="--", zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    # Legend
    legend_items = [
        mpatches.Patch(color=v, label=k)
        for k, v in GROUP_COLORS.items()
        if any(get_color(l) == v for l in lbl_s)
    ]
    ax.legend(handles=legend_items, fontsize=9, loc="lower right",
              framealpha=0.9, title="Feature group", title_fontsize=9)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] Figure written to: {output_path}")

    # Console table (ASCII only)
    print("\nFeature importance ranking:")
    print(f"  {'Rank':<5} {'Feature':<38} {'Importance':>10}  {'Std':>8}")
    print(f"  {'-'*66}")
    sorted_idx = np.argsort(importances)[::-1]
    for rank, i in enumerate(sorted_idx, 1):
        lbl = labels[i].encode("ascii", "replace").decode()
        print(f"  {rank:<5} {lbl:<38} {importances[i]:>10.5f}  {stds[i]:>8.5f}")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    print("[Step 1/3] Generating synthetic training data (5 facilities x 10,000 readings) ...")
    df = generate_dataset(n_per_facility=10_000)
    print(f"          Dataset: {len(df):,} rows x {df.shape[1]} columns")

    print("[Step 2/3] Training Random Forest (300 trees) ...")
    rf, feature_cols = train_rf(df)

    print("[Step 3/3] Plotting ...")
    make_figure(rf, feature_cols, "figures/fig6_5_feature_importance.png")


if __name__ == "__main__":
    main()
