#!/usr/bin/env python3
r"""
Figure 6.11 -- Scope 1 vs Scope 2 Emissions Breakdown
=======================================================
Stacked bar chart of mean daily Scope 1 and Scope 2 CO2e (kg) for all
five facilities, drawn from the Firestore daily_summaries collection
(February 2026 reporting period).

Falls back to seed-calibrated values if Firestore is unavailable.

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\...\serviceAccountKey.json
  .venv\Scripts\python.exe scripts\plot_scope_breakdown.py

  .venv\Scripts\python.exe scripts\plot_scope_breakdown.py --simulated
"""

import argparse
import os
from datetime import date

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

PROJECT_ID  = "carbon-monitor-zw"
FEB_START   = "2026-02-01"
FEB_END     = "2026-02-28"

FACILITY_ORDER = ["fac-zpc", "fac-zisco", "fac-nrz", "fac-mbpm", "fac-cottco"]

LABELS = {
    "fac-zpc":    "ZPC\nHarare",
    "fac-zisco":  "ZISCO\nSteel",
    "fac-nrz":    "NRZ\nBulawayo",
    "fac-mbpm":   "MBPM\nMutare",
    "fac-cottco": "COTTCO\nKadoma",
}

# Seed-calibrated fallback values (from seed.mjs facilityConfig)
# monthly_emission_target_kg / 30 × scope ratios
FALLBACK = {
    "fac-zpc":    {"total": 9_333,  "scope1_ratio": 0.62, "name": "ZPC Harare"},
    "fac-zisco":  {"total": 14_000, "scope1_ratio": 0.55, "name": "ZISCO Steel"},
    "fac-nrz":    {"total": 5_500,  "scope1_ratio": 0.70, "name": "NRZ Bulawayo"},
    "fac-mbpm":   {"total": 2_933,  "scope1_ratio": 0.25, "name": "MBPM Mutare"},
    "fac-cottco": {"total": 1_733,  "scope1_ratio": 0.08, "name": "COTTCO Kadoma"},
}


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def load_from_firestore():
    try:
        from google.cloud import firestore
        db  = firestore.Client(project=PROJECT_ID)
        col = db.collection("daily_summaries")

        records = {fac: {"scope1": [], "scope2": [], "total": []}
                   for fac in FACILITY_ORDER}

        for fac in FACILITY_ORDER:
            q = (col
                 .where("facility_id", "==", fac)
                 .where("date", ">=", FEB_START)
                 .where("date", "<=", FEB_END))
            for doc in q.stream():
                d = doc.to_dict()
                if "scope1_kg" in d and "scope2_kg" in d:
                    records[fac]["scope1"].append(float(d["scope1_kg"]))
                    records[fac]["scope2"].append(float(d["scope2_kg"]))
                    records[fac]["total"].append(float(d["total_co2e_kg"]))

        # Check we got data for at least one facility
        found = sum(1 for v in records.values() if v["scope1"])
        if found == 0:
            print("[Firestore] No Feb 2026 daily_summaries found.")
            return None

        result = {}
        for fac in FACILITY_ORDER:
            s1 = records[fac]["scope1"]
            s2 = records[fac]["scope2"]
            tot = records[fac]["total"]
            if s1:
                result[fac] = {
                    "scope1_mean": np.mean(s1),
                    "scope2_mean": np.mean(s2),
                    "total_mean":  np.mean(tot),
                    "n_days":      len(s1),
                    "source":      "firestore",
                }
            else:
                # Facility missing — fill from fallback
                fb = FALLBACK[fac]
                result[fac] = {
                    "scope1_mean": fb["total"] * fb["scope1_ratio"],
                    "scope2_mean": fb["total"] * (1 - fb["scope1_ratio"]),
                    "total_mean":  fb["total"],
                    "n_days":      0,
                    "source":      "fallback",
                }
        print(f"[Firestore] Loaded Feb 2026 data for {found}/5 facilities.")
        return result

    except Exception as exc:
        print(f"[Firestore] Could not connect: {exc}")
        return None


def load_simulated():
    result = {}
    for fac, fb in FALLBACK.items():
        s1 = fb["total"] * fb["scope1_ratio"]
        s2 = fb["total"] * (1 - fb["scope1_ratio"])
        result[fac] = {
            "scope1_mean": round(s1),
            "scope2_mean": round(s2),
            "total_mean":  fb["total"],
            "n_days":      28,
            "source":      "simulated",
        }
    print("[Sim] Using seed-calibrated daily CO2e values (Feb 2026 mean).")
    return result


# --------------------------------------------------------------------------
# Plot
# --------------------------------------------------------------------------

