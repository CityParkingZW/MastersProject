#!/usr/bin/env python3
r"""
Figure 6.6 -- Model Performance Comparison (grouped bar chart)
Figure 6.7 -- CNN-LSTM Predicted vs Actual CO2 mg/m3 (scatter plot)

Metric values are taken directly from Table 6.4 (midpoints of reported
ranges used as bar heights; half-range used as error bars).

Usage:
  .venv\Scripts\python.exe scripts\plot_model_comparison.py
"""

import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D

PPM_TO_MG = 44.01 / 24.45
RANDOM_STATE = 42

# --------------------------------------------------------------------------
# Table 6.4 data  (low, high) per model per metric
# --------------------------------------------------------------------------

MODELS = ["Linear\nRegression", "Ridge\nRegression", "Random\nForest", "Gradient\nBoosting"]
MODEL_KEYS = ["lr", "ridge", "rf", "gb"]

COLORS = {
    "lr":    "#aec7e8",
    "ridge": "#98df8a",
    "rf":    "#ffbb78",
    "gb":    "#d62728",
}

# Real metrics from training on 120,960-record Harare corpus (target: kg CO2e)
METRICS = {
    "MAE (kg CO₂e)": {
        "lr":    (0.000, 0.000),
        "ridge": (0.001, 0.002),
        "rf":    (0.065, 0.090),
        "gb":    (0.120, 0.150),
        "lower_is_better": True,
    },
    "RMSE (kg CO₂e)": {
        "lr":    (0.000, 0.001),
        "ridge": (0.002, 0.006),
        "rf":    (0.600, 0.760),
        "gb":    (0.280, 0.370),
        "lower_is_better": True,
    },
    "MAPE (%)": {
        "lr":    (0.000, 0.001),
        "ridge": (0.020, 0.030),
        "rf":    (0.900, 1.050),
        "gb":    (1.150, 1.350),
        "lower_is_better": True,
    },
    "R² Score": {
        "lr":    (1.0000, 1.0000),
        "ridge": (0.9999, 1.0000),
        "rf":    (0.9998, 1.0000),
        "gb":    (0.9999, 1.0000),
        "lower_is_better": False,
    },
}


# ==========================================================================
# Figure 6.6 — Grouped bar chart (2 × 2 subplots, one per metric)
# ==========================================================================

def make_fig6_6(output_path: str) -> None:
    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    axes = axes.flatten()

    x     = np.arange(len(MODELS))
    width = 0.55

    for ax, (metric_name, data) in zip(axes, METRICS.items()):
        lwr_better = data["lower_is_better"]
        mids  = np.array([(data[k][0] + data[k][1]) / 2 for k in MODEL_KEYS])
        errs  = np.array([(data[k][1] - data[k][0]) / 2 for k in MODEL_KEYS])
        cols  = [COLORS[k] for k in MODEL_KEYS]

        bars = ax.bar(x, mids, width,
                      color=cols,
                      edgecolor="white",
                      linewidth=0.6,
                      yerr=errs,
                      capsize=4,
                      error_kw=dict(elinewidth=1.0, capthick=1.0, ecolor="#444444"),
                      zorder=3)

        # Value labels
        for bar, mid, err in zip(bars, mids, errs):
            fmt = ".2f" if metric_name == "R² Score" else ".1f"
            ax.text(bar.get_x() + bar.get_width() / 2,
                    mid + err + max(mids) * 0.02,
                    f"{mid:{fmt}}",
                    ha="center", va="bottom", fontsize=8.5, color="#333333")

        # Highlight best bar
        best_idx = int(np.argmin(mids) if lwr_better else np.argmax(mids))
        bars[best_idx].set_edgecolor("#333333")
        bars[best_idx].set_linewidth(1.8)

        ax.set_xticks(x)
        ax.set_xticklabels(MODELS, fontsize=9)
        ax.set_ylabel(metric_name, fontsize=10)
        ax.set_title(metric_name, fontsize=11, pad=6)

        # Y-axis: start just below minimum for clarity
        y_min = max(0, min(mids) - max(errs) - max(mids) * 0.12)
        y_max = max(mids) + max(errs) + max(mids) * 0.15
        ax.set_ylim(y_min, y_max)

        ax.grid(axis="y", alpha=0.3, linestyle="--", zorder=0)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

        arrow = "↓ lower is better" if lwr_better else "↑ higher is better"
        ax.text(0.98, 0.97, arrow, transform=ax.transAxes,
                ha="right", va="top", fontsize=7.5, color="#666666", style="italic")

    # Shared legend
    legend_items = [
        mpatches.Patch(facecolor=COLORS[k], edgecolor="white",
                       label=m.replace("\n", " "))
        for k, m in zip(MODEL_KEYS, MODELS)
    ]
    best_marker = mpatches.Patch(facecolor="none", edgecolor="#333333",
                                 linewidth=1.8, label="Best performer (bold border)")
    fig.legend(handles=legend_items + [best_marker],
               loc="lower center", ncol=5, fontsize=9,
               framealpha=0.9, bbox_to_anchor=(0.5, 0.01))

    fig.suptitle(
        "Figure 6.6 — Model Performance Comparison\n"
        "Grouped bars show midpoint of reported range; error bars show full range",
        fontsize=13, y=1.01)

    plt.tight_layout(rect=[0, 0.07, 1, 1])
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"[SAVED] {output_path}")


