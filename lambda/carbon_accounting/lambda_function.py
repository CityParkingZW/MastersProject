"""
Carbon Accounting Lambda Function

This Lambda function:
1. Aggregates emission predictions over configurable periods
2. Converts verified IoT data to CO2-equivalent emissions
3. Generates MRV (Monitoring, Reporting, Verification) compliant reports
4. Creates reports compatible with ZCMA (Zimbabwe Carbon Management Agency) registry

Trigger: Scheduled CloudWatch Event (daily/weekly/monthly) or API Gateway

Author: H240486C
Date: 2026
"""

import json
import os
import uuid
import boto3
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, Any, List, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

# Configuration
TABLE_PREDICTIONS = os.environ.get("TABLE_PREDICTIONS", "emission_predictions")
TABLE_SENSOR_READINGS = os.environ.get("TABLE_SENSOR_READINGS", "sensor_readings")
TABLE_MRV_REPORTS = os.environ.get("TABLE_MRV_REPORTS", "mrv_reports")
REPORT_BUCKET = os.environ.get("REPORT_BUCKET", "carbon-monitor-reports")

# GHG Protocol and ZCMA Compliance Constants
GHG_PROTOCOL_VERSION = "2006 IPCC Guidelines"
ZCMA_REGISTRY_VERSION = "1.0"
IPCC_AR_VERSION = "AR6"

# Emission factors (should match carbon_predictor)
EMISSION_FACTORS = {
    "ch4_gwp": 28,
    "co2_gwp": 1,
    "n2o_gwp": 265,
    "grid_ef_zimbabwe": 0.92,
}


def decimal_to_float(obj):
    """Convert Decimal objects to float for JSON serialization."""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


def get_predictions_for_period(
    facility_id: str,
    start_date: datetime,
    end_date: datetime
) -> List[Dict[str, Any]]:
    """
    Retrieve all predictions for a facility within a time period.
    
    Args:
        facility_id: Facility identifier
        start_date: Period start
        end_date: Period end
        
    Returns:
        List of prediction records
    """
    table = dynamodb.Table(TABLE_PREDICTIONS)
    
    # Note: This is a simplified query. In production, you'd need a GSI on facility_id
    # or use device_id pattern matching
    
    start_ts = int(start_date.timestamp() * 1000)
    end_ts = int(end_date.timestamp() * 1000)
    
    predictions = []
    
    # Scan with filter (not efficient for large datasets, use GSI in production)
    response = table.scan(
        FilterExpression="#ts BETWEEN :start AND :end",
        ExpressionAttributeNames={"#ts": "timestamp"},
        ExpressionAttributeValues={
            ":start": start_ts,
            ":end": end_ts
        }
    )
    
    predictions.extend(response.get("Items", []))
    
    # Handle pagination
    while "LastEvaluatedKey" in response:
        response = table.scan(
            FilterExpression="#ts BETWEEN :start AND :end",
            ExpressionAttributeNames={"#ts": "timestamp"},
            ExpressionAttributeValues={
                ":start": start_ts,
                ":end": end_ts
            },
            ExclusiveStartKey=response["LastEvaluatedKey"]
        )
        predictions.extend(response.get("Items", []))
    
    return [decimal_to_float(p) for p in predictions]


