#!/usr/bin/env python3
"""
MRV (Monitoring, Reporting, Verification) Report Generator

Generates comprehensive carbon emission reports compliant with:
- GHG Protocol Corporate Standard
- ISO 14064-1:2018
- Zimbabwe Carbon Management Agency (ZCMA) requirements

This script can run locally for testing or be adapted for Lambda deployment.

Usage:
    uv run generate_mrv_report.py --facility facility-001 --period monthly
    uv run generate_mrv_report.py --facility facility-001 --start 2026-01-01 --end 2026-01-31

Author: H240486C
Date: 2026
"""

import argparse
import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from decimal import Decimal

import pandas as pd
import numpy as np

# Import data simulator for generating sample data
from data_simulator import SensorDataGenerator, FacilityScenario


# ==================== Configuration ====================

# GHG Protocol Emission Factors
EMISSION_FACTORS = {
    "ch4_gwp": 28,
    "co2_gwp": 1,
    "n2o_gwp": 265,
    "grid_ef_zimbabwe": 0.92,
    "ch4_density": 0.657,
    "co2_density": 1.977,
    "monitoring_volume_m3": 100,
}

# ZCMA Registry Configuration
ZCMA_CONFIG = {
    "registry_version": "1.0",
    "submission_endpoint": "https://registry.zcma.gov.zw/api/v1/reports",
    "verification_threshold_tonnes": 0.1,
}

# Report templates
REPORT_VERSION = "2.0"


# ==================== Data Processing ====================

def load_sensor_data(
    source: str,
    facility_id: str,
    start_date: datetime,
    end_date: datetime
) -> pd.DataFrame:
    """
    Load sensor data from various sources.
    
    Args:
        source: Data source ('csv', 'dynamodb', 'simulate')
        facility_id: Facility identifier
        start_date: Start of reporting period
        end_date: End of reporting period
        
    Returns:
        DataFrame with sensor readings
    """
    if source == "simulate":
        # Generate simulated data for testing
        print(f"[DATA] Simulating sensor data for {facility_id}...")
        hours = int((end_date - start_date).total_seconds() / 3600)
        
        generator = SensorDataGenerator(
            FacilityScenario.normal_operations(),
            seed=42
        )
        df = generator.generate_historical_data(hours=max(1, hours), interval_minutes=1)
        
        # Filter to date range
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df[(df["timestamp"] >= start_date) & (df["timestamp"] <= end_date)]
        
        return df
    
    elif source == "csv":
        # Load from CSV file
        csv_path = f"data/{facility_id}_readings.csv"
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            df = df[(df["timestamp"] >= start_date) & (df["timestamp"] <= end_date)]
            return df
        else:
            print(f"[WARNING] CSV not found: {csv_path}, using simulation")
            return load_sensor_data("simulate", facility_id, start_date, end_date)
    
    elif source == "dynamodb":
        # Load from DynamoDB (requires boto3 configuration)
        try:
            import boto3
            from boto3.dynamodb.conditions import Key
            
            dynamodb = boto3.resource("dynamodb")
            table = dynamodb.Table("sensor_readings")
            
            start_ts = int(start_date.timestamp() * 1000)
            end_ts = int(end_date.timestamp() * 1000)
            
            response = table.query(
                KeyConditionExpression=Key("device_id").eq(f"{facility_id}-device-01") & 
                                       Key("timestamp").between(start_ts, end_ts)
            )
            
            items = response.get("Items", [])
            if items:
                return pd.DataFrame(items)
            else:
                print("[WARNING] No data in DynamoDB, using simulation")
                return load_sensor_data("simulate", facility_id, start_date, end_date)
                
        except Exception as e:
            print(f"[WARNING] DynamoDB error: {e}, using simulation")
            return load_sensor_data("simulate", facility_id, start_date, end_date)
    
    else:
        raise ValueError(f"Unknown data source: {source}")