# ==========================================================================
# Figure 6.7 — CNN-LSTM Predicted vs Actual scatter plot
# ==========================================================================

FAC_COLORS = {
    "FAC-MSM": "#d62728",
    "FAC-WFB": "#ff7f0e",
    "FAC-PWM": "#1f77b4",
    "FAC-RTC": "#2ca02c",
    "FAC-GLF": "#9467bd",
    "FAC-SLH": "#8c564b",
    "FAC-CLM": "#e377c2",
}

FAC_LABELS = {
    "FAC-MSM": "Msasa Metal Works",
    "FAC-WFB": "Workington Food",
    "FAC-PWM": "Pomona Landfill",
    "FAC-RTC": "Ruwa Tobacco",
    "FAC-GLF": "Goromonzi Livestock",
    "FAC-SLH": "Southerton Logistics",
    "FAC-CLM": "Chitungwiza Plastics",
}


def load_real_predictions(n_sample: int = 3000):
    import pandas as pd
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler

    df = pd.read_csv("scripts/harare_training_data.csv")
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")

    df["hour_sin"]   = np.sin(2*np.pi*df["hour"]/24)
    df["hour_cos"]   = np.cos(2*np.pi*df["hour"]/24)
    df["co2_ch4_ratio"]     = df["co2_ppm"] / (df["ch4_ppm"] + 0.1)
    df["temp_humidity_idx"] = df["temperature"] * df["humidity"] / 100
    df["energy_per_co2"]    = df["energy_kwh"] / (df["co2_ppm"] + 1)
    df["co2_excess"] = np.maximum(0, df["co2_ppm"] - 420)
    df["ch4_excess"] = np.maximum(0, df["ch4_ppm"] - 1.9)

    CH4_GWP=28; CH4_D=0.657; CO2_D=1.977; VOL=100; GRID=0.92
    ch4_e = np.maximum(0,df["ch4_ppm"]-1.9)/1e6*VOL*CH4_D*CH4_GWP
    co2_e = np.maximum(0,df["co2_ppm"]-420)/1e6*VOL*CO2_D
    enrg_e= df["energy_kwh"]*GRID
    y = (ch4_e + co2_e + enrg_e).values

    feats = ["co2_ppm","ch4_ppm","temperature","humidity","energy_kwh",
             "hour","is_weekend","hour_sin","hour_cos",
             "co2_ch4_ratio","temp_humidity_idx","energy_per_co2",
             "co2_excess","ch4_excess"]
    X = df[feats].values
    fac_ids = df["facility_id"].values

    n = int(len(X)*0.8)
    sc = StandardScaler()
    sc.fit(X[:n])
    x_te = sc.transform(X[n:])
    ridge = Ridge(alpha=1.0)
    ridge.fit(sc.transform(X[:n]), y[:n])
    yp = ridge.predict(x_te)

    idx = np.random.default_rng(RANDOM_STATE).choice(len(yp), min(n_sample, len(yp)), replace=False)
    return y[n:][idx], yp[idx], fac_ids[n:][idx]


