#!/usr/bin/env python3
"""
Harare-Specific Synthesized Dataset Generator
=============================================
Generates realistic sensor training data grounded in:
  - Harare climate (1483 m altitude, subtropical highland)
  - ZESA load-shedding schedules (12-18 h/day, 2024-2026)
  - Zimbabwe grid emission factor (0.92 kg CO2e/kWh)
  - Seven real Harare industrial locations with appropriate emission profiles
  - Altitude-adjusted combustion efficiency (~8 % reduction vs sea level)
  - Seasonal variation: rainy (Nov-Mar) vs dry (Apr-Oct)

Output: scripts/harare_training_data.csv  (~50 000 rows)
"""

import math
import random
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

# ── Zimbabwe / Harare constants ────────────────────────────────────────────────
HARARE_ALTITUDE_M       = 1483
ALTITUDE_COMBUSTION_ADJ = 1 - (HARARE_ALTITUDE_M / 1000) * 0.03  # ~8 % efficiency drop
ZESA_GRID_EF_KG_KWH     = 0.92   # kg CO2e / kWh (coal-heavy when Kariba is low)
ATMOSPHERIC_CO2_PPM     = 420    # global background
ATMOSPHERIC_CH4_PPM     = 1.9    # global background
HARARE_LAT              = -17.83  # used for approximate solar-angle patterns

# Rainy season months (Nov-Mar) → higher humidity, lower temps at night, greener
RAINY_MONTHS = {11, 12, 1, 2, 3}

# ZESA typical load-shedding blocks (hour ranges that are OFF power, 0-based)
# Rotated per-facility to spread the schedule
LOADSHEDDING_SCHEDULES = [
    list(range(2,  8))  + list(range(14, 20)),   # Group A: 02-08 + 14-20
    list(range(4,  10)) + list(range(16, 22)),   # Group B: 04-10 + 16-22
    list(range(6,  12)) + list(range(18, 24)),   # Group C: 06-12 + 18-24
    list(range(0,  6))  + list(range(12, 18)),   # Group D: 00-06 + 12-18
]


# ── Facility definitions ───────────────────────────────────────────────────────
# Each dict is a full scenario for one dummy site

