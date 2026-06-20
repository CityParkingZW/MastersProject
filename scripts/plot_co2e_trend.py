#!/usr/bin/env python3
r"""
Figure 6.4 -- 90-Day Daily CO2e Trend vs Monthly Targets
==========================================================
Multi-line chart of daily total_co2e_kg for all five facilities over
Dec 2025 - Feb 2026, with per-facility horizontal target lines and
shaded month bands.

Data source priority:
  1. Firestore daily_summaries collection
  2. Simulated data derived from facility emission profiles

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\...\serviceAccountKey.json
  .venv\Scripts\python.exe scripts\plot_co2e_trend.py

  .venv\Scripts\python.exe scripts\plot_co2e_trend.py --simulated
"""

import argparse
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

PROJECT_ID   = "carbon-monitor-zw"
WINDOW_START = date(2025, 12, 1)
WINDOW_END   = date(2026, 2, 28)

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

# Monthly targets (kg CO2e / day) — aspirational reduction targets
# Set ~10% below each facility's expected daily mean
DAILY_TARGETS = {
    "fac-zpc":            1_900,
    "fac-zisco":          1_350,
    "fac-nrz":            700,
    "fac-mbpm":   410,
    "fac-cottco":           270,
}

# Simulation baselines (daily kg CO2e before noise)
# Derived from GHG Protocol: scope1 (co2 direct) + scope2 (energy × 0.92 grid_ef)
SIM_PROFILES = {
    "fac-zpc":            {"base": 2100, "var": 280, "trend": -0.8},
    "fac-zisco":          {"base": 1560, "var": 210, "trend": -0.5},
    "fac-nrz":          {"base":  790, "var": 120, "trend": -0.3},
    "fac-mbpm": {"base":  460, "var":  70, "trend": -0.2},
    "fac-cottco":         {"base":  305, "var":  45, "trend": -0.1},
}

# Month shading
MONTH_BANDS = [
    (date(2025, 12,  1), date(2025, 12, 31), "#e8f4f8", "December 2025"),
    (date(2026,  1,  1), date(2026,  1, 31), "#fef9e7", "January 2026"),
    (date(2026,  2,  1), date(2026,  2, 28), "#f0fff0", "February 2026"),
]


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def load_from_firestore() -> pd.DataFrame | None:
    try:
        from google.cloud import firestore
        db  = firestore.Client(project=PROJECT_ID)
        col = db.collection("daily_summaries")

        records = []
        for fac in FACILITIES:
            q = (col
                 .where("facility_id", "==", fac)
                 .where("date",        ">=", WINDOW_START.isoformat())
                 .where("date",        "<=", WINDOW_END.isoformat()))
            for doc in q.stream():
                d = doc.to_dict()
                if "total_co2e_kg" not in d or "date" not in d:
                    continue
                records.append({
                    "facility_id":    fac,
                    "date":           pd.to_datetime(d["date"]).date(),
                    "total_co2e_kg":  float(d["total_co2e_kg"]),
                })

        if not records:
            print("[Firestore] No records found in daily_summaries.")
            return None

        df = pd.DataFrame(records)
        print(f"[Firestore] {len(df)} daily records across {df['facility_id'].nunique()} facilities.")
        return df

    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated() -> pd.DataFrame:
    """Generate daily CO2e values for 90 days with a gentle downward trend
    (simulating emission reduction efforts) and weekly patterns."""
    rng  = np.random.default_rng(42)
    days = pd.date_range(WINDOW_START.isoformat(), WINDOW_END.isoformat(), freq="D")
    n    = len(days)
    rows = []

    for fac, p in SIM_PROFILES.items():
        t = np.arange(n)

        # Gentle linear downward trend over 90 days
        trend = p["trend"] * t

        # Weekly pattern: slightly lower on weekends
        dow = pd.DatetimeIndex(days).dayofweek
        weekend_dip = np.where(dow >= 5, -p["base"] * 0.08, 0.0)

        # Day-to-day variability
        noise = rng.normal(0, p["var"], n)

        values = p["base"] + trend + weekend_dip + noise
        values = np.clip(values, 50, None)

        rows.append(pd.DataFrame({
            "facility_id":   fac,
            "date":          days.date,
            "total_co2e_kg": values,
        }))

    df = pd.concat(rows, ignore_index=True)
    print(f"[Sim] Generated {len(df)} daily records across 5 facilities.")
    return df


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