def aggregate_emissions(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Aggregate emission predictions into totals and statistics.
    
    Args:
        predictions: List of prediction records
        
    Returns:
        Aggregated emission data
    """
    if not predictions:
        return {
            "total_co2e_kg": 0,
            "total_co2e_tonnes": 0,
            "breakdown": {
                "ch4_co2e_kg": 0,
                "direct_co2_kg": 0,
                "energy_co2e_kg": 0
            },
            "statistics": {
                "count": 0,
                "mean_co2e_kg": 0,
                "max_co2e_kg": 0,
                "min_co2e_kg": 0
            }
        }
    
    # Extract values
    co2e_values = []
    ch4_total = 0
    direct_total = 0
    energy_total = 0
    
    for pred in predictions:
        details = pred.get("prediction_details", pred)
        
        co2e = details.get("total_co2e_kg", 0)
        co2e_values.append(co2e)
        
        ch4_total += details.get("ch4_co2e_kg", 0)
        direct_total += details.get("direct_co2_kg", 0)
        energy_total += details.get("energy_co2e_kg", 0)
    
    total_co2e_kg = sum(co2e_values)
    
    return {
        "total_co2e_kg": round(total_co2e_kg, 3),
        "total_co2e_tonnes": round(total_co2e_kg / 1000, 6),
        "breakdown": {
            "ch4_co2e_kg": round(ch4_total, 3),
            "direct_co2_kg": round(direct_total, 3),
            "energy_co2e_kg": round(energy_total, 3)
        },
        "statistics": {
            "count": len(co2e_values),
            "mean_co2e_kg": round(sum(co2e_values) / len(co2e_values), 6),
            "max_co2e_kg": round(max(co2e_values), 6),
            "min_co2e_kg": round(min(co2e_values), 6)
        },
        "scope_breakdown": {
            "scope_1": round(ch4_total + direct_total, 3),  # Direct emissions
            "scope_2": round(energy_total, 3),  # Indirect energy emissions
            "scope_3": 0  # Other indirect (not measured)
        }
    }


def calculate_uncertainty(predictions: List[Dict[str, Any]], aggregation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate uncertainty following GHG Protocol guidelines.
    
    Args:
        predictions: List of prediction records
        aggregation: Aggregated emission data
        
    Returns:
        Uncertainty analysis
    """
    import math
    
    # Tier 1 default uncertainty factors (simplified)
    activity_data_uncertainty = 5.0  # % for IoT sensor data
    emission_factor_uncertainty = 10.0  # % for standard EFs
    
    # Combined uncertainty (error propagation)
    combined_uncertainty = math.sqrt(
        activity_data_uncertainty**2 + emission_factor_uncertainty**2
    )
    
    # 95% confidence interval
    total_co2e = aggregation["total_co2e_kg"]
    uncertainty_range = total_co2e * (combined_uncertainty / 100) * 1.96
    
    return {
        "combined_uncertainty_pct": round(combined_uncertainty, 2),
        "confidence_level": 95,
        "lower_bound_kg": round(total_co2e - uncertainty_range, 3),
        "upper_bound_kg": round(total_co2e + uncertainty_range, 3),
        "uncertainty_sources": {
            "activity_data": activity_data_uncertainty,
            "emission_factors": emission_factor_uncertainty
        },
        "methodology": "IPCC 2006 Guidelines Tier 1"
    }


def generate_mrv_report(
    facility_id: str,
    period_start: datetime,
    period_end: datetime,
    predictions: List[Dict[str, Any]],
    aggregation: Dict[str, Any],
    uncertainty: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generate MRV-compliant report for ZCMA registry.
    
    Args:
        facility_id: Facility identifier
        period_start: Reporting period start
        period_end: Reporting period end
        predictions: Raw prediction data
        aggregation: Aggregated emissions
        uncertainty: Uncertainty analysis
        
    Returns:
        Complete MRV report
    """
    report_id = f"MRV-{facility_id}-{period_start.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
    
    report = {
        "report_id": report_id,
        "report_version": "1.0",
        "report_type": "emissions_monitoring",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        
        # Facility Information
        "facility": {
            "facility_id": facility_id,
            "country": "Zimbabwe",
            "regulatory_framework": "Zimbabwe Carbon Management Agency (ZCMA)",
            "registration_status": "pending_verification"
        },
        
        # Reporting Period
        "reporting_period": {
            "start_date": period_start.isoformat() + "Z",
            "end_date": period_end.isoformat() + "Z",
            "duration_days": (period_end - period_start).days
        },
        
        # Monitoring Methodology
        "methodology": {
            "framework": GHG_PROTOCOL_VERSION,
            "ipcc_version": IPCC_AR_VERSION,
            "monitoring_approach": "IoT-based continuous monitoring",
            "verification_tier": "Tier 2",
            "sensors_used": [
                {"type": "MQ-135", "parameter": "CO2", "unit": "ppm"},
                {"type": "MQ-4", "parameter": "CH4", "unit": "ppm"},
                {"type": "DHT22", "parameter": "Temperature", "unit": "°C"},
                {"type": "DHT22", "parameter": "Humidity", "unit": "%"}
            ],
            "data_collection_frequency": "1 minute intervals",
            "calibration_date": "2026-01-01",
            "calibration_due": "2027-01-01"
        },
        
        # Emission Factors Used
        "emission_factors": {
            "source": "IPCC 2006 Guidelines",
            "ch4_gwp": EMISSION_FACTORS["ch4_gwp"],
            "co2_gwp": EMISSION_FACTORS["co2_gwp"],
            "grid_emission_factor": {
                "value": EMISSION_FACTORS["grid_ef_zimbabwe"],
                "unit": "kg CO2e/kWh",
                "source": "Zimbabwe National Inventory Report"
            }
        },
        
        # Emissions Summary
        "emissions_summary": {
            "total_ghg_emissions": {
                "value": aggregation["total_co2e_tonnes"],
                "unit": "tonnes CO2e"
            },
            "total_ghg_emissions_kg": {
                "value": aggregation["total_co2e_kg"],
                "unit": "kg CO2e"
            },
            "breakdown_by_gas": {
                "co2": {
                    "value": aggregation["breakdown"]["direct_co2_kg"] / 1000,
                    "unit": "tonnes"
                },
                "ch4": {
                    "value": aggregation["breakdown"]["ch4_co2e_kg"] / 1000 / EMISSION_FACTORS["ch4_gwp"],
                    "unit": "tonnes",
                    "co2e": aggregation["breakdown"]["ch4_co2e_kg"] / 1000
                }
            },
            "breakdown_by_scope": aggregation["scope_breakdown"],
            "breakdown_by_source": aggregation["breakdown"]
        },
        
        # Data Quality
        "data_quality": {
            "total_readings": aggregation["statistics"]["count"],
            "data_completeness_pct": min(100, aggregation["statistics"]["count"] / ((period_end - period_start).days * 24 * 60) * 100),
            "data_gaps": [],
            "quality_assurance_procedures": [
                "Automated sensor calibration checks",
                "Outlier detection and flagging",
                "Cross-validation with energy bills",
                "Monthly data quality reviews"
            ]
        },
        
        # Uncertainty Assessment
        "uncertainty_assessment": uncertainty,
        
        # Verification Status
        "verification": {
            "status": "pending",
            "verifier": None,
            "verification_date": None,
            "verification_statement": None,
            "assurance_level": "reasonable",
            "next_verification_due": (period_end + timedelta(days=30)).isoformat() + "Z"
        },
        
        # ZCMA Registry Fields
        "zcma_registry": {
            "registry_version": ZCMA_REGISTRY_VERSION,
            "submission_status": "draft",
            "submission_date": None,
            "registry_reference": None,
            "carbon_credits_eligible": aggregation["total_co2e_tonnes"] >= 0.1,
            "credit_estimation": {
                "baseline_emissions_tonnes": None,  # To be determined
                "project_emissions_tonnes": aggregation["total_co2e_tonnes"],
                "emission_reductions_tonnes": None  # Baseline - Project
            }
        },
        
        # Signatures and Approvals
        "approvals": {
            "prepared_by": {
                "name": None,
                "role": "Facility Manager",
                "date": None,
                "signature": None
            },
            "reviewed_by": {
                "name": None,
                "role": "Environmental Officer",
                "date": None,
                "signature": None
            },
            "approved_by": {
                "name": None,
                "role": "Compliance Manager",
                "date": None,
                "signature": None
            }
        },
        
        # Attachments
        "attachments": {
            "raw_data_reference": f"s3://{REPORT_BUCKET}/raw_data/{report_id}.csv",
            "supporting_documents": []
        }
    }
    
    return report


def store_mrv_report(report: Dict[str, Any]):
    """
    Store MRV report in DynamoDB and S3.
    
    Args:
        report: Complete MRV report
    """
    # Store in DynamoDB
    table = dynamodb.Table(TABLE_MRV_REPORTS)
    
    # Convert for DynamoDB
    def convert_to_decimal(obj):
        if isinstance(obj, float):
            return Decimal(str(round(obj, 9)))
        elif isinstance(obj, dict):
            return {k: convert_to_decimal(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_decimal(i) for i in obj]
        return obj
    
    dynamodb_item = convert_to_decimal(report)
    table.put_item(Item=dynamodb_item)
    
    logger.info(f"Stored report {report['report_id']} in DynamoDB")
    
    # Store JSON in S3
    try:
        s3.put_object(
            Bucket=REPORT_BUCKET,
            Key=f"reports/{report['report_id']}.json",
            Body=json.dumps(report, indent=2, default=str),
            ContentType="application/json"
        )
        logger.info(f"Stored report {report['report_id']} in S3")
    except Exception as e:
        logger.warning(f"Could not store report in S3: {e}")


def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Main Lambda handler for carbon accounting.
    
    Args:
        event: Event data containing:
            - facility_id: Facility to generate report for
            - period_type: 'daily', 'weekly', 'monthly', or 'custom'
            - start_date: Optional custom start date (ISO format)
            - end_date: Optional custom end date (ISO format)
        context: Lambda context
        
    Returns:
        Generated MRV report
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Parse input
        if "body" in event:
            params = json.loads(event["body"])
        else:
            params = event
        
        facility_id = params.get("facility_id", "facility-001")
        period_type = params.get("period_type", "daily")
        
        # Calculate period dates
        now = datetime.utcnow()
        
        if period_type == "daily":
            period_start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period_type == "weekly":
            period_start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
            period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period_type == "monthly":
            period_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            period_end = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            # Custom period
            period_start = datetime.fromisoformat(params["start_date"].replace("Z", ""))
            period_end = datetime.fromisoformat(params["end_date"].replace("Z", ""))
        
        logger.info(f"Generating report for {facility_id}: {period_start} to {period_end}")
        
        # Get predictions for period
        predictions = get_predictions_for_period(facility_id, period_start, period_end)
        logger.info(f"Retrieved {len(predictions)} predictions")
        
        # Aggregate emissions
        aggregation = aggregate_emissions(predictions)
        
        # Calculate uncertainty
        uncertainty = calculate_uncertainty(predictions, aggregation)
        
        # Generate MRV report
        report = generate_mrv_report(
            facility_id=facility_id,
            period_start=period_start,
            period_end=period_end,
            predictions=predictions,
            aggregation=aggregation,
            uncertainty=uncertainty
        )
        
        # Store report
        store_mrv_report(report)
        
        logger.info(f"Generated report {report['report_id']}: {aggregation['total_co2e_tonnes']:.4f} tonnes CO2e")
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": json.dumps({
                "success": True,
                "report": report
            }, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error generating report: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": str(e)
            })
        }


# For local testing
if __name__ == "__main__":
    test_event = {
        "facility_id": "facility-001",
        "period_type": "daily"
    }
    
    class MockContext:
        function_name = "carbon_accounting"
        memory_limit_in_mb = 256
    
    result = lambda_handler(test_event, MockContext())
    print(json.dumps(json.loads(result["body"]), indent=2, default=str))