HARARE_FACILITIES = [

    {   # 1 — Msasa Metal Works
        "facility_id":   "FAC-MSM",
        "facility_name": "Msasa Metal Works",
        "location":      "Msasa Industrial Area, Harare",
        "isic_code":     "C24",
        "description":   "Steel fabrication and metal casting; electric arc furnaces",
        "loadshed_group": 0,
        # Combustion-heavy: high CO2 + some CH4 from coke/gas lances
        "co2_base":      1800, "co2_variance": 400,
        "ch4_base":      6.5,  "ch4_variance": 2.5,
        "temp_base":     34,   "temp_variance": 6,
        "humidity_base": 35,   "humidity_variance": 8,
        "energy_base":   320,  "energy_variance": 80,
        # Custom multipliers: furnaces run hardest 06-22
        "work_hours": list(range(6, 22)),
        "work_energy_factor": 1.6,
        "weekend_factor":     0.45,
        "anomaly_prob":       0.04,  # furnace blowouts
    },

    {   # 2 — Workington Food & Beverage
        "facility_id":   "FAC-WFB",
        "facility_name": "Workington Food Processing Plant",
        "location":      "Workington Industrial, Harare",
        "isic_code":     "C10",
        "description":   "Flour milling, grain drying, cooking steam boilers",
        "loadshed_group": 1,
        "co2_base":      680,  "co2_variance": 120,
        "ch4_base":      3.8,  "ch4_variance": 1.2,
        "temp_base":     29,   "temp_variance": 4,
        "humidity_base": 58,   "humidity_variance": 12,
        "energy_base":   145,  "energy_variance": 35,
        "work_hours": list(range(5, 22)),
        "work_energy_factor": 1.4,
        "weekend_factor":     0.80,  # processing continues weekends
        "anomaly_prob":       0.02,
    },

    {   # 3 — Pomona Waste Management Site
        "facility_id":   "FAC-PWM",
        "facility_name": "Pomona Landfill & Waste Processing",
        "location":      "Pomona, Harare",
        "isic_code":     "E38",
        "description":   "Municipal solid waste landfill; biogas capture partially operational",
        "loadshed_group": 2,
        # Landfill: CH4 dominant; CO2 elevated; low energy draw
        "co2_base":      950,  "co2_variance": 200,
        "ch4_base":      85,   "ch4_variance": 30,   # fugitive landfill gas
        "temp_base":     32,   "temp_variance": 5,
        "humidity_base": 62,   "humidity_variance": 14,
        "energy_base":   40,   "energy_variance": 15,
        "work_hours": list(range(6, 18)),
        "work_energy_factor": 1.2,
        "weekend_factor":     0.60,
        "anomaly_prob":       0.05,  # gas pocket releases
    },

    {   # 4 — Ruwa Tobacco Curing
        "facility_id":   "FAC-RTC",
        "facility_name": "Ruwa Tobacco Curing Barns",
        "location":      "Ruwa, Harare Metro",
        "isic_code":     "C12",
        "description":   "Flue-cured tobacco using coal/wood-fired barns; seasonal operation",
        "loadshed_group": 3,
        # Curing season Apr-Sep; high CO2 from solid fuel firing
        "co2_base":      1200, "co2_variance": 280,
        "ch4_base":      4.2,  "ch4_variance": 1.8,
        "temp_base":     38,   "temp_variance": 7,   # barn interior
        "humidity_base": 42,   "humidity_variance": 10,
        "energy_base":   75,   "energy_variance": 25,
        "work_hours": list(range(4, 22)),   # 18-hour curing cycles
        "work_energy_factor": 1.5,
        "weekend_factor":     1.0,  # barns don't stop at weekends
        "anomaly_prob":       0.03,
        "seasonal_off_months": RAINY_MONTHS,   # barns dormant Nov-Mar
    },

    {   # 5 — Goromonzi Livestock Farm
        "facility_id":   "FAC-GLF",
        "facility_name": "Goromonzi Livestock & Dairy",
        "location":      "Goromonzi, Harare Province",
        "isic_code":     "A01",
        "description":   "Mixed cattle/dairy; manure management pits; enteric fermentation",
        "loadshed_group": 0,
        # Livestock: very high CH4, moderate CO2, low energy
        "co2_base":      520,  "co2_variance": 80,
        "ch4_base":      180,  "ch4_variance": 55,   # enteric + manure
        "temp_base":     24,   "temp_variance": 5,
        "humidity_base": 65,   "humidity_variance": 15,
        "energy_base":   28,   "energy_variance": 10,
        "work_hours": list(range(5, 20)),
        "work_energy_factor": 1.2,
        "weekend_factor":     0.95,
        "anomaly_prob":       0.02,
    },

    {   # 6 — Southerton Logistics Hub
        "facility_id":   "FAC-SLH",
        "facility_name": "Southerton Logistics & Warehousing",
        "location":      "Southerton Industrial, Harare",
        "isic_code":     "H49",
        "description":   "Diesel truck fleet, cold-storage, forklift charging",
        "loadshed_group": 1,
        # Diesel fleet: moderate CO2, low CH4, moderate energy
        "co2_base":      560,  "co2_variance": 100,
        "ch4_base":      2.8,  "ch4_variance": 0.8,
        "temp_base":     27,   "temp_variance": 4,
        "humidity_base": 48,   "humidity_variance": 10,
        "energy_base":   110,  "energy_variance": 30,
        "work_hours": list(range(5, 21)),
        "work_energy_factor": 1.5,
        "weekend_factor":     0.55,
        "anomaly_prob":       0.015,
    },

    {   # 7 — Chitungwiza Light Manufacturing
        "facility_id":   "FAC-CLM",
        "facility_name": "Chitungwiza Plastics & Light Manufacturing",
        "location":      "Chitungwiza Industrial, Harare Metro",
        "isic_code":     "C22",
        "description":   "Plastic extrusion, injection moulding; energy-intensive machinery",
        "loadshed_group": 2,
        "co2_base":      490,  "co2_variance": 90,
        "ch4_base":      2.2,  "ch4_variance": 0.6,
        "temp_base":     30,   "temp_variance": 4,
        "humidity_base": 44,   "humidity_variance": 9,
        "energy_base":   185,  "energy_variance": 50,
        "work_hours": list(range(6, 22)),
        "work_energy_factor": 1.55,
        "weekend_factor":     0.40,
        "anomaly_prob":       0.02,
    },
]


