#!/usr/bin/env python3
r"""
Figure 6.3 -- Diurnal CO2 Profile
===================================
Line chart of mean hourly CO2 mg/m3 (averaged over 90 days) for each of
the five facilities on a 24-hour x-axis, showing operational-hour patterns.

Modes:
  1. Firestore  -- set GOOGLE_APPLICATION_CREDENTIALS before running
  2. Simulated  -- default when credentials are absent

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\...\serviceAccountKey.json
  .venv\Scripts\python.exe scripts\plot_diurnal.py

  .venv\Scripts\python.exe scripts\plot_diurnal.py --simulated
"""

import argparse
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

PPM_TO_MG_M3 = 44.01 / 24.45
PROJECT_ID   = "carbon-monitor-zw"

# 90-day window: 1 Dec 2025 -- 28 Feb 2026
WINDOW_START = datetime(2025, 12, 1, tzinfo=timezone.utc)
WINDOW_END   = datetime(2026, 3,  1, tzinfo=timezone.utc)

FACILITIES = ["fac-zpc", "fac-zisco", "fac-nrz", "fac-mbpm", "fac-cottco"]

PALETTE = {
    "fac-zpc":            "#d62728",
    "fac-zisco":          "#ff7f0e",
    "fac-nrz":          "#1f77b4",
    "fac-mbpm": "#2ca02c",
    "fac-cottco":         "#9467bd",
}

LABELS = {
    "fac-zpc":            "ZPC",
    "fac-zisco":          "ZISCO",
    "fac-nrz":          "NRZ Bulawayo",
    "fac-mbpm": "MBPM Mutare",
    "fac-cottco":         "Cottco",
}

# Facility emission profiles for simulation
PROFILES = {
    "fac-zpc":            {"co2_base": 1480, "co2_var": 220, "peak_hour": 10, "amplitude": 0.30},
    "fac-zisco":          {"co2_base": 1100, "co2_var": 170, "peak_hour": 11, "amplitude": 0.28},
    "fac-nrz":          {"co2_base":  780, "co2_var": 120, "peak_hour": 12, "amplitude": 0.22},
    "fac-mbpm": {"co2_base":  580, "co2_var":  80, "peak_hour": 13, "amplitude": 0.20},
    "fac-cottco":         {"co2_base":  465, "co2_var":  50, "peak_hour":  9, "amplitude": 0.18},
}


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def load_from_firestore() -> pd.DataFrame | None:
    try:
        from google.cloud import firestore
        db  = firestore.Client(project=PROJECT_ID)
        col = db.collection("sensor_readings")

        records = []
        for fac in FACILITIES:
            q = (col
                 .where("facility_id", "==", fac)
                 .where("timestamp",   ">=", WINDOW_START.isoformat())
                 .where("timestamp",   "<",  WINDOW_END.isoformat()))
            for doc in q.stream():
                d = doc.to_dict()
                ts_raw = d.get("timestamp") or d.get("received_at")
                if ts_raw is None or "co2_mg_m3" not in d:
                    continue
                try:
                    ts = pd.to_datetime(ts_raw, utc=True)
                except Exception:
                    continue
                records.append({
                    "facility_id": fac,
                    "hour":        ts.hour,
                    "co2_mg_m3":   float(d["co2_mg_m3"]),
                })

        if not records:
            print("[Firestore] No records found.")
            return None

        df = pd.DataFrame(records)
        print(f"[Firestore] {len(df)} readings across {df['facility_id'].nunique()} facilities.")
        return df

    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated() -> pd.DataFrame:
    """Generate 90 days x 24 h x 60 min = 129,600 readings per facility,
    then keep only the (facility_id, hour, co2_mg_m3) columns needed."""
    rng = np.random.default_rng(42)
    total_minutes = 90 * 24 * 60
    hours = np.tile(np.repeat(np.arange(24), 60), 90)   # hour-of-day for each minute

    rows = []
    for fac, p in PROFILES.items():
        # Diurnal curve: sine peak at p["peak_hour"], trough ~12 h later
        phase  = 2 * np.pi * (hours - p["peak_hour"]) / 24
        diurnal = 1.0 + p["amplitude"] * np.cos(phase)

        # Add day-to-day variability (slow drift) + white noise
        day_drift = np.repeat(rng.normal(0, p["co2_var"] * 0.15, 90), 24 * 60)
        noise     = rng.normal(0, p["co2_var"] * 0.05, total_minutes)

        co2 = p["co2_base"] * diurnal + day_drift + noise
        co2 = np.clip(co2, 350, 5000)

        rows.append(pd.DataFrame({
            "facility_id": fac,
            "hour":        hours,
            "co2_mg_m3":   co2 * PPM_TO_MG_M3,
        }))

    combined = pd.concat(rows, ignore_index=True)
    print(f"[Sim] Generated {len(combined)} readings across 5 facilities (90 days).")
    return combined


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