def make_fig6_7(output_path: str) -> None:
    actual, predicted, fac_labels = load_real_predictions()

    # Overall R2 and RMSE
    ss_res = np.sum((actual - predicted) ** 2)
    ss_tot = np.sum((actual - actual.mean()) ** 2)
    r2     = 1 - ss_res / ss_tot
    rmse   = np.sqrt(np.mean((actual - predicted) ** 2))
    mae    = np.mean(np.abs(actual - predicted))

    fig, ax = plt.subplots(figsize=(9, 8))

    # Scatter per facility
    fac_labels_arr = np.array(fac_labels)
    for fac, color in FAC_COLORS.items():
        mask = fac_labels_arr == fac
        if mask.sum() == 0:
            continue
        label = FAC_LABELS.get(fac, fac)
        ax.scatter(actual[mask], predicted[mask],
                   c=color, alpha=0.45, s=18, label=label,
                   edgecolors="none", zorder=3)

    # 45-degree perfect prediction line
    all_vals = np.concatenate([actual, predicted])
    vmin, vmax = all_vals.min() * 0.97, all_vals.max() * 1.03
    ax.plot([vmin, vmax], [vmin, vmax],
            "k--", linewidth=1.4, label="Perfect prediction (45°)", zorder=4)

    # ±10% bands
    ax.plot([vmin, vmax], [vmin * 1.10, vmax * 1.10],
            color="grey", linewidth=0.7, linestyle=":", alpha=0.6, zorder=2)
    ax.plot([vmin, vmax], [vmin * 0.90, vmax * 0.90],
            color="grey", linewidth=0.7, linestyle=":", alpha=0.6,
            label="±10% band", zorder=2)

    ax.set_xlim(vmin, vmax)
    ax.set_ylim(vmin, vmax)
    ax.set_aspect("equal", adjustable="box")

    ax.set_xlabel("Actual CO₂e Emissions (kg)", fontsize=12, labelpad=6)
    ax.set_ylabel("Predicted CO₂e Emissions (kg)", fontsize=12, labelpad=6)
    ax.set_title(
        "Figure 6.7 — Ridge Regression: Predicted vs Actual CO₂e (kg)\n"
        "Test set (24,192 records)  |  coloured by facility",
        fontsize=12, pad=10)

    # Metrics annotation box
    stats_text = (
        f"R²  = {r2:.4f}\n"
        f"RMSE = {rmse:.2f} mg/m³\n"
        f"MAE  = {mae:.2f} mg/m³\n"
        f"n    = {len(actual):,}"
    )
    ax.text(0.04, 0.96, stats_text,
            transform=ax.transAxes,
            va="top", ha="left", fontsize=9.5,
            bbox=dict(boxstyle="round,pad=0.5", facecolor="white",
                      edgecolor="#cccccc", alpha=0.92),
            family="monospace")

    ax.legend(fontsize=9, loc="lower right", framealpha=0.92,
              markerscale=1.6, title="Facility", title_fontsize=9)
    ax.grid(alpha=0.25, linestyle="--", zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"[SAVED] {output_path}")
    print(f"        Overall R2={r2:.4f}  RMSE={rmse:.2f}  MAE={mae:.2f}")


# --------------------------------------------------------------------------

def main():
    print("Generating Figure 6.6 ...")
    make_fig6_6("figures/fig6_6_model_comparison.png")

    print("Generating Figure 6.7 ...")
    make_fig6_7("figures/fig6_7_cnn_lstm_scatter.png")

    print("\nDone. Both figures written to figures/")


if __name__ == "__main__":
    main()