# ── Climate helpers ────────────────────────────────────────────────────────────

def is_rainy_season(month: int) -> bool:
    return month in RAINY_MONTHS

def harare_temp_base(month: int, hour: int) -> float:
    """Return ambient temperature base for Harare given month and hour."""
    # Monthly mean highs / lows (°C) from climate data
    monthly_mean = {
        1: 24, 2: 24, 3: 23, 4: 21, 5: 18,  6: 16,
        7: 16, 8: 18, 9: 22, 10: 25, 11: 24, 12: 24,
    }
    daily_range = {   # typical diurnal swing
        1: 8,  2: 8,  3: 8,  4: 10, 5: 12, 6: 13,
        7: 13, 8: 14, 9: 13, 10: 10, 11: 8, 12: 8,
    }
    base = monthly_mean[month]
    swing = daily_range[month]
    # Diurnal: coolest ~05:00, warmest ~14:00
    phase = (hour - 14) * (2 * math.pi / 24)
    return base + swing * 0.5 * math.cos(phase)

def harare_humidity_base(month: int, hour: int, temp: float) -> float:
    """Approximate relative humidity."""
    rainy = is_rainy_season(month)
    base = 72 if rainy else 42
    # Humidity inversely correlated with daytime heating
    base -= 0.4 * (temp - 20)
    return max(20, min(95, base))

def zesa_is_online(hour: int, loadshed_group: int) -> bool:
    """Return False during load-shedding hours for this facility group."""
    return hour not in LOADSHEDDING_SCHEDULES[loadshed_group]


# ── Per-facility generator ─────────────────────────────────────────────────────

