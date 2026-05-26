#!/usr/bin/env python3
"""
AWS IoT Core Setup Script

Automates the creation of:
- IoT Things
- Certificates and Keys
- IoT Policies
- DynamoDB Tables
- IoT Rules for data routing

Prerequisites:
- AWS CLI configured with appropriate credentials
- boto3 installed

Usage:
    uv run setup_aws_iot.py --region us-east-1

Author: H240486C
Date: 2026
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Dict, Any, Optional

import boto3
from botocore.exceptions import ClientError


# ==================== Configuration ====================

PROJECT_NAME = "carbon-monitor"
DEVICE_NAME = "carbon-monitor-device-01"
FACILITY_ID = "facility-001"

# DynamoDB table names
TABLE_SENSOR_READINGS = "sensor_readings"
TABLE_EMISSION_PREDICTIONS = "emission_predictions"
TABLE_MRV_REPORTS = "mrv_reports"

# MQTT Topics
TOPIC_RAW = "facility/sensors/raw"
TOPIC_PROCESSED = "facility/sensors/processed"
TOPIC_PREDICTIONS = "facility/emissions/predictions"

# Certificate output directory
CERT_DIR = "../certs"


# ==================== IoT Setup Functions ====================

class AWSIoTSetup:
    """Handles AWS IoT Core resource creation."""
    
    def __init__(self, region: str):
        """
        Initialize AWS clients.
        
        Args:
            region: AWS region to use
        """
        self.region = region
        self.iot = boto3.client("iot", region_name=region)
        self.dynamodb = boto3.client("dynamodb", region_name=region)
        self.iam = boto3.client("iam", region_name=region)
        self.lambda_client = boto3.client("lambda", region_name=region)
        
        # Get account ID
        sts = boto3.client("sts", region_name=region)
        self.account_id = sts.get_caller_identity()["Account"]
        
        print(f"[AWS] Region: {region}")
        print(f"[AWS] Account ID: {self.account_id}")
    
    def create_thing(self, thing_name: str) -> Dict[str, Any]:
        """
        Create an IoT Thing.
        
        Args:
            thing_name: Name of the thing to create
            
        Returns:
            Thing creation response
        """
        print(f"[IoT] Creating thing: {thing_name}")
        
        try:
            # Check if thing already exists
            self.iot.describe_thing(thingName=thing_name)
            print(f"[IoT] Thing '{thing_name}' already exists")
            return {"thingName": thing_name, "existed": True}
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceNotFoundException":
                raise
        
        # Create thing with attributes
        response = self.iot.create_thing(
            thingName=thing_name,
            thingTypeName="",  # Optional: create thing type first
            attributePayload={
                "attributes": {
                    "facility_id": FACILITY_ID,
                    "device_type": "carbon_monitor",
                    "created_date": datetime.utcnow().isoformat()
                }
            }
        )
        
        print(f"[IoT] Thing created: {response['thingArn']}")
        return response
    
    def create_keys_and_certificate(self, thing_name: str, output_dir: str) -> Dict[str, str]:
        """
        Create and download device certificates.
        
        Args:
            thing_name: Name of the thing to attach cert to
            output_dir: Directory to save certificate files
            
        Returns:
            Dictionary with certificate paths
        """
        print(f"[IoT] Creating certificates for: {thing_name}")
        
        # Create certificate
        response = self.iot.create_keys_and_certificate(setAsActive=True)
        
        cert_id = response["certificateId"]
        cert_arn = response["certificateArn"]
        
        print(f"[IoT] Certificate ID: {cert_id}")
        
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        # Save certificate files
        cert_paths = {
            "certificate": os.path.join(output_dir, "device-certificate.pem.crt"),
            "private_key": os.path.join(output_dir, "private.pem.key"),
            "public_key": os.path.join(output_dir, "public.pem.key"),
            "root_ca": os.path.join(output_dir, "AmazonRootCA1.pem")
        }
        
        with open(cert_paths["certificate"], "w") as f:
            f.write(response["certificatePem"])
        print(f"[IoT] Saved: {cert_paths['certificate']}")
        
        with open(cert_paths["private_key"], "w") as f:
            f.write(response["keyPair"]["PrivateKey"])
        print(f"[IoT] Saved: {cert_paths['private_key']}")
        
        with open(cert_paths["public_key"], "w") as f:
            f.write(response["keyPair"]["PublicKey"])
        print(f"[IoT] Saved: {cert_paths['public_key']}")
        
        # Download Amazon Root CA
        import urllib.request
        root_ca_url = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
        urllib.request.urlretrieve(root_ca_url, cert_paths["root_ca"])
        print(f"[IoT] Downloaded: {cert_paths['root_ca']}")
        
        # Attach certificate to thing
        self.iot.attach_thing_principal(
            thingName=thing_name,
            principal=cert_arn
        )
        print(f"[IoT] Certificate attached to thing")
        
        return {
            "certificate_id": cert_id,
            "certificate_arn": cert_arn,
            "paths": cert_paths
        }
    
    def create_iot_policy(self, policy_name: str) -> Dict[str, Any]:
        """
        Create IoT policy for device permissions.
        
        Args:
            policy_name: Name of the policy
            
        Returns:
            Policy creation response
        """
        print(f"[IoT] Creating policy: {policy_name}")
        
        # Define policy document
        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:Connect"
                    ],
                    "Resource": [
                        f"arn:aws:iot:{self.region}:{self.account_id}:client/${{iot:Connection.Thing.ThingName}}"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:Publish"
                    ],
                    "Resource": [
                        f"arn:aws:iot:{self.region}:{self.account_id}:topic/facility/*"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:Subscribe"
                    ],
                    "Resource": [
                        f"arn:aws:iot:{self.region}:{self.account_id}:topicfilter/facility/*"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:Receive"
                    ],
                    "Resource": [
                        f"arn:aws:iot:{self.region}:{self.account_id}:topic/facility/*"
                    ]
                }
            ]
        }
        
        try:
            # Check if policy exists
            self.iot.get_policy(policyName=policy_name)
            print(f"[IoT] Policy '{policy_name}' already exists, updating...")
            response = self.iot.create_policy_version(
                policyName=policy_name,
                policyDocument=json.dumps(policy_document),
                setAsDefault=True
            )
            return response
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceNotFoundException":
                raise
        
        response = self.iot.create_policy(
            policyName=policy_name,
            policyDocument=json.dumps(policy_document)
        )
        
        print(f"[IoT] Policy created: {response['policyArn']}")
        return response
    
    def attach_policy_to_certificate(self, policy_name: str, certificate_arn: str):
        """
        Attach policy to certificate.
        
        Args:
            policy_name: Name of the policy
            certificate_arn: ARN of the certificate
        """
        print(f"[IoT] Attaching policy to certificate...")
        
        self.iot.attach_policy(
            policyName=policy_name,
            target=certificate_arn
        )
        
        print(f"[IoT] Policy attached successfully")
    
    def get_endpoint(self) -> str:
        """
        Get the IoT Core endpoint.
        
        Returns:
            IoT Core endpoint address
        """
        response = self.iot.describe_endpoint(endpointType="iot:Data-ATS")
        endpoint = response["endpointAddress"]
        print(f"[IoT] Endpoint: {endpoint}")
        return endpoint
    
    def create_dynamodb_tables(self) -> Dict[str, str]:
        """
        Create DynamoDB tables for data storage.
        
        Returns:
            Dictionary of table names to ARNs
        """
        tables = {}
        
        # Sensor readings table
        print(f"[DynamoDB] Creating table: {TABLE_SENSOR_READINGS}")
        try:
            response = self.dynamodb.create_table(
                TableName=TABLE_SENSOR_READINGS,
                KeySchema=[
                    {"AttributeName": "device_id", "KeyType": "HASH"},
                    {"AttributeName": "timestamp", "KeyType": "RANGE"}
                ],
                AttributeDefinitions=[
                    {"AttributeName": "device_id", "AttributeType": "S"},
                    {"AttributeName": "timestamp", "AttributeType": "N"}
                ],
                BillingMode="PAY_PER_REQUEST"  # On-demand, free tier friendly
            )
            tables[TABLE_SENSOR_READINGS] = response["TableDescription"]["TableArn"]
            print(f"[DynamoDB] Created: {TABLE_SENSOR_READINGS}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceInUseException":
                print(f"[DynamoDB] Table '{TABLE_SENSOR_READINGS}' already exists")
                tables[TABLE_SENSOR_READINGS] = f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_SENSOR_READINGS}"
            else:
                raise
        
        # Predictions table
        print(f"[DynamoDB] Creating table: {TABLE_EMISSION_PREDICTIONS}")
        try:
            response = self.dynamodb.create_table(
                TableName=TABLE_EMISSION_PREDICTIONS,
                KeySchema=[
                    {"AttributeName": "device_id", "KeyType": "HASH"},
                    {"AttributeName": "timestamp", "KeyType": "RANGE"}
                ],
                AttributeDefinitions=[
                    {"AttributeName": "device_id", "AttributeType": "S"},
                    {"AttributeName": "timestamp", "AttributeType": "N"}
                ],
                BillingMode="PAY_PER_REQUEST"
            )
            tables[TABLE_EMISSION_PREDICTIONS] = response["TableDescription"]["TableArn"]
            print(f"[DynamoDB] Created: {TABLE_EMISSION_PREDICTIONS}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceInUseException":
                print(f"[DynamoDB] Table '{TABLE_EMISSION_PREDICTIONS}' already exists")
                tables[TABLE_EMISSION_PREDICTIONS] = f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_EMISSION_PREDICTIONS}"
            else:
                raise
        
        # MRV reports table
        print(f"[DynamoDB] Creating table: {TABLE_MRV_REPORTS}")
        try:
            response = self.dynamodb.create_table(
                TableName=TABLE_MRV_REPORTS,
                KeySchema=[
                    {"AttributeName": "report_id", "KeyType": "HASH"},
                    {"AttributeName": "facility_id", "KeyType": "RANGE"}
                ],
                AttributeDefinitions=[
                    {"AttributeName": "report_id", "AttributeType": "S"},
                    {"AttributeName": "facility_id", "AttributeType": "S"}
                ],
                BillingMode="PAY_PER_REQUEST"
            )
            tables[TABLE_MRV_REPORTS] = response["TableDescription"]["TableArn"]
            print(f"[DynamoDB] Created: {TABLE_MRV_REPORTS}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceInUseException":
                print(f"[DynamoDB] Table '{TABLE_MRV_REPORTS}' already exists")
                tables[TABLE_MRV_REPORTS] = f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_MRV_REPORTS}"
            else:
                raise
        
        return tables
    
    def create_iot_rule_role(self) -> str:
        """
        Create IAM role for IoT rules to write to DynamoDB.
        
        Returns:
            Role ARN
        """
        role_name = f"{PROJECT_NAME}-iot-rule-role"
        print(f"[IAM] Creating role: {role_name}")
        
        # Trust policy for IoT
        trust_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "Service": "iot.amazonaws.com"
                    },
                    "Action": "sts:AssumeRole"
                }
            ]
        }
        
        try:
            response = self.iam.create_role(
                RoleName=role_name,
                AssumeRolePolicyDocument=json.dumps(trust_policy),
                Description="Role for IoT Rules to write to DynamoDB"
            )
            role_arn = response["Role"]["Arn"]
            print(f"[IAM] Role created: {role_arn}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "EntityAlreadyExists":
                print(f"[IAM] Role '{role_name}' already exists")
                response = self.iam.get_role(RoleName=role_name)
                role_arn = response["Role"]["Arn"]
            else:
                raise
        
        # Attach DynamoDB permissions
        policy_name = f"{PROJECT_NAME}-dynamodb-policy"
        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "dynamodb:PutItem",
                        "dynamodb:UpdateItem",
                        "dynamodb:GetItem",
                        "dynamodb:Query"
                    ],
                    "Resource": [
                        f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_SENSOR_READINGS}",
                        f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_EMISSION_PREDICTIONS}",
                        f"arn:aws:dynamodb:{self.region}:{self.account_id}:table/{TABLE_MRV_REPORTS}"
                    ]
                }
            ]
        }
        
        try:
            self.iam.put_role_policy(
                RoleName=role_name,
                PolicyName=policy_name,
                PolicyDocument=json.dumps(policy_document)
            )
            print(f"[IAM] Policy attached to role")
        except Exception as e:
            print(f"[IAM] Warning: Could not attach policy: {e}")
        
        return role_arn
    
    def create_iot_rules(self, role_arn: str):
        """
        Create IoT Rules for routing data to DynamoDB.
        
        Args:
            role_arn: ARN of the IAM role for rules
        """
        # Rule to store raw sensor data
        rule_name = f"{PROJECT_NAME.replace('-', '_')}_store_sensor_data"
        print(f"[IoT Rules] Creating rule: {rule_name}")
        
        try:
            self.iot.create_topic_rule(
                ruleName=rule_name,
                topicRulePayload={
                    "sql": f"SELECT * FROM '{TOPIC_RAW}'",
                    "description": "Store raw sensor data to DynamoDB",
                    "actions": [
                        {
                            "dynamoDBv2": {
                                "roleArn": role_arn,
                                "putItem": {
                                    "tableName": TABLE_SENSOR_READINGS
                                }
                            }
                        }
                    ],
                    "ruleDisabled": False,
                    "awsIotSqlVersion": "2016-03-23"
                }
            )
            print(f"[IoT Rules] Rule created: {rule_name}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
                print(f"[IoT Rules] Rule '{rule_name}' already exists")
            else:
                raise
        
        # Rule to trigger Lambda for predictions
        rule_name_predict = f"{PROJECT_NAME.replace('-', '_')}_trigger_prediction"
        print(f"[IoT Rules] Creating rule: {rule_name_predict}")
        
        # Note: Lambda action requires Lambda function to exist
        # This creates the rule without Lambda action for now
        try:
            self.iot.create_topic_rule(
                ruleName=rule_name_predict,
                topicRulePayload={
                    "sql": f"SELECT * FROM '{TOPIC_PROCESSED}'",
                    "description": "Trigger prediction Lambda on processed data",
                    "actions": [
                        {
                            "dynamoDBv2": {
                                "roleArn": role_arn,
                                "putItem": {
                                    "tableName": TABLE_SENSOR_READINGS
                                }
                            }
                        }
                    ],
                    "ruleDisabled": False,
                    "awsIotSqlVersion": "2016-03-23"
                }
            )
            print(f"[IoT Rules] Rule created: {rule_name_predict}")
            print("[IoT Rules] Note: Add Lambda action after deploying the prediction function")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
                print(f"[IoT Rules] Rule '{rule_name_predict}' already exists")
            else:
                raise
    
    def generate_config_file(self, endpoint: str, cert_paths: Dict[str, str]):
        """
        Generate configuration file for ESP32.
        
        Args:
            endpoint: IoT Core endpoint
            cert_paths: Dictionary of certificate file paths
        """
        config_content = f'''
// Auto-generated AWS IoT Configuration
// Generated: {datetime.utcnow().isoformat()}

#define AWS_IOT_ENDPOINT "{endpoint}"
#define AWS_IOT_PORT 8883
#define DEVICE_ID "{DEVICE_NAME}"
#define FACILITY_ID "{FACILITY_ID}"

// Certificate paths (for Python simulator)
// Certificate file: {cert_paths["paths"]["certificate"]}
// Private key file: {cert_paths["paths"]["private_key"]}
// Root CA file: {cert_paths["paths"]["root_ca"]}

// IMPORTANT: Copy certificate contents to config.h for ESP32
'''
        
        config_path = os.path.join(CERT_DIR, "aws_config.txt")
        with open(config_path, "w") as f:
            f.write(config_content)
        
        print(f"[Config] Saved configuration to: {config_path}")


# ==================== Main Entry Point ====================

def main():
    parser = argparse.ArgumentParser(
        description="AWS IoT Core Setup for Carbon Monitoring System"
    )
    
    parser.add_argument(
        "--region",
        type=str,
        default="us-east-1",
        help="AWS region (default: us-east-1)"
    )
    
    parser.add_argument(
        "--skip-tables",
        action="store_true",
        help="Skip DynamoDB table creation"
    )
    
    parser.add_argument(
        "--skip-certs",
        action="store_true",
        help="Skip certificate generation"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("   AWS IoT Core Setup - Carbon Monitoring System")
    print("=" * 60)
    print()
    
    try:
        setup = AWSIoTSetup(args.region)
        
        # Step 1: Create DynamoDB tables
        if not args.skip_tables:
            print("\n[Step 1] Creating DynamoDB tables...")
            tables = setup.create_dynamodb_tables()
            print(f"[Step 1] Created {len(tables)} tables")
        
        # Step 2: Create IoT Thing
        print("\n[Step 2] Creating IoT Thing...")
        thing = setup.create_thing(DEVICE_NAME)
        
        # Step 3: Create certificates
        cert_info = None
        if not args.skip_certs:
            print("\n[Step 3] Creating certificates...")
            cert_info = setup.create_keys_and_certificate(DEVICE_NAME, CERT_DIR)
        
        # Step 4: Create and attach policy
        print("\n[Step 4] Creating IoT policy...")
        policy_name = f"{PROJECT_NAME}-device-policy"
        setup.create_iot_policy(policy_name)
        
        if cert_info:
            setup.attach_policy_to_certificate(policy_name, cert_info["certificate_arn"])
        
        # Step 5: Create IAM role for IoT rules
        print("\n[Step 5] Creating IAM role for IoT rules...")
        role_arn = setup.create_iot_rule_role()
        
        # Step 6: Create IoT rules
        print("\n[Step 6] Creating IoT rules...")
        setup.create_iot_rules(role_arn)
        
        # Step 7: Get endpoint and generate config
        print("\n[Step 7] Generating configuration...")
        endpoint = setup.get_endpoint()
        if cert_info:
            setup.generate_config_file(endpoint, cert_info)
        
        # Print summary
        print("\n" + "=" * 60)
        print("   Setup Complete!")
        print("=" * 60)
        print(f"""
Next Steps:

1. Update firmware/esp32_carbon_monitor/config.h with:
   - AWS_IOT_ENDPOINT: {endpoint}
   - Copy certificate contents from {CERT_DIR}/

2. Update scripts/data_simulator.py with:
   - AWS_IOT_ENDPOINT = "{endpoint}"
   - Certificate paths point to {CERT_DIR}/

3. Test connectivity:
   cd scripts
   uv run data_simulator.py --mode mqtt

4. Deploy Lambda function:
   cd lambda/carbon_predictor
   # Follow Lambda deployment guide

5. Set up Grafana dashboard:
   # Configure DynamoDB data source with your AWS credentials
        """)
        
    except Exception as e:
        print(f"\n[ERROR] Setup failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
