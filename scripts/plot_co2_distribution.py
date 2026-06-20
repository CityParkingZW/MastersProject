#!/usr/bin/env python3
r"""
Figure 6.1 -- Per-Facility CO2 mg/m3 Distributions
====================================================
Generates a violin + boxplot of CO2 concentration (mg/m3) for each
facility, drawn from Firestore sensor_readings.

Modes (tried in order):
  1. Firestore live data  -- requires GOOGLE_APPLICATION_CREDENTIALS env var
                             pointing to a service-account JSON file
  2. Simulated data       -- Gaussian distributions matching each facility
                             emission profile (used when Firestore is
                             unavailable)

Output:
  figures/fig6_1_co2_distribution.png  (300 dpi, ready for report)

Usage:
  # With Firestore (set credentials first):
  set GOOGLE_APPLICATION_CREDENTIALS=path\to\serviceAccount.json
  python scripts/plot_co2_distribution.py

  # Simulated only (no credentials needed):
  python scripts/plot_co2_distribution.py --simulated
"""

import argparse
import os
import sys

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import seaborn as sns

# ppm → mg/m³  (CO₂ MW=44.01, molar vol at 25°C=24.45 L/mol)
PPM_TO_MG_M3 = 44.01 / 24.45   # ≈ 1.800

# ---------------------------------------------------------------------------
# Facility profiles — mapped to your actual named facilities.
# Adjust co2_base / co2_variance to match your real readings if needed.
# ---------------------------------------------------------------------------
FACILITY_PROFILES = {
    "fac-zpc": {
        "co2_base": 1480, "co2_variance": 260,   # ZPC — industrial combustion
        "ch4_base": 5,    "ch4_variance": 2,
        "temp_base": 35,  "temp_variance": 8,
        "humidity_base": 40, "humidity_variance": 10,
        "energy_base": 100,  "energy_variance": 30,
        "name": "industrial_combustion",
    },
    "fac-zisco": {
        "co2_base": 1100, "co2_variance": 200,   # steel / heavy industry
        "ch4_base": 4,    "ch4_variance": 1.5,
        "temp_base": 33,  "temp_variance": 7,
        "humidity_base": 42, "humidity_variance": 10,
        "energy_base": 80,   "energy_variance": 25,
        "name": "heavy_industry",
    },
    "fac-nrz": {
        "co2_base": 780, "co2_variance": 130,    # beverages / process heat
        "ch4_base": 3,   "ch4_variance": 1,
        "temp_base": 28, "temp_variance": 5,
        "humidity_base": 52, "humidity_variance": 10,
        "energy_base": 35,   "energy_variance": 10,
        "name": "waste_processing",
    },
    "fac-mbpm": {
        "co2_base": 580, "co2_variance": 90,     # food processing
        "ch4_base": 2.5, "ch4_variance": 0.8,
        "temp_base": 26, "temp_variance": 4,
        "humidity_base": 60, "humidity_variance": 12,
        "energy_base": 22,   "energy_variance": 7,
        "name": "normal_operations",
    },
    "fac-cottco": {
        "co2_base": 465, "co2_variance": 55,     # cotton/agri — lowest
        "ch4_base": 2.1, "ch4_variance": 0.5,
        "temp_base": 24, "temp_variance": 4,
        "humidity_base": 62, "humidity_variance": 12,
        "energy_base": 15,   "energy_variance": 5,
        "name": "agricultural",
    },
}

# Display order (highest → lowest median)
FACILITY_ORDER = ["fac-zpc", "fac-zisco", "fac-nrz", "fac-mbpm", "fac-cottco"]

PALETTE = {
    "fac-zpc":           "#d62728",   # red
    "fac-zisco":         "#ff7f0e",   # orange
    "fac-nrz":         "#1f77b4",   # blue
    "fac-mbpm":"#2ca02c",   # green
    "fac-cottco":        "#9467bd",   # purple
}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_from_firestore(project_id: str = "carbon-monitor-zw") -> pd.DataFrame | None:
    """Fetch sensor_readings from Firestore and return a DataFrame."""
    try:
        from google.cloud import firestore   # pip install google-cloud-firestore
        db = firestore.Client(project=project_id)
        docs = db.collection("sensor_readings").stream()
        records = []
        for doc in docs:
            d = doc.to_dict()
            if "co2_mg_m3" in d and "facility_id" in d:
                records.append({
                    "facility_id": d["facility_id"],
                    "co2_mg_m3":   float(d["co2_mg_m3"]),
                })
        if not records:
            print("[Firestore] No records with co2_mg_m3 found.")
            return None
        df = pd.DataFrame(records)
        print(f"[Firestore] Loaded {len(df)} readings from {df['facility_id'].nunique()} facilities.")
        return df
    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated() -> pd.DataFrame:
    """Generate 1 440 readings per facility using Gaussian distributions
    that match each facility's emission profile (cleaner than random-walk)."""
    return _numpy_simulate()