def make_figure(df: pd.DataFrame, output_path: str) -> None:
    df = df.copy()
    # data already in mg/m³

    # Mean + 95% CI (std/sqrt(n)) per facility per hour
    grouped = (
        df.groupby(["facility_id", "hour"])["co2_mg_m3"]
        .agg(mean="mean", std="std", n="count")
        .reset_index()
    )
    grouped["se"] = grouped["std"] / np.sqrt(grouped["n"])
    grouped["ci95"] = 1.96 * grouped["se"]

    fig, ax = plt.subplots(figsize=(12, 5))

    for fac in FACILITIES:
        sub = grouped[grouped["facility_id"] == fac].sort_values("hour")
        color = PALETTE[fac]
        label = LABELS[fac]

        ax.plot(sub["hour"], sub["mean"],
                color=color, linewidth=2.0, label=label, zorder=3)
        ax.fill_between(sub["hour"],
                        sub["mean"] - sub["ci95"],
                        sub["mean"] + sub["ci95"],
                        color=color, alpha=0.12, zorder=2)

    # Shade operational hours (07:00 -- 18:00)
    ax.axvspan(7, 18, alpha=0.07, color="gold", zorder=1,
               label="Operational hours (07:00-18:00)")

    # Reference: atmospheric CO2 baseline
    ref = 420 * PPM_TO_MG_M3
    ax.axhline(ref, color="grey", linestyle=":", linewidth=1.0, alpha=0.7,
               label=f"Atmospheric baseline (~{ref:.0f} mg/m3)")

    ax.set_xlabel("Hour of Day (UTC+2, CAT)", fontsize=11, labelpad=6)
    ax.set_ylabel("Mean CO2 Concentration (mg/m3)", fontsize=11)
    ax.set_title(
        "Figure 6.3 -- Diurnal CO2 Profile\n"
        "Mean hourly CO2 averaged over 90 days (Dec 2025 -- Feb 2026), all facilities",
        fontsize=12, pad=10)

    ax.set_xlim(0, 23)
    ax.xaxis.set_major_locator(ticker.MultipleLocator(2))
    ax.xaxis.set_minor_locator(ticker.MultipleLocator(1))
    ax.set_xticks(range(0, 24, 2))
    ax.set_xticklabels([f"{h:02d}:00" for h in range(0, 24, 2)], fontsize=9)

    ax.legend(fontsize=9, loc="upper left", framealpha=0.92)
    ax.grid(axis="y", alpha=0.3, linestyle="--")
    ax.grid(axis="x", alpha=0.15, linestyle=":")

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] Figure written to: {output_path}")

    # Print peak hours per facility
    print("\nPeak CO2 hour per facility:")
    for fac in FACILITIES:
        sub = grouped[grouped["facility_id"] == fac]
        peak_row = sub.loc[sub["mean"].idxmax()]
        print(f"  {LABELS[fac]:12s}  hour={int(peak_row['hour']):02d}:00  "
              f"mean={peak_row['mean']:.0f} mg/m3")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Figure 6.3 -- Diurnal CO2 profile")
    parser.add_argument("--simulated", action="store_true",
                        help="Skip Firestore, use simulated data")
    parser.add_argument("--output", default="figures/fig6_3_diurnal.png",
                        help="Output image path")
    args = parser.parse_args()

    df = None

    if not args.simulated:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds:
            df = load_from_firestore()
        else:
            print("[INFO] GOOGLE_APPLICATION_CREDENTIALS not set -- using simulated data.")

    if df is None:
        print("[INFO] Using simulated 90-day data.")
        df = load_simulated()

    make_figure(df, args.output)


if __name__ == "__main__":
    main()