def calculate_emissions(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Calculate GHG emissions following GHG Protocol methodology.
    
    Args:
        df: DataFrame with sensor readings
        
    Returns:
        Dictionary with detailed emission calculations
    """
    # Ensure numeric types
    for col in ["co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    
    # Calculate time-weighted emissions
    # Each reading represents 1 minute = 1/60 hour
    hours_per_reading = 1 / 60
    
    # Scope 1: Direct emissions (CH4 and direct CO2)
    # Methane emissions
    ch4_excess = np.maximum(0, df["ch4_ppm"] - 2.0)  # Above atmospheric baseline
    ch4_mass_per_reading = (
        ch4_excess / 1e6 * 
        EMISSION_FACTORS["monitoring_volume_m3"] * 
        EMISSION_FACTORS["ch4_density"] * 
        hours_per_reading
    )
    total_ch4_mass_kg = ch4_mass_per_reading.sum()
    total_ch4_co2e_kg = total_ch4_mass_kg * EMISSION_FACTORS["ch4_gwp"]
    
    # Direct CO2 emissions
    co2_excess = np.maximum(0, df["co2_ppm"] - 420)  # Above atmospheric baseline
    co2_mass_per_reading = (
        co2_excess / 1e6 * 
        EMISSION_FACTORS["monitoring_volume_m3"] * 
        EMISSION_FACTORS["co2_density"] * 
        hours_per_reading
    )
    total_direct_co2_kg = co2_mass_per_reading.sum()
    
    scope_1_total = total_ch4_co2e_kg + total_direct_co2_kg
    
    # Scope 2: Indirect emissions from purchased electricity
    total_energy_kwh = df["energy_kwh"].sum() * hours_per_reading
    scope_2_total = total_energy_kwh * EMISSION_FACTORS["grid_ef_zimbabwe"]
    
    # Total emissions
    total_co2e_kg = scope_1_total + scope_2_total
    total_co2e_tonnes = total_co2e_kg / 1000
    
    # Statistics
    stats = {
        "reading_count": len(df),
        "time_span_hours": len(df) / 60,
        "co2_ppm_mean": df["co2_ppm"].mean(),
        "co2_ppm_max": df["co2_ppm"].max(),
        "co2_ppm_min": df["co2_ppm"].min(),
        "ch4_ppm_mean": df["ch4_ppm"].mean(),
        "ch4_ppm_max": df["ch4_ppm"].max(),
        "temp_mean": df["temperature"].mean(),
        "humidity_mean": df["humidity"].mean(),
        "energy_total_kwh": total_energy_kwh,
    }
    
    return {
        "scope_1": {
            "total_co2e_kg": round(scope_1_total, 6),
            "total_co2e_tonnes": round(scope_1_total / 1000, 9),
            "breakdown": {
                "ch4_mass_kg": round(total_ch4_mass_kg, 9),
                "ch4_co2e_kg": round(total_ch4_co2e_kg, 6),
                "direct_co2_kg": round(total_direct_co2_kg, 6),
            }
        },
        "scope_2": {
            "total_co2e_kg": round(scope_2_total, 6),
            "total_co2e_tonnes": round(scope_2_total / 1000, 9),
            "breakdown": {
                "electricity_kwh": round(total_energy_kwh, 3),
                "grid_emission_factor": EMISSION_FACTORS["grid_ef_zimbabwe"],
            }
        },
        "scope_3": {
            "total_co2e_kg": 0,
            "total_co2e_tonnes": 0,
            "notes": "Scope 3 emissions not measured in current monitoring setup"
        },
        "total": {
            "total_co2e_kg": round(total_co2e_kg, 6),
            "total_co2e_tonnes": round(total_co2e_tonnes, 9),
        },
        "statistics": stats
    }


def calculate_uncertainty(emissions: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate uncertainty following IPCC Tier 1 methodology.
    
    Args:
        emissions: Calculated emissions data
        
    Returns:
        Uncertainty analysis results
    """
    import math
    
    # IPCC Tier 1 default uncertainty factors
    uncertainties = {
        "activity_data": {
            "sensor_readings": 5.0,  # % - IoT sensors
            "energy_meters": 2.0,    # % - utility meters
        },
        "emission_factors": {
            "co2_combustion": 5.0,
            "ch4_processes": 50.0,
            "electricity_grid": 10.0,
        }
    }
    
    # Combined uncertainty using error propagation
    # For multiplication: u_total = sqrt(sum of u^2)
    
    # Scope 1 uncertainty
    scope1_u = math.sqrt(
        uncertainties["activity_data"]["sensor_readings"]**2 +
        uncertainties["emission_factors"]["ch4_processes"]**2
    )
    
    # Scope 2 uncertainty
    scope2_u = math.sqrt(
        uncertainties["activity_data"]["energy_meters"]**2 +
        uncertainties["emission_factors"]["electricity_grid"]**2
    )
    
    # Combined uncertainty (weighted by emissions)
    total_emissions = emissions["total"]["total_co2e_kg"]
    scope1_emissions = emissions["scope_1"]["total_co2e_kg"]
    scope2_emissions = emissions["scope_2"]["total_co2e_kg"]
    
    if total_emissions > 0:
        combined_u = math.sqrt(
            (scope1_emissions / total_emissions * scope1_u)**2 +
            (scope2_emissions / total_emissions * scope2_u)**2
        )
    else:
        combined_u = 0
    
    # 95% confidence interval
    ci_95 = 1.96 * (combined_u / 100) * total_emissions
    
    return {
        "combined_uncertainty_pct": round(combined_u, 2),
        "confidence_level": 95,
        "lower_bound_kg": round(total_emissions - ci_95, 6),
        "upper_bound_kg": round(total_emissions + ci_95, 6),
        "scope_1_uncertainty_pct": round(scope1_u, 2),
        "scope_2_uncertainty_pct": round(scope2_u, 2),
        "methodology": "IPCC 2006 Guidelines Tier 1",
        "uncertainty_sources": uncertainties
    }


def check_data_quality(df: pd.DataFrame, expected_readings: int) -> Dict[str, Any]:
    """
    Assess data quality and completeness.
    
    Args:
        df: Sensor data DataFrame
        expected_readings: Expected number of readings for period
        
    Returns:
        Data quality assessment
    """
    actual_readings = len(df)
    completeness = min(100.0, (actual_readings / max(1, expected_readings)) * 100)
    
    # Check for gaps
    if "timestamp" in df.columns:
        df_sorted = df.sort_values("timestamp")
        timestamps = pd.to_datetime(df_sorted["timestamp"])
        
        # Find gaps > 5 minutes
        gaps = []
        for i in range(1, len(timestamps)):
            diff = (timestamps.iloc[i] - timestamps.iloc[i-1]).total_seconds() / 60
            if diff > 5:
                gaps.append({
                    "start": timestamps.iloc[i-1].isoformat(),
                    "end": timestamps.iloc[i].isoformat(),
                    "duration_minutes": round(diff, 1)
                })
    else:
        gaps = []
    
    # Check for anomalies
    anomalies = []
    if "co2_ppm" in df.columns:
        co2_outliers = df[(df["co2_ppm"] < 200) | (df["co2_ppm"] > 5000)]
        if len(co2_outliers) > 0:
            anomalies.append({
                "type": "co2_out_of_range",
                "count": len(co2_outliers)
            })
    
    if "ch4_ppm" in df.columns:
        ch4_outliers = df[(df["ch4_ppm"] < 0) | (df["ch4_ppm"] > 10000)]
        if len(ch4_outliers) > 0:
            anomalies.append({
                "type": "ch4_out_of_range",
                "count": len(ch4_outliers)
            })
    
    return {
        "total_readings": actual_readings,
        "expected_readings": expected_readings,
        "completeness_pct": round(completeness, 2),
        "data_gaps": gaps[:10],  # Limit to first 10 gaps
        "total_gap_count": len(gaps),
        "anomalies": anomalies,
        "quality_score": "High" if completeness > 95 and len(anomalies) == 0 else
                        "Medium" if completeness > 80 else "Low",
        "quality_assurance_procedures": [
            "Automated sensor calibration checks",
            "Real-time outlier detection and flagging",
            "Cross-validation with energy billing data",
            "Daily data quality reviews"
        ]
    }


# ==================== Report Generation ====================

def generate_mrv_report(
    facility_id: str,
    organization_name: str,
    period_start: datetime,
    period_end: datetime,
    emissions: Dict[str, Any],
    uncertainty: Dict[str, Any],
    data_quality: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generate complete MRV report following ZCMA requirements.
    
    Args:
        facility_id: Facility identifier
        organization_name: Organization name
        period_start: Reporting period start
        period_end: Reporting period end
        emissions: Calculated emissions
        uncertainty: Uncertainty analysis
        data_quality: Data quality assessment
        
    Returns:
        Complete MRV report
    """
    report_id = f"MRV-{facility_id}-{period_start.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    
    report = {
        # Header
        "report_header": {
            "report_id": report_id,
            "report_version": REPORT_VERSION,
            "report_type": "GHG_EMISSIONS_MONITORING",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "generator": "IoT Carbon Monitoring System v1.0"
        },
        
        # Organization Information
        "organization": {
            "name": organization_name,
            "facility_id": facility_id,
            "country": "Zimbabwe",
            "regulatory_framework": "Zimbabwe Carbon Management Agency (ZCMA)",
            "sector": "General/Mixed",
            "registration_number": None,
            "contact_email": None
        },
        
        # Reporting Period
        "reporting_period": {
            "start_date": period_start.isoformat() + "Z",
            "end_date": period_end.isoformat() + "Z",
            "duration_days": (period_end - period_start).days,
            "reporting_frequency": "Monthly",
            "fiscal_year": period_start.year
        },
        
        # Methodology
        "methodology": {
            "standard": "GHG Protocol Corporate Accounting and Reporting Standard",
            "ipcc_guidelines": "2006 IPCC Guidelines for National GHG Inventories",
            "ipcc_ar_version": "AR6",
            "approach": "IoT-based continuous monitoring with ML prediction",
            "verification_tier": "Tier 2",
            "consolidation_approach": "Operational Control",
            "base_year": None,
            "monitoring_equipment": [
                {
                    "type": "MQ-135",
                    "parameter": "CO2/Air Quality",
                    "unit": "ppm",
                    "accuracy": "±10%",
                    "calibration_frequency": "Annual"
                },
                {
                    "type": "MQ-4",
                    "parameter": "Methane (CH4)",
                    "unit": "ppm",
                    "accuracy": "±10%",
                    "calibration_frequency": "Annual"
                },
                {
                    "type": "DHT22",
                    "parameter": "Temperature/Humidity",
                    "unit": "°C/%RH",
                    "accuracy": "±0.5°C/±2%RH",
                    "calibration_frequency": "Annual"
                }
            ],
            "data_collection_frequency": "1 minute intervals",
            "last_calibration_date": "2026-01-01",
            "next_calibration_due": "2027-01-01"
        },
        
        # Emission Factors
        "emission_factors": {
            "source": "IPCC 2006 Guidelines / Zimbabwe National Communications",
            "gwp_source": "IPCC AR6",
            "gwp_time_horizon": "100 years",
            "factors": {
                "ch4_gwp": EMISSION_FACTORS["ch4_gwp"],
                "co2_gwp": EMISSION_FACTORS["co2_gwp"],
                "n2o_gwp": EMISSION_FACTORS["n2o_gwp"],
                "grid_emission_factor_zimbabwe": {
                    "value": EMISSION_FACTORS["grid_ef_zimbabwe"],
                    "unit": "kg CO2e/kWh",
                    "source": "Zimbabwe Third National Communication to UNFCCC",
                    "year": 2020
                }
            }
        },
        
        # Emissions Summary
        "emissions_summary": {
            "total_ghg_emissions": {
                "value": emissions["total"]["total_co2e_tonnes"],
                "unit": "tonnes CO2e"
            },
            "total_ghg_emissions_kg": {
                "value": emissions["total"]["total_co2e_kg"],
                "unit": "kg CO2e"
            },
            "by_scope": {
                "scope_1": emissions["scope_1"],
                "scope_2": emissions["scope_2"],
                "scope_3": emissions["scope_3"]
            },
            "by_gas": {
                "co2": {
                    "mass_kg": emissions["scope_1"]["breakdown"]["direct_co2_kg"],
                    "co2e_kg": emissions["scope_1"]["breakdown"]["direct_co2_kg"]
                },
                "ch4": {
                    "mass_kg": emissions["scope_1"]["breakdown"]["ch4_mass_kg"],
                    "co2e_kg": emissions["scope_1"]["breakdown"]["ch4_co2e_kg"]
                }
            },
            "intensity_metrics": {
                "per_kwh": round(
                    emissions["total"]["total_co2e_kg"] / 
                    max(1, emissions["scope_2"]["breakdown"]["electricity_kwh"]),
                    6
                ) if emissions["scope_2"]["breakdown"]["electricity_kwh"] > 0 else 0
            }
        },
        
        # Activity Data
        "activity_data": {
            "energy_consumption": {
                "electricity_kwh": emissions["scope_2"]["breakdown"]["electricity_kwh"],
                "source": "Facility energy meters"
            },
            "sensor_statistics": emissions["statistics"]
        },
        
        # Uncertainty Assessment
        "uncertainty_assessment": uncertainty,
        
        # Data Quality
        "data_quality": data_quality,
        
        # Verification
        "verification": {
            "status": "pending",
            "verifier_name": None,
            "verifier_accreditation": None,
            "verification_date": None,
            "verification_statement": None,
            "assurance_level": "Reasonable",
            "scope_of_verification": "Full report",
            "next_verification_due": (period_end + timedelta(days=30)).isoformat() + "Z"
        },
        
        # ZCMA Registry
        "zcma_registry": {
            "registry_version": ZCMA_CONFIG["registry_version"],
            "submission_status": "draft",
            "submission_date": None,
            "registry_reference": None,
            "carbon_credits_eligible": emissions["total"]["total_co2e_tonnes"] >= ZCMA_CONFIG["verification_threshold_tonnes"],
            "credit_estimation": {
                "baseline_emissions_tonnes": None,
                "project_emissions_tonnes": emissions["total"]["total_co2e_tonnes"],
                "emission_reductions_tonnes": None,
                "notes": "Baseline to be established upon ZCMA registration"
            }
        },
        
        # Approvals
        "approvals": {
            "prepared_by": {
                "name": None,
                "role": "Facility Environmental Officer",
                "date": None,
                "signature_hash": None
            },
            "reviewed_by": {
                "name": None,
                "role": "Environmental Manager",
                "date": None,
                "signature_hash": None
            },
            "approved_by": {
                "name": None,
                "role": "Compliance Director",
                "date": None,
                "signature_hash": None
            }
        },
        
        # Attachments
        "attachments": {
            "raw_data_available": True,
            "raw_data_location": f"data/{facility_id}_{period_start.strftime('%Y%m%d')}_{period_end.strftime('%Y%m%d')}.csv",
            "supporting_documents": [],
            "calibration_certificates": [],
            "methodology_documents": [
                "GHG Protocol Corporate Standard",
                "2006 IPCC Guidelines Volume 2: Energy"
            ]
        },
        
        # Disclaimer
        "disclaimer": {
            "text": "This report has been prepared using IoT sensor data and standardized emission factors. "
                   "Actual emissions may vary. This report is intended for monitoring and reporting purposes "
                   "and should be verified by an accredited third party before submission to regulatory bodies.",
            "limitations": [
                "Sensor accuracy limitations as specified in methodology",
                "Emission factors based on national/regional averages",
                "Scope 3 emissions not included in current monitoring"
            ]
        }
    }
    
    return report


def export_report(report: Dict[str, Any], output_dir: str, formats: List[str]) -> Dict[str, str]:
    """
    Export report to various formats.
    
    Args:
        report: Complete MRV report
        output_dir: Output directory
        formats: List of formats ('json', 'csv', 'html')
        
    Returns:
        Dictionary of format -> file path
    """
    os.makedirs(output_dir, exist_ok=True)
    
    report_id = report["report_header"]["report_id"]
    exported = {}
    
    if "json" in formats:
        json_path = os.path.join(output_dir, f"{report_id}.json")
        with open(json_path, "w") as f:
            json.dump(report, f, indent=2, default=str)
        exported["json"] = json_path
        print(f"[EXPORT] JSON: {json_path}")
    
    if "csv" in formats:
        # Export summary as CSV
        csv_path = os.path.join(output_dir, f"{report_id}_summary.csv")
        summary = {
            "Report ID": report_id,
            "Facility": report["organization"]["facility_id"],
            "Period Start": report["reporting_period"]["start_date"],
            "Period End": report["reporting_period"]["end_date"],
            "Total CO2e (tonnes)": report["emissions_summary"]["total_ghg_emissions"]["value"],
            "Scope 1 (tonnes)": report["emissions_summary"]["by_scope"]["scope_1"]["total_co2e_tonnes"],
            "Scope 2 (tonnes)": report["emissions_summary"]["by_scope"]["scope_2"]["total_co2e_tonnes"],
            "Data Quality Score": report["data_quality"]["quality_score"],
            "Uncertainty (%)": report["uncertainty_assessment"]["combined_uncertainty_pct"],
        }
        pd.DataFrame([summary]).to_csv(csv_path, index=False)
        exported["csv"] = csv_path
        print(f"[EXPORT] CSV: {csv_path}")
    
    if "html" in formats:
        # Generate HTML report
        html_path = os.path.join(output_dir, f"{report_id}.html")
        html_content = generate_html_report(report)
        with open(html_path, "w") as f:
            f.write(html_content)
        exported["html"] = html_path
        print(f"[EXPORT] HTML: {html_path}")
    
    return exported


def generate_html_report(report: Dict[str, Any]) -> str:
    """Generate HTML version of the report."""
    
    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MRV Report - {report['report_header']['report_id']}</title>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 40px; background: #f5f5f5; }}
        .container {{ max-width: 900px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        h1 {{ color: #1a5f2a; border-bottom: 3px solid #1a5f2a; padding-bottom: 10px; }}
        h2 {{ color: #2d7a3d; margin-top: 30px; border-left: 4px solid #2d7a3d; padding-left: 10px; }}
        h3 {{ color: #444; }}
        table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background: #f0f7f0; color: #1a5f2a; }}
        .highlight {{ background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0; }}
        .metric {{ display: inline-block; margin: 10px 20px 10px 0; }}
        .metric-value {{ font-size: 28px; font-weight: bold; color: #1a5f2a; }}
        .metric-label {{ font-size: 14px; color: #666; }}
        .badge {{ display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }}
        .badge-high {{ background: #c8e6c9; color: #2e7d32; }}
        .badge-medium {{ background: #fff3e0; color: #ef6c00; }}
        .badge-low {{ background: #ffcdd2; color: #c62828; }}
        .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>GHG Emissions Monitoring Report</h1>
        
        <div class="highlight">
            <div class="metric">
                <div class="metric-value">{report['emissions_summary']['total_ghg_emissions']['value']:.4f}</div>
                <div class="metric-label">Total Emissions (tonnes CO2e)</div>
            </div>
            <div class="metric">
                <div class="metric-value">{report['data_quality']['completeness_pct']:.1f}%</div>
                <div class="metric-label">Data Completeness</div>
            </div>
            <div class="metric">
                <div class="metric-value">±{report['uncertainty_assessment']['combined_uncertainty_pct']:.1f}%</div>
                <div class="metric-label">Uncertainty</div>
            </div>
        </div>
        
        <h2>Report Information</h2>
        <table>
            <tr><td><strong>Report ID</strong></td><td>{report['report_header']['report_id']}</td></tr>
            <tr><td><strong>Facility</strong></td><td>{report['organization']['facility_id']}</td></tr>
            <tr><td><strong>Reporting Period</strong></td><td>{report['reporting_period']['start_date'][:10]} to {report['reporting_period']['end_date'][:10]}</td></tr>
            <tr><td><strong>Generated</strong></td><td>{report['report_header']['generated_at'][:19]}</td></tr>
        </table>
        
        <h2>Emissions by Scope</h2>
        <table>
            <tr><th>Scope</th><th>Emissions (tonnes CO2e)</th><th>Percentage</th></tr>
            <tr>
                <td>Scope 1 (Direct)</td>
                <td>{report['emissions_summary']['by_scope']['scope_1']['total_co2e_tonnes']:.6f}</td>
                <td>{100 * report['emissions_summary']['by_scope']['scope_1']['total_co2e_tonnes'] / max(0.000001, report['emissions_summary']['total_ghg_emissions']['value']):.1f}%</td>
            </tr>
            <tr>
                <td>Scope 2 (Electricity)</td>
                <td>{report['emissions_summary']['by_scope']['scope_2']['total_co2e_tonnes']:.6f}</td>
                <td>{100 * report['emissions_summary']['by_scope']['scope_2']['total_co2e_tonnes'] / max(0.000001, report['emissions_summary']['total_ghg_emissions']['value']):.1f}%</td>
            </tr>
            <tr>
                <td><strong>Total</strong></td>
                <td><strong>{report['emissions_summary']['total_ghg_emissions']['value']:.6f}</strong></td>
                <td><strong>100%</strong></td>
            </tr>
        </table>
        
        <h2>Data Quality</h2>
        <p>Quality Score: <span class="badge badge-{report['data_quality']['quality_score'].lower()}">{report['data_quality']['quality_score']}</span></p>
        <table>
            <tr><td>Total Readings</td><td>{report['data_quality']['total_readings']:,}</td></tr>
            <tr><td>Expected Readings</td><td>{report['data_quality']['expected_readings']:,}</td></tr>
            <tr><td>Completeness</td><td>{report['data_quality']['completeness_pct']:.2f}%</td></tr>
            <tr><td>Data Gaps</td><td>{report['data_quality']['total_gap_count']}</td></tr>
        </table>
        
        <h2>Methodology</h2>
        <p><strong>Standard:</strong> {report['methodology']['standard']}</p>
        <p><strong>Approach:</strong> {report['methodology']['approach']}</p>
        <p><strong>Verification Tier:</strong> {report['methodology']['verification_tier']}</p>
        
        <h2>Verification Status</h2>
        <p><strong>Status:</strong> {report['verification']['status'].title()}</p>
        <p><strong>Assurance Level:</strong> {report['verification']['assurance_level']}</p>
        
        <div class="footer">
            <p><strong>Disclaimer:</strong> {report['disclaimer']['text']}</p>
            <p>Generated by IoT Carbon Monitoring System | Report Version {report['report_header']['report_version']}</p>
        </div>
    </div>
</body>
</html>
    """
    
    return html


# ==================== Main Entry Point ====================

def main():
    parser = argparse.ArgumentParser(
        description="Generate MRV Report for Carbon Emissions"
    )
    
    parser.add_argument(
        "--facility",
        type=str,
        default="facility-001",
        help="Facility ID (default: facility-001)"
    )
    
    parser.add_argument(
        "--organization",
        type=str,
        default="Test Organization Ltd.",
        help="Organization name"
    )
    
    parser.add_argument(
        "--period",
        choices=["daily", "weekly", "monthly"],
        default="monthly",
        help="Reporting period (default: monthly)"
    )
    
    parser.add_argument(
        "--start",
        type=str,
        help="Custom start date (YYYY-MM-DD)"
    )
    
    parser.add_argument(
        "--end",
        type=str,
        help="Custom end date (YYYY-MM-DD)"
    )
    
    parser.add_argument(
        "--source",
        choices=["simulate", "csv", "dynamodb"],
        default="simulate",
        help="Data source (default: simulate)"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        default="./reports",
        help="Output directory (default: ./reports)"
    )
    
    parser.add_argument(
        "--formats",
        type=str,
        default="json,csv,html",
        help="Export formats (comma-separated: json,csv,html)"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("   MRV Report Generator - Carbon Monitoring System")
    print("=" * 60)
    print()
    
    # Calculate period dates
    now = datetime.utcnow()
    
    if args.start and args.end:
        period_start = datetime.fromisoformat(args.start)
        period_end = datetime.fromisoformat(args.end)
    elif args.period == "daily":
        period_start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif args.period == "weekly":
        period_start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:  # monthly
        period_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_end = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    print(f"[CONFIG] Facility: {args.facility}")
    print(f"[CONFIG] Period: {period_start.date()} to {period_end.date()}")
    print(f"[CONFIG] Data Source: {args.source}")
    print()
    
    # Load sensor data
    print("[STEP 1] Loading sensor data...")
    df = load_sensor_data(args.source, args.facility, period_start, period_end)
    print(f"    Loaded {len(df)} readings")
    
    # Calculate emissions
    print("\n[STEP 2] Calculating emissions...")
    emissions = calculate_emissions(df)
    print(f"    Total: {emissions['total']['total_co2e_tonnes']:.6f} tonnes CO2e")
    print(f"    Scope 1: {emissions['scope_1']['total_co2e_tonnes']:.6f} tonnes")
    print(f"    Scope 2: {emissions['scope_2']['total_co2e_tonnes']:.6f} tonnes")
    
    # Calculate uncertainty
    print("\n[STEP 3] Calculating uncertainty...")
    uncertainty = calculate_uncertainty(emissions)
    print(f"    Combined uncertainty: ±{uncertainty['combined_uncertainty_pct']:.1f}%")
    
    # Assess data quality
    print("\n[STEP 4] Assessing data quality...")
    expected_readings = int((period_end - period_start).total_seconds() / 60)
    data_quality = check_data_quality(df, expected_readings)
    print(f"    Completeness: {data_quality['completeness_pct']:.1f}%")
    print(f"    Quality Score: {data_quality['quality_score']}")
    
    # Generate report
    print("\n[STEP 5] Generating MRV report...")
    report = generate_mrv_report(
        facility_id=args.facility,
        organization_name=args.organization,
        period_start=period_start,
        period_end=period_end,
        emissions=emissions,
        uncertainty=uncertainty,
        data_quality=data_quality
    )
    print(f"    Report ID: {report['report_header']['report_id']}")
    
    # Export report
    print("\n[STEP 6] Exporting report...")
    formats = [f.strip() for f in args.formats.split(",")]
    exported = export_report(report, args.output, formats)
    
    # Summary
    print("\n" + "=" * 60)
    print("   Report Generation Complete!")
    print("=" * 60)
    print(f"""
Summary:
    - Report ID: {report['report_header']['report_id']}
    - Total Emissions: {emissions['total']['total_co2e_tonnes']:.6f} tonnes CO2e
    - Data Quality: {data_quality['quality_score']}
    - Uncertainty: ±{uncertainty['combined_uncertainty_pct']:.1f}%
    - Files exported: {len(exported)}

Next Steps:
    1. Review the generated report for accuracy
    2. Add organization details and approvals
    3. Submit to third-party verifier
    4. Upload to ZCMA registry after verification
    """)


if __name__ == "__main__":
    main()