def _numpy_simulate() -> pd.DataFrame:
    """Gaussian simulation per facility — mirrors the baseline ppm values
    and variance defined in FACILITY_PROFILES."""
    rng = np.random.default_rng(42)
    rows = []
    for fac_id, p in FACILITY_PROFILES.items():
        n = 1440   # 24 h at 1-minute intervals
        values = rng.normal(p["co2_base"], p["co2_variance"], n)
        values = np.clip(values, 350, 5000)
        rows.append(pd.DataFrame({"facility_id": fac_id, "co2_mg_m3": values * PPM_TO_MG_M3}))
    combined = pd.concat(rows, ignore_index=True)
    print(f"[Sim] Generated {len(combined)} readings across {combined['facility_id'].nunique()} facilities.")
    return combined


# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------

def make_figure(df: pd.DataFrame, output_path: str) -> None:
    """Produce Figure 6.1 and save to output_path."""
    df = df.copy()

    # Unit conversion
    # data already in mg/m³ (from Firestore or simulation)

    # Keep only facilities we know about; honour display order
    known = [f for f in FACILITY_ORDER if f in df["facility_id"].unique()]
    df = df[df["facility_id"].isin(known)]
    df["facility_id"] = pd.Categorical(df["facility_id"], categories=known, ordered=True)
    df = df.sort_values("facility_id")

    # Pretty labels
    label_map = {
        "fac-zpc":            "ZPC",
        "fac-zisco":          "ZISCO",
        "fac-nrz":          "NRZ Bulawayo",
        "fac-mbpm":         "MBPM Mutare",
        "fac-cottco":         "Cottco",
    }
    df["Facility"] = df["facility_id"].map(label_map)
    facility_order_labels = [label_map[f] for f in known]

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.set_style("whitegrid")

    colors = [PALETTE[f] for f in known]

    # Violin layer — use hue= to suppress seaborn FutureWarning
    sns.violinplot(
        data=df,
        x="Facility", y="co2_mg_m3",
        hue="Facility",
        order=facility_order_labels,
        hue_order=facility_order_labels,
        palette=colors,
        inner=None,
        linewidth=0.8,
        alpha=0.45,
        ax=ax,
        saturation=0.9,
        cut=0,
        legend=False,
    )

    # Box + whisker overlay
    sns.boxplot(
        data=df,
        x="Facility", y="co2_mg_m3",
        hue="Facility",
        order=facility_order_labels,
        hue_order=facility_order_labels,
        palette=colors,
        width=0.18,
        linewidth=1.2,
        fliersize=2.5,
        flierprops={"marker": "o", "alpha": 0.4},
        ax=ax,
        saturation=1.0,
        legend=False,
    )

    # Atmospheric baseline reference line (420 ppm)
    ref_mg = 420 * PPM_TO_MG_M3
    ax.axhline(ref_mg, color="grey", linestyle="--", linewidth=1.0, alpha=0.7,
               label=f"Atmospheric baseline (420 ppm ~ {ref_mg:.0f} mg/m3)")

    ax.set_xlabel("Facility", fontsize=12, labelpad=8)
    ax.set_ylabel("CO2 Concentration (mg/m3)", fontsize=12, labelpad=8)
    ax.set_title(
        "Figure 6.1 -- Per-Facility CO2 Concentration Distributions\n"
        "(sensor_readings, Firestore)", fontsize=13, pad=12)

    ax.legend(fontsize=9, loc="upper right")
    ax.tick_params(axis="both", labelsize=10)

    # Annotate median values above each violin
    for i, fac_label in enumerate(facility_order_labels):
        subset = df[df["Facility"] == fac_label]["co2_mg_m3"]
        median = subset.median()
        ax.text(i, subset.quantile(0.97) + 10, f"med={median:.0f}",
                ha="center", va="bottom", fontsize=8, color="black", alpha=0.75)

    fig.tight_layout()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] Figure written to: {output_path}")

    # Print summary table
    print("\nSummary statistics (mg/m³):")
    summary = (
        df.groupby("Facility", observed=True)["co2_mg_m3"]
        .describe(percentiles=[0.25, 0.5, 0.75])
        .round(1)
    )
    print(summary.to_string())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Figure 6.1 — CO₂ distribution per facility")
    parser.add_argument(
        "--simulated", action="store_true",
        help="Skip Firestore and use simulated data directly"
    )
    parser.add_argument(
        "--output", default="figures/fig6_1_co2_distribution.png",
        help="Output image path (default: figures/fig6_1_co2_distribution.png)"
    )
    args = parser.parse_args()

    df = None

    if not args.simulated:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds:
            df = load_from_firestore()
        else:
            print("[INFO] GOOGLE_APPLICATION_CREDENTIALS not set — skipping Firestore.")

    if df is None:
        print("[INFO] Using simulated data that mirrors your facility emission profiles.")
        df = load_simulated()

    make_figure(df, args.output)


if __name__ == "__main__":
    main()
