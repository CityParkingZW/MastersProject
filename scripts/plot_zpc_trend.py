#!/usr/bin/env python3
r"""
Figure 6.12 -- Monthly CO2e Trend vs Target (ZPC Harare)
=========================================================
Line chart of daily actual total_co2e_kg vs monthly target/30 for
ZPC Harare over the 90-day period (Dec 2025 -- Feb 2026), with
annotated December push, January dip, and February recovery phases.

Data source:
  1. Firestore daily_summaries (facility_id = fac-zpc)
  2. Seed-calibrated simulation if Firestore unavailable

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\...\serviceAccountKey.json
  .venv\Scripts\python.exe scripts\plot_zpc_trend.py

  .venv\Scripts\python.exe scripts\plot_zpc_trend.py --simulated
"""

import argparse
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches

PROJECT_ID    = "carbon-monitor-zw"
FACILITY_ID   = "fac-zpc"
WINDOW_START  = date(2025, 12, 1)
WINDOW_END    = date(2026, 2, 28)

# From seed.mjs facilityConfig
MONTHLY_TARGET_KG = 280_000
DAILY_TARGET      = MONTHLY_TARGET_KG / 30   # 9,333.33 kg/day

# Month phase factors (from seed.mjs generateDailySummaries)
PHASE = {
    "dec": {"factor": 1.10, "label": "December Push\n(+10% above target)",  "color": "#d62728"},
    "jan": {"factor": 0.88, "label": "January Maintenance\n(−12% below target)", "color": "#1f77b4"},
    "feb": {"factor": 0.97, "label": "February Recovery\n(−3%, trending ↑)", "color": "#2ca02c"},
}


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def load_from_firestore():
    try:
        from firebase_admin import credentials, firestore, initialize_app, _apps
        if not _apps:
            cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
            cred = credentials.Certificate(cred_path)
            initialize_app(cred)
        db  = firestore.client()
        col = db.collection("daily_summaries")
        q   = (col
               .where("facility_id", "==", FACILITY_ID)
               .where("date", ">=", WINDOW_START.isoformat())
               .where("date", "<=", WINDOW_END.isoformat()))

        records = []
        for doc in q.stream():
            d = doc.to_dict()
            if "total_co2e_kg" in d and "date" in d:
                records.append({
                    "date":         pd.to_datetime(d["date"]).date(),
                    "total_co2e_kg": float(d["total_co2e_kg"]),
                    "scope1_kg":    float(d.get("scope1_kg", 0)),
                    "scope2_kg":    float(d.get("scope2_kg", 0)),
                })

        if not records:
            print("[Firestore] No daily_summaries for fac-zpc found.")
            return None

        df = pd.DataFrame(records).sort_values("date").reset_index(drop=True)
        print(f"[Firestore] Loaded {len(df)} daily records for fac-zpc.")
        return df

    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated() -> pd.DataFrame:
    """Simulate 90 days of ZPC daily CO2e matching seed.mjs logic."""
    rng  = np.random.default_rng(42)
    days = pd.date_range(WINDOW_START.isoformat(), WINDOW_END.isoformat(), freq="D")
    records = []

    for i, d in enumerate(days):
        # Month phase factor
        if d.month == 12:
            mf = PHASE["dec"]["factor"]
        elif d.month == 1:
            mf = PHASE["jan"]["factor"]
        else:
            mf = PHASE["feb"]["factor"]

        # Sunday reduction (dayofweek==6 is Sunday)
        wf = 0.72 if d.dayofweek == 6 else 1.0

        # Day noise
        noise = 1 + (rng.random() - 0.5) * 0.12
        total = float(np.clip(
            DAILY_TARGET * mf * wf * noise,
            100, DAILY_TARGET * 2.5
        ))
        scope1 = round(total * 0.62, 2)
        scope2 = round(total - scope1, 2)

        records.append({
            "date":          d.date(),
            "total_co2e_kg": round(total, 2),
            "scope1_kg":     scope1,
            "scope2_kg":     scope2,
        })

    df = pd.DataFrame(records)
    print(f"[Sim] Generated {len(df)} daily records for fac-zpc (90 days).")
    return df


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