def generate_facility_data(fac: dict, days: int = 60, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []

    # Start from days ago
    start_dt = datetime(2026, 1, 1) - timedelta(days=days)

    # Carry-over state for random walk
    state = {
        "co2":      fac["co2_base"],
        "ch4":      fac["ch4_base"],
        "temp":     fac["temp_base"],
        "humidity": fac["humidity_base"],
        "energy":   fac["energy_base"],
    }

    total_minutes = days * 24 * 60
    for i in range(0, total_minutes, 5):   # 5-minute intervals
        ts = start_dt + timedelta(minutes=i)
        hour  = ts.hour
        month = ts.month
        dow   = ts.weekday()   # 0=Mon … 6=Sun
        is_weekend = dow >= 5

        # Seasonal dormancy (e.g. tobacco barns off during rainy season)
        dormant = False
        if "seasonal_off_months" in fac and month in fac["seasonal_off_months"]:
            dormant = True

        # ZESA online/offline
        power_on = zesa_is_online(hour, fac["loadshed_group"])

        # ── Target values for this timestep ──────────────────────────────────
        ambient_temp = harare_temp_base(month, hour)
        is_work = hour in fac["work_hours"]
        energy_factor = (fac["work_energy_factor"] if is_work else 0.5)
        if is_weekend:
            energy_factor *= fac["weekend_factor"]
        if dormant:
            energy_factor *= 0.05
        if not power_on:
            energy_factor *= 0.10   # generators / minimal draw only

        target_energy = fac["energy_base"] * energy_factor

        # CO2 scales with energy + combustion
        activity = energy_factor
        target_co2 = (
            ATMOSPHERIC_CO2_PPM
            + (fac["co2_base"] - ATMOSPHERIC_CO2_PPM) * activity * ALTITUDE_COMBUSTION_ADJ
        )
        if not power_on:
            target_co2 = ATMOSPHERIC_CO2_PPM + 30   # generator exhaust only

        # CH4 mostly independent of power (fugitive / biological)
        target_ch4 = fac["ch4_base"] * (0.7 + 0.3 * activity)
        if dormant:
            target_ch4 = ATMOSPHERIC_CH4_PPM + 0.2

        target_temp = ambient_temp + (fac["temp_base"] - 25) * 0.3 * activity
        ambient_humidity = harare_humidity_base(month, hour, ambient_temp)
        target_humidity = ambient_humidity * (1 - 0.1 * activity)   # dries out with heat

        # ── Random walk towards targets ──────────────────────────────────────
        def walk(cur, tgt, step_frac, noise_frac):
            step = (tgt - cur) * step_frac + rng.normal(0, abs(tgt) * noise_frac)
            return cur + step

        state["co2"]      = walk(state["co2"],      target_co2,      0.12, 0.02)
        state["ch4"]      = walk(state["ch4"],       target_ch4,      0.10, 0.04)
        state["temp"]     = walk(state["temp"],      target_temp,     0.15, 0.005)
        state["humidity"] = walk(state["humidity"],  target_humidity, 0.12, 0.01)
        state["energy"]   = walk(state["energy"],    target_energy,   0.20, 0.03)

        # ── Anomaly injection ─────────────────────────────────────────────────
        anomaly = False
        if rng.random() < fac["anomaly_prob"]:
            anomaly = True
            spike = rng.choice(["co2", "ch4", "energy"])
            factor = rng.uniform(1.8, 3.5) if rng.random() > 0.3 else rng.uniform(0.2, 0.6)
            state[spike] *= factor

        # ── Clamp to physical limits ──────────────────────────────────────────
        co2     = float(np.clip(state["co2"],      350,   8000))
        ch4     = float(np.clip(state["ch4"],      1.5,   5000))
        temp    = float(np.clip(state["temp"],     -5,    55))
        hum     = float(np.clip(state["humidity"], 15,    98))
        energy  = float(np.clip(state["energy"],   0,     2000))

        rows.append({
            "timestamp":   ts.isoformat(),
            "facility_id": fac["facility_id"],
            "isic_code":   fac["isic_code"],
            "month":       month,
            "hour":        hour,
            "day_of_week": dow,
            "is_weekend":  int(is_weekend),
            "is_rainy_season": int(is_rainy_season(month)),
            "zesa_online": int(power_on),
            "dormant":     int(dormant),
            "co2_ppm":     round(co2, 2),
            "ch4_ppm":     round(ch4, 3),
            "temperature": round(temp, 2),
            "humidity":    round(hum, 2),
            "energy_kwh":  round(energy, 3),
            "anomaly":     int(anomaly),
        })

    return pd.DataFrame(rows)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=" * 62)
    print("  Harare Carbon Monitoring — Synthesized Dataset Generator")
    print("=" * 62)
    print(f"\n  Facilities : {len(HARARE_FACILITIES)}")
    print(f"  Period     : 60 days × 5-min intervals per facility")
    print(f"  Climate    : Harare (1483 m), rainy/dry seasonal patterns")
    print(f"  Grid EF    : {ZESA_GRID_EF_KG_KWH} kg CO2e/kWh (ZESA Zimbabwe)")
    print(f"  Load-shed  : 12-18 h/day rotated across 4 groups\n")

    all_dfs = []
    for idx, fac in enumerate(HARARE_FACILITIES, 1):
        print(f"  [{idx}/{len(HARARE_FACILITIES)}] Generating: {fac['facility_name']}")
        df = generate_facility_data(fac, days=60, seed=42 + idx)
        print(f"         -> {len(df):,} rows  |  "
              f"CO2 {df.co2_ppm.mean():.0f} ppm avg  |  "
              f"CH4 {df.ch4_ppm.mean():.1f} ppm avg  |  "
              f"Energy {df.energy_kwh.mean():.1f} kWh avg")
        all_dfs.append(df)

    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.sample(frac=1, random_state=42).reset_index(drop=True)

    out_path = "scripts/harare_training_data.csv"
    combined.to_csv(out_path, index=False)

    print(f"\n  Total rows : {len(combined):,}")
    print(f"  Saved to   : {out_path}")
    print("\n  Column summary:")
    print(combined.describe().to_string())
    print("\n  Done.")
    return combined


if __name__ == "__main__":
    main()
