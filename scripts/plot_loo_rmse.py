#!/usr/bin/env python3
r"""
Figure 6.9 -- Cross-Facility LOO RMSE Comparison
==================================================
Runs real leave-one-out validation on harare_training_data.csv using
Random Forest and Gradient Boosting.

LOO protocol: train on 6 of 7 Harare facility archetypes, evaluate on
the held-out 7th. Repeat for each facility. Reports RMSE (kg CO2e).

Output:
  figures/fig6_9_loo_rmse.png  (300 dpi)
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_squared_error

# ── Feature engineering ───────────────────────────────────────────────────────

def build_features(df):
    d = df.copy()
    d["hour_sin"]          = np.sin(2 * np.pi * d["hour"] / 24)
    d["hour_cos"]          = np.cos(2 * np.pi * d["hour"] / 24)
    d["dow_sin"]           = np.sin(2 * np.pi * d["day_of_week"] / 7)
    d["dow_cos"]           = np.cos(2 * np.pi * d["day_of_week"] / 7)
    d["co2_ch4_ratio"]     = d["co2_ppm"] / (d["ch4_ppm"] + 0.1)
    d["temp_humidity_idx"] = d["temperature"] * d["humidity"] / 100
    d["energy_per_co2"]    = d["energy_kwh"] / (d["co2_ppm"] + 1)
    d["co2_excess"]        = np.maximum(0, d["co2_ppm"] - 420)
    d["ch4_excess"]        = np.maximum(0, d["ch4_ppm"] - 1.9)
    return d

def compute_target(df):
    CH4_GWP = 28; CH4_D = 0.657; CO2_D = 1.977; VOL = 100; GRID = 0.92
    ch4_e  = np.maximum(0, df["ch4_ppm"] - 1.9) / 1e6 * VOL * CH4_D * CH4_GWP
    co2_e  = np.maximum(0, df["co2_ppm"] - 420) / 1e6 * VOL * CO2_D
    enrg_e = df["energy_kwh"] * GRID
    return (ch4_e + co2_e + enrg_e).values

FEAT_COLS = [
    "co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh",
    "hour", "day_of_week", "is_weekend", "month", "is_rainy_season",
    "zesa_online", "dormant",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "co2_ch4_ratio", "temp_humidity_idx", "energy_per_co2",
    "co2_excess", "ch4_excess",
]

FAC_LABELS = {
    "FAC-MSM": "Msasa Metal\nWorks (C24)",
    "FAC-WFB": "Workington\nFood (C10)",
    "FAC-PWM": "Pomona\nLandfill (E38)",
    "FAC-RTC": "Ruwa Tobacco\nCuring (C12)",
    "FAC-GLF": "Goromonzi\nLivestock (A01)",
    "FAC-SLH": "Southerton\nLogistics (H49)",
    "FAC-CLM": "Chitungwiza\nPlastics (C22)",
}

# ── LOO computation ───────────────────────────────────────────────────────────

def run_loo(df_all, facilities):
    rf_rmse, gb_rmse = [], []
    for fac in facilities:
        tr = df_all[df_all["facility_id"] != fac]
        te = df_all[df_all["facility_id"] == fac]

        x_tr = tr[FEAT_COLS].values;  ytr = compute_target(tr)
        x_te = te[FEAT_COLS].values;  yte = compute_target(te)

        rf = RandomForestRegressor(n_estimators=100, max_depth=10,
                                   min_samples_leaf=2, n_jobs=-1, random_state=42)
        rf.fit(x_tr, ytr)
        rf_rmse.append(mean_squared_error(yte, rf.predict(x_te)) ** 0.5)

        gb = GradientBoostingRegressor(n_estimators=100, max_depth=5,
                                       learning_rate=0.1, random_state=42)
        gb.fit(x_tr, ytr)
        gb_rmse.append(mean_squared_error(yte, gb.predict(x_te)) ** 0.5)

        print(f"  LOO held-out {fac:<10}  RF={rf_rmse[-1]:.5f}  GB={gb_rmse[-1]:.5f}")

    return np.array(rf_rmse), np.array(gb_rmse)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("[Step 1/3] Loading harare_training_data.csv ...")
    df = pd.read_csv("scripts/harare_training_data.csv")
    df = build_features(df)
    facilities = sorted(df["facility_id"].unique())
    print(f"           {len(df):,} rows | {len(facilities)} facilities")

    print("[Step 2/3] Running LOO validation (7 folds × 2 models) ...")
    rf_rmse, gb_rmse = run_loo(df, facilities)

    # In-sample baselines from full training run
    insample_rf = 0.68026
    insample_gb = 0.31518

    # ── Table ──────────────────────────────────────────────────────────────────
    print("\nLOO RMSE summary (kg CO2e):")
    print(f"  {'Facility':<12} {'RF (LOO)':>10}  {'GB (LOO)':>10}  {'RF Delta':>10}  {'GB Delta':>10}")
    print(f"  {'-'*58}")
    for fac, r, g in zip(facilities, rf_rmse, gb_rmse):
        print(f"  {fac:<12} {r:>10.5f}  {g:>10.5f}  {r-insample_rf:>+10.5f}  {g-insample_gb:>+10.5f}")
    print(f"\n  In-sample: RF={insample_rf:.5f}  GB={insample_gb:.5f}")

    # ── Plot ───────────────────────────────────────────────────────────────────
    print("\n[Step 3/3] Plotting ...")
    labels = [FAC_LABELS.get(f, f) for f in facilities]

    fig, ax = plt.subplots(figsize=(13, 6))
    x     = np.arange(len(facilities))
    width = 0.35
    COLOR_RF = "#1f77b4"
    COLOR_GB = "#d62728"

    bars_rf = ax.bar(x - width / 2, rf_rmse, width, label="Random Forest (LOO)",
                     color=COLOR_RF, alpha=0.85, edgecolor="white", linewidth=0.6)
    bars_gb = ax.bar(x + width / 2, gb_rmse, width, label="Gradient Boosting (LOO)",
                     color=COLOR_GB, alpha=0.85, edgecolor="white", linewidth=0.6)

    ax.axhline(insample_rf, color=COLOR_RF, linestyle="--", linewidth=1.4,
               alpha=0.75, label=f"RF in-sample RMSE ({insample_rf:.3f} kg)")
    ax.axhline(insample_gb, color=COLOR_GB, linestyle="--", linewidth=1.4,
               alpha=0.75, label=f"GB in-sample RMSE ({insample_gb:.3f} kg)")

    fmt = ".3f"
    for bar in bars_rf:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(rf_rmse) * 0.015,
                f"{bar.get_height():{fmt}}", ha="center", va="bottom",
                fontsize=7.5, color=COLOR_RF)
    for bar in bars_gb:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(rf_rmse) * 0.015,
                f"{bar.get_height():{fmt}}", ha="center", va="bottom",
                fontsize=7.5, color=COLOR_GB)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("RMSE (kg CO₂e)", fontsize=11, labelpad=6)
    ax.set_xlabel("Held-out Facility Archetype", fontsize=11, labelpad=6)
    ax.set_title(
        "Figure 6.9 — Cross-Facility LOO RMSE Comparison\n"
        "Train on 6 Harare facility archetypes, evaluate on held-out 7th  |  RF vs Gradient Boosting",
        fontsize=12, pad=10)
    ax.set_ylim(0, max(rf_rmse.max(), gb_rmse.max()) * 1.25)
    ax.grid(axis="y", alpha=0.3, linestyle="--", zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(fontsize=9, loc="upper right", framealpha=0.92)

    plt.tight_layout()
    os.makedirs("figures", exist_ok=True)
    fig.savefig("figures/fig6_9_loo_rmse.png", dpi=300, bbox_inches="tight")
    print("[SAVED] figures/fig6_9_loo_rmse.png")


if __name__ == "__main__":
    main()
