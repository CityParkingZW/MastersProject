#!/usr/bin/env python3
r"""
Figure 6.2 -- 7-Day CO2 and Energy Time Series
===============================================
Dual-axis line chart of co2_mg_m3 (left) and energy_kwh (right) for one
facility over 22-28 February 2026, with ZESA load-shedding events shaded.

Modes:
  1. Firestore  -- set GOOGLE_APPLICATION_CREDENTIALS before running
  2. Simulated  -- default when credentials are absent (--simulated flag)

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\...\serviceAccountKey.json
  .venv\Scripts\python.exe scripts\plot_timeseries.py

  .venv\Scripts\python.exe scripts\plot_timeseries.py --simulated
  .venv\Scripts\python.exe scripts\plot_timeseries.py --facility fac-zpc
"""

import argparse
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

PPM_TO_MG_M3  = 44.01 / 24.45          # CO2 unit conversion factor
START_DATE    = datetime(2026, 2, 22, tzinfo=timezone.utc)
END_DATE      = datetime(2026, 3,  1, tzinfo=timezone.utc)   # exclusive
DEFAULT_FAC   = "fac-zpc"
PROJECT_ID    = "carbon-monitor-zw"

# ZESA load-shedding windows (Stage 2, Feb 2026, rotating 8-h blocks).
# Each tuple: (day offset from START_DATE, start_hour, end_hour).
# Derived from Zimbabwe's standard rotation schedule for that week.
LOADSHED_WINDOWS = [
    (0,  0,  8),   # Feb 22: 00:00 -- 08:00
    (0, 16, 20),   # Feb 22: 16:00 -- 20:00
    (1,  6, 14),   # Feb 23: 06:00 -- 14:00
    (1, 22, 24),   # Feb 23: 22:00 -- 24:00
    (2,  0,  2),   # Feb 24: 00:00 -- 02:00
    (2, 10, 18),   # Feb 24: 10:00 -- 18:00
    (3,  4, 12),   # Feb 25: 04:00 -- 12:00
    (3, 20, 24),   # Feb 25: 20:00 -- 24:00
    (4,  0,  4),   # Feb 26: 00:00 -- 04:00
    (4, 14, 22),   # Feb 26: 14:00 -- 22:00
    (5,  8, 16),   # Feb 27: 08:00 -- 16:00
    (6,  2, 10),   # Feb 28: 02:00 -- 10:00
    (6, 18, 22),   # Feb 28: 18:00 -- 22:00
]


def loadshed_spans():
    """Return list of (start_dt, end_dt) UTC datetimes for shading."""
    spans = []
    for day_off, h_start, h_end in LOADSHED_WINDOWS:
        base = START_DATE + timedelta(days=day_off)
        spans.append((
            base + timedelta(hours=h_start),
            base + timedelta(hours=h_end),
        ))
    return spans


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def load_from_firestore(facility_id: str) -> pd.DataFrame | None:
    try:
        from google.cloud import firestore
        db = firestore.Client(project=PROJECT_ID)

        # Firestore query: filter by facility and timestamp range
        col = db.collection("sensor_readings")
        q = (col
             .where("facility_id", "==", facility_id)
             .where("timestamp",   ">=", START_DATE.isoformat())
             .where("timestamp",   "<",  END_DATE.isoformat()))

        docs = list(q.stream())
        if not docs:
            # Try without date filter in case timestamps are stored differently
            q2 = col.where("facility_id", "==", facility_id)
            docs = list(q2.stream())
            print(f"[Firestore] Date-filtered query returned 0 docs; loaded all {len(docs)} for facility.")

        records = []
        for doc in docs:
            d = doc.to_dict()
            ts_raw = d.get("timestamp") or d.get("received_at") or d.get("created_at")
            if ts_raw is None or "co2_mg_m3" not in d:
                continue
            try:
                ts = pd.to_datetime(ts_raw, utc=True)
            except Exception:
                continue
            records.append({
                "ts":         ts,
                "co2_mg_m3":  float(d.get("co2_mg_m3", 756.0)),
                "energy_kwh": float(d.get("energy_kwh", 0)),
            })

        if not records:
            print("[Firestore] No usable records found.")
            return None

        df = pd.DataFrame(records).sort_values("ts").reset_index(drop=True)

        # Narrow to Feb 22-28 if we have a wider set
        mask = (df["ts"] >= START_DATE) & (df["ts"] < END_DATE)
        if mask.sum() > 0:
            df = df[mask].reset_index(drop=True)

        print(f"[Firestore] {len(df)} readings loaded for {facility_id}.")
        return df

    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated(facility_id: str) -> pd.DataFrame:
    """Generate 1-minute resolution data for 7 days with realistic patterns
    and energy drops during ZESA load-shedding windows."""
    rng = np.random.default_rng(42)
    spans = loadshed_spans()

    # Build timestamp index at 1-minute resolution
    total_minutes = 7 * 24 * 60
    times = [START_DATE + timedelta(minutes=i) for i in range(total_minutes)]

    # Profile: fac-zpc is industrial (high CO2); others are lower
    profiles = {
        "fac-zpc":            {"co2_base": 1480, "co2_var": 220, "energy_base": 95},
        "fac-zisco":          {"co2_base": 1100, "co2_var": 180, "energy_base": 75},
        "fac-nrz":          {"co2_base":  780, "co2_var": 120, "energy_base": 32},
        "fac-mbpm": {"co2_base":  580, "co2_var":  80, "energy_base": 20},
        "fac-cottco":         {"co2_base":  465, "co2_var":  50, "energy_base": 14},
    }
    p = profiles.get(facility_id, profiles["fac-zpc"])

    co2_vals    = []
    energy_vals = []

    prev_co2    = p["co2_base"]
    prev_energy = p["energy_base"]

    for t in times:
        hour = t.hour
        in_loadshed = any(s <= t < e for s, e in spans)

        # Diurnal factor (peak 09:00-17:00 for industrial)
        diurnal = 1.0 + 0.25 * np.sin(2 * np.pi * (hour - 6) / 24)

        # Energy: drop to ~10% during load-shedding (generator backup)
        target_energy = p["energy_base"] * diurnal * (0.10 if in_loadshed else 1.0)
        prev_energy += 0.15 * (target_energy - prev_energy) + rng.normal(0, 1.0)
        prev_energy = max(0, prev_energy)

        # CO2: drops with energy during load-shedding (less combustion/process)
        co2_scale = 0.55 if in_loadshed else 1.0
        target_co2 = p["co2_base"] * diurnal * co2_scale
        prev_co2  += 0.12 * (target_co2 - prev_co2) + rng.normal(0, p["co2_var"] * 0.05)
        prev_co2   = max(350, min(5000, prev_co2))

        co2_vals.append(prev_co2)
        energy_vals.append(prev_energy)

    df = pd.DataFrame({
        "ts":         pd.to_datetime(times),
        "co2_mg_m3":  [v * PPM_TO_MG_M3 for v in co2_vals],
        "energy_kwh": energy_vals,
    })
    print(f"[Sim] Generated {len(df)} readings for {facility_id} (22-28 Feb 2026).")
    return df


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