def make_figure(df: pd.DataFrame, output_path: str) -> None:
    df = df.copy()
    df["date_dt"] = pd.to_datetime(df["date"])

    # 7-day rolling mean
    df["rolling7"] = df["total_co2e_kg"].rolling(7, center=True, min_periods=1).mean()

    fig, ax = plt.subplots(figsize=(14, 6))

    # Month shading
    bands = [
        (date(2025, 12, 1), date(2025, 12, 31), "#fde8e8", "December 2025"),
        (date(2026,  1, 1), date(2026,  1, 31), "#e8f0fd", "January 2026"),
        (date(2026,  2, 1), date(2026,  2, 28), "#e8fde8", "February 2026"),
    ]
    for bs, be, col, lbl in bands:
        ax.axvspan(pd.Timestamp(bs), pd.Timestamp(be),
                   alpha=1.0, color=col, zorder=0, label=lbl)

    # Daily values (faint)
    ax.plot(df["date_dt"], df["total_co2e_kg"],
            color="#888888", linewidth=0.7, alpha=0.55, zorder=2)

    # 7-day rolling mean (bold)
    ax.plot(df["date_dt"], df["rolling7"],
            color="#1a7340", linewidth=2.2, zorder=4, label="Daily CO₂e (7-day mean)")

    # Monthly target line
    ax.axhline(DAILY_TARGET, color="#d62728", linestyle="--",
               linewidth=1.6, zorder=3,
               label=f"Monthly target ÷ 30  ({DAILY_TARGET:,.0f} kg/day)")

    # Phase mean lines (subtle horizontal reference per phase)
    phase_ranges = [
        ("dec", date(2025, 12, 1), date(2025, 12, 31)),
        ("jan", date(2026,  1, 1), date(2026,  1, 31)),
        ("feb", date(2026,  2, 1), date(2026,  2, 28)),
    ]
    for key, ps, pe in phase_ranges:
        mask = (df["date_dt"] >= pd.Timestamp(ps)) & (df["date_dt"] <= pd.Timestamp(pe))
        phase_mean = df.loc[mask, "total_co2e_kg"].mean()
        ax.hlines(phase_mean,
                  xmin=pd.Timestamp(ps), xmax=pd.Timestamp(pe),
                  colors=PHASE[key]["color"], linestyles=":",
                  linewidth=1.4, alpha=0.7, zorder=3)

    # Phase annotation boxes
    annot_cfg = [
        # (x_mid, y_pos, phase_key, variance_text)
        (date(2025, 12, 16), DAILY_TARGET * 1.245, "dec",
         f"Dec mean ≈ {DAILY_TARGET*PHASE['dec']['factor']:,.0f} kg\n(+10% above target)"),
        (date(2026,  1, 16), DAILY_TARGET * 0.70,  "jan",
         f"Jan mean ≈ {DAILY_TARGET*PHASE['jan']['factor']:,.0f} kg\n(−12% below target)"),
        (date(2026,  2, 14), DAILY_TARGET * 1.12,  "feb",
         f"Feb mean ≈ {DAILY_TARGET*PHASE['feb']['factor']:,.0f} kg\n(−3%, trending ↑)"),
    ]
    for xd, yd, key, txt in annot_cfg:
        ax.text(pd.Timestamp(xd), yd, txt,
                ha="center", va="center", fontsize=8.5,
                color=PHASE[key]["color"], fontweight="bold",
                bbox={"boxstyle": "round,pad=0.4", "facecolor": "white",
                      "edgecolor": PHASE[key]["color"], "alpha": 0.90})

    # Sunday markers (show reduced-production Sundays)
    sundays = df[df["date_dt"].dt.dayofweek == 6]
    ax.scatter(sundays["date_dt"], sundays["total_co2e_kg"],
               marker="v", color="#ff7f0e", s=22, zorder=5, alpha=0.7,
               label="Sunday (−28% production)")

    # Axes
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO, interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=8.5)

    ax.set_xlim(pd.Timestamp(WINDOW_START), pd.Timestamp(WINDOW_END) + pd.Timedelta(days=1))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.set_ylabel("Daily CO₂e (kg)", fontsize=11, labelpad=6)
    ax.set_xlabel("Date", fontsize=11, labelpad=6)
    ax.set_title(
        "Figure 6.12 — ZPC Harare: Monthly CO₂e Trend vs Target\n"
        "Daily total_co2e_kg with 7-day rolling mean  |  Dec 2025 – Feb 2026",
        fontsize=12, pad=10)

    ax.grid(axis="y", alpha=0.25, linestyle="--", zorder=1)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    # Legend
    handles, lbls = ax.get_legend_handles_labels()
    # Add raw daily line manually
    from matplotlib.lines import Line2D
    handles.append(Line2D([0], [0], color="#888888", linewidth=0.8, alpha=0.6,
                           label="Daily CO₂e (raw)"))
    ax.legend(handles=handles, fontsize=8.5, loc="upper right",
              framealpha=0.92, ncol=2)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] {output_path}")

    # Summary stats
    print("\nPhase statistics (ZPC Harare):")
    print(f"  {'Phase':<12} {'Days':>6}  {'Mean kg':>10}  {'vs Target':>10}  {'Min kg':>10}  {'Max kg':>10}")
    print(f"  {'-'*60}")
    phases_data = [
        ("December",  date(2025, 12, 1), date(2025, 12, 31)),
        ("January",   date(2026,  1, 1), date(2026,  1, 31)),
        ("February",  date(2026,  2, 1), date(2026,  2, 28)),
    ]
    for name, ps, pe in phases_data:
        mask = (df["date_dt"] >= pd.Timestamp(ps)) & (df["date_dt"] <= pd.Timestamp(pe))
        sub  = df.loc[mask, "total_co2e_kg"]
        mean = sub.mean()
        pct  = (mean - DAILY_TARGET) / DAILY_TARGET * 100
        sign = "+" if pct > 0 else ""
        print(f"  {name:<12} {len(sub):>6}  {mean:>10,.0f}  "
              f"{sign}{pct:>+8.1f}%  {sub.min():>10,.0f}  {sub.max():>10,.0f}")
    print(f"\n  Daily target: {DAILY_TARGET:,.0f} kg  "
          f"(monthly target {MONTHLY_TARGET_KG:,} kg ÷ 30)")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate Figure 6.12 — ZPC CO2e trend vs target")
    parser.add_argument("--simulated", action="store_true",
                        help="Skip Firestore, use simulated data")
    parser.add_argument("--output", default="figures/fig6_12_zpc_trend.png")
    args = parser.parse_args()

    df = None
    if not args.simulated:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds:
            df = load_from_firestore()
        else:
            print("[INFO] GOOGLE_APPLICATION_CREDENTIALS not set — using simulated data.")

    if df is None:
        df = load_simulated()

    make_figure(df, args.output)


if __name__ == "__main__":
    main()