def make_figure(data: dict, output_path: str) -> None:
    facs   = FACILITY_ORDER
    labels = [LABELS[f] for f in facs]

    scope1 = np.array([data[f]["scope1_mean"] for f in facs])
    scope2 = np.array([data[f]["scope2_mean"] for f in facs])
    totals = scope1 + scope2

    x = np.arange(len(facs))
    w = 0.55

    fig, ax = plt.subplots(figsize=(11, 6.5))

    # Stacked bars
    bar1 = ax.bar(x, scope1, w,
                  color="#1a7340", label="Scope 1 (direct — combustion / process)",
                  edgecolor="white", linewidth=0.5, zorder=3)
    bar2 = ax.bar(x, scope2, w, bottom=scope1,
                  color="#74c476", label="Scope 2 (indirect — ZESA grid electricity)",
                  edgecolor="white", linewidth=0.5, zorder=3)

    # Value labels inside bars
    for i, (s1, s2, tot) in enumerate(zip(scope1, scope2, totals)):
        pct1 = s1 / tot * 100
        pct2 = s2 / tot * 100

        # Scope 1 label (inside dark bar)
        if s1 > 500:
            ax.text(i, s1 / 2, f"{s1:,.0f} kg\n({pct1:.0f}%)",
                    ha="center", va="center", fontsize=8,
                    color="white", fontweight="bold")

        # Scope 2 label (inside light bar)
        if s2 > 500:
            ax.text(i, s1 + s2 / 2, f"{s2:,.0f} kg\n({pct2:.0f}%)",
                    ha="center", va="center", fontsize=8,
                    color="#1a3320", fontweight="bold")

        # Total above bar
        ax.text(i, tot + 150, f"{tot:,.0f} kg",
                ha="center", va="bottom", fontsize=9,
                color="#333333", fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylabel("Mean Daily CO₂e (kg)", fontsize=11, labelpad=6)
    ax.set_xlabel("Facility", fontsize=11, labelpad=6)

    source_label = "Firestore daily_summaries" if any(
        d["source"] == "firestore" for d in data.values()
    ) else "Simulated (seed-calibrated)"

    ax.set_title(
        "Figure 6.11 — Scope 1 vs Scope 2 Daily CO₂e Breakdown\n"
        f"Mean daily emissions, February 2026  |  {source_label}",
        fontsize=12, pad=10)

    ax.set_ylim(0, totals.max() * 1.18)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.grid(axis="y", alpha=0.3, linestyle="--", zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    ax.legend(fontsize=9.5, loc="upper right", framealpha=0.92)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"\n[SAVED] {output_path}")


# --------------------------------------------------------------------------
# Print Table 6.6
# --------------------------------------------------------------------------

def print_table(data: dict) -> None:
    note = {
        "fac-zpc":    "Coal — highest absolute emitter",
        "fac-zisco":  "Highest intensity; process emissions dominant",
        "fac-nrz":    "Diesel Scope 1 dominant",
        "fac-mbpm":   "Low Scope 1 (biogenic); grid-dependent",
        "fac-cottco": "Almost entirely Scope 2 ZESA grid",
    }
    names = {f: FALLBACK[f]["name"] for f in FACILITY_ORDER}

    print("\nTable 6.6 — Representative Daily CO2e Accounting Outputs (Feb 2026 mean)")
    print(f"  {'Facility':<18} {'Name':<18} {'Total kg':>10}  "
          f"{'Scope1 kg (%)':>16}  {'Scope2 kg (%)':>16}  Note")
    print(f"  {'-'*100}")
    for fac in FACILITY_ORDER:
        d   = data[fac]
        s1  = d["scope1_mean"]
        s2  = d["scope2_mean"]
        tot = d["total_mean"]
        p1  = s1 / tot * 100
        p2  = s2 / tot * 100
        src = "*" if d["source"] != "firestore" else ""
        print(f"  {fac:<18} {names[fac]:<18} {tot:>10,.0f}  "
              f"{s1:>10,.0f} ({p1:.0f}%)  "
              f"{s2:>10,.0f} ({p2:.0f}%)  "
              f"{note[fac]}{src}")
    print("  (* = seed-calibrated fallback)")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate Figure 6.11 — Scope 1 vs Scope 2 breakdown")
    parser.add_argument("--simulated", action="store_true",
                        help="Skip Firestore, use seed-calibrated values")
    parser.add_argument("--output", default="figures/fig6_11_scope_breakdown.png")
    args = parser.parse_args()

    data = None
    if not args.simulated:
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds:
            data = load_from_firestore()
        else:
            print("[INFO] GOOGLE_APPLICATION_CREDENTIALS not set — using simulated data.")

    if data is None:
        data = load_simulated()

    print_table(data)
    make_figure(data, args.output)


if __name__ == "__main__":
    main()