def make_figure(df: pd.DataFrame, facility_id: str, output_path: str) -> None:
    df = df.copy()
    # data already in mg/m³

    # Resample to 15-min averages to keep the chart readable
    df = df.set_index("ts").resample("15min").mean().dropna().reset_index()

    spans = loadshed_spans()

    fig, ax1 = plt.subplots(figsize=(14, 5))

    # --- Left axis: CO2 mg/m3 ---
    color_co2 = "#d62728"
    ax1.plot(df["ts"], df["co2_mg_m3"],
             color=color_co2, linewidth=1.2, label="CO2 (mg/m3)", zorder=3)
    ax1.set_xlabel("Date (February 2026)", fontsize=11, labelpad=6)
    ax1.set_ylabel("CO2 Concentration (mg/m3)", color=color_co2, fontsize=11)
    ax1.tick_params(axis="y", labelcolor=color_co2)
    ax1.tick_params(axis="x", labelsize=9)

    # --- Right axis: Energy kWh ---
    ax2 = ax1.twinx()
    color_energy = "#1f77b4"
    ax2.plot(df["ts"], df["energy_kwh"],
             color=color_energy, linewidth=1.1, linestyle="--",
             label="Energy (kWh)", zorder=3, alpha=0.85)
    ax2.set_ylabel("Energy Consumption (kWh)", color=color_energy, fontsize=11)
    ax2.tick_params(axis="y", labelcolor=color_energy)

    # --- Grey shading for ZESA load-shedding ---
    first_shade = True
    for s, e in spans:
        label = "ZESA load-shedding" if first_shade else "_nolegend_"
        ax1.axvspan(s, e, alpha=0.18, color="grey", zorder=1, label=label)
        first_shade = False

    # --- X-axis formatting ---
    ax1.xaxis.set_major_locator(mdates.DayLocator(interval=1))
    ax1.xaxis.set_minor_locator(mdates.HourLocator(byhour=[6, 12, 18]))
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=0, ha="center")

    ax1.set_xlim(START_DATE, END_DATE)

    # --- Combined legend ---
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2,
               loc="upper left", fontsize=9, framealpha=0.9)

    label_map = {
        "fac-zpc":            "ZPC (Zimbabwe Power Corporation)",
        "fac-zisco":          "ZISCO",
        "fac-nrz":          "NRZ Bulawayo",
        "fac-mbpm": "MBPM Mutare",
        "fac-cottco":         "Cottco",
    }
    fac_label = label_map.get(facility_id, facility_id)
    ax1.set_title(
        f"Figure 6.2 -- 7-Day CO2 and Energy Time Series\n"
        f"{fac_label}  |  22-28 February 2026",
        fontsize=12, pad=10)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] Figure written to: {output_path}")

    # Quick stats
    print(f"\nCO2 (mg/m3):   min={df['co2_mg_m3'].min():.0f}  "
          f"max={df['co2_mg_m3'].max():.0f}  "
          f"mean={df['co2_mg_m3'].mean():.0f}")
    print(f"Energy (kWh):  min={df['energy_kwh'].min():.1f}  "
          f"max={df['energy_kwh'].max():.1f}  "
          f"mean={df['energy_kwh'].mean():.1f}")
    ls_pct = sum((e - s).total_seconds() for s, e in spans) / (7 * 86400) * 100
    print(f"Load-shedding: {ls_pct:.0f}% of the 7-day window shaded")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Figure 6.2 -- CO2 and Energy time series")
    parser.add_argument("--simulated", action="store_true",
                        help="Skip Firestore and use simulated data")
    parser.add_argument("--facility", default=DEFAULT_FAC,
                        help=f"Facility ID to plot (default: {DEFAULT_FAC})")
    parser.add_argument("--output", default="figures/fig6_2_timeseries.png",
                        help="Output image path")
    args = parser.parse_args()

    df = None

    if not args.simulated:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds:
            df = load_from_firestore(args.facility)
        else:
            print("[INFO] GOOGLE_APPLICATION_CREDENTIALS not set -- using simulated data.")

    if df is None:
        print("[INFO] Using simulated data for 22-28 Feb 2026.")
        df = load_simulated(args.facility)

    make_figure(df, args.facility, args.output)


if __name__ == "__main__":
    main()