def make_figure(df: pd.DataFrame, output_path: str) -> None:
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])

    fig, ax = plt.subplots(figsize=(14, 6))

    # --- Month shading ---
    for m_start, m_end, color, label in MONTH_BANDS:
        ax.axvspan(pd.Timestamp(m_start), pd.Timestamp(m_end),
                   alpha=1.0, color=color, zorder=0, label=label)

    # --- Per-facility lines + target lines ---
    for fac in FACILITIES:
        sub   = df[df["facility_id"] == fac].sort_values("date")
        color = PALETTE[fac]
        label = LABELS[fac]

        # Daily values — with slight smoothing (7-day rolling mean overlay)
        ax.plot(sub["date"], sub["total_co2e_kg"],
                color=color, linewidth=0.8, alpha=0.4, zorder=3)
        ax.plot(sub["date"],
                sub["total_co2e_kg"].rolling(7, center=True, min_periods=1).mean(),
                color=color, linewidth=2.0, label=label, zorder=4)

        # Horizontal target line (dashed, same colour, thinner)
        target = DAILY_TARGETS[fac]
        ax.axhline(target, color=color, linestyle="--",
                   linewidth=1.2, alpha=0.65, zorder=2)

        # Label target on right edge
        ax.text(pd.Timestamp(WINDOW_END) + pd.Timedelta(days=0.4),
                target, f"{target:,} kg", va="center",
                fontsize=7.5, color=color, alpha=0.85)

    # --- Month label annotations ---
    for m_start, m_end, _, label in MONTH_BANDS:
        mid = pd.Timestamp(m_start) + (pd.Timestamp(m_end) - pd.Timestamp(m_start)) / 2
        ax.text(mid, ax.get_ylim()[1] if ax.get_ylim()[1] > 0 else 2400,
                label, ha="center", va="top", fontsize=8.5,
                color="#555555", style="italic", zorder=5)

    # --- Axes formatting ---
    ax.set_xlabel("Date", fontsize=11, labelpad=6)
    ax.set_ylabel("Daily CO2e (kg)", fontsize=11)
    ax.set_title(
        "Figure 6.4 -- 90-Day Daily CO2e Trend vs Monthly Targets\n"
        "All facilities | December 2025 -- February 2026",
        fontsize=12, pad=10)

    ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO, interval=2))
    ax.xaxis.set_minor_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=8.5)

    ax.set_xlim(pd.Timestamp(WINDOW_START), pd.Timestamp(WINDOW_END) + pd.Timedelta(days=3))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:,.0f}"))
    ax.grid(axis="y", alpha=0.3, linestyle="--", zorder=1)

    # --- Legend ---
    # Facility lines
    fac_handles = [
        Line2D([0], [0], color=PALETTE[f], linewidth=2, label=LABELS[f])
        for f in FACILITIES
    ]
    # Month bands
    band_handles = [
        mpatches.Patch(facecolor=c, label=lbl, edgecolor="#cccccc")
        for _, _, c, lbl in MONTH_BANDS
    ]
    # Target marker
    target_handle = Line2D([0], [0], color="grey", linestyle="--",
                           linewidth=1.2, label="Monthly target (per facility)")

    ax.legend(handles=fac_handles + band_handles + [target_handle],
              fontsize=8.5, loc="upper right", framealpha=0.92, ncol=2)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] Figure written to: {output_path}")

    # Summary
    print("\nMean daily CO2e vs target (kg):")
    print(f"  {'Facility':<16} {'Mean':>8}  {'Target':>8}  {'vs Target':>10}")
    print(f"  {'-'*46}")
    for fac in FACILITIES:
        mean = df[df["facility_id"] == fac]["total_co2e_kg"].mean()
        tgt  = DAILY_TARGETS[fac]
        diff = mean - tgt
        sign = "+" if diff > 0 else ""
        print(f"  {LABELS[fac]:<16} {mean:>8.0f}  {tgt:>8,}  {sign}{diff:>+8.0f}")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Figure 6.4 -- CO2e trend vs targets")
    parser.add_argument("--simulated", action="store_true",
                        help="Skip Firestore, use simulated data")
    parser.add_argument("--output", default="figures/fig6_4_co2e_trend.png",
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
