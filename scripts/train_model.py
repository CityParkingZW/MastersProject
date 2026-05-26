#!/usr/bin/env python3
"""
Carbon Emission Prediction Model Training Pipeline

This script:
1. Generates synthetic training data using the data simulator
2. Engineers features for time-series prediction
3. Trains multiple ML models (Random Forest, XGBoost, LSTM)
4. Evaluates and selects the best model
5. Exports the model for Lambda deployment

Usage:
    uv run train_model.py --samples 10000 --output ../models/
    uv run train_model.py --data sensor_data.csv --output ../models/

Author: H240486C
Date: 2026
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple, List, Optional

import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline

# Import data simulator for generating training data
from data_simulator import SensorDataGenerator, FacilityScenario


# ==================== Configuration ====================

# GHG Protocol Emission Factors (must match Lambda function)
EMISSION_FACTORS = {
    "ch4_gwp": 28,
    "co2_gwp": 1,
    "grid_ef_zimbabwe": 0.92,
    "ch4_density": 0.657,
    "co2_density": 1.977,
    "monitoring_volume_m3": 100,
}

# Model parameters
RANDOM_STATE = 42
TEST_SIZE = 0.2
CV_FOLDS = 5


# ==================== Feature Engineering ====================

def calculate_target_emissions(df: pd.DataFrame) -> pd.Series:
    """
    Calculate CO2-equivalent emissions from sensor readings.
    This becomes the target variable for ML training.
    
    Args:
        df: DataFrame with sensor readings
        
    Returns:
        Series with CO2e values in kg
    """
    # Methane emissions
    ch4_excess = np.maximum(0, df["ch4_ppm"] - 2.0)  # Above atmospheric baseline
    ch4_mass_kg = (ch4_excess / 1e6) * EMISSION_FACTORS["monitoring_volume_m3"] * EMISSION_FACTORS["ch4_density"]
    ch4_co2e = ch4_mass_kg * EMISSION_FACTORS["ch4_gwp"]
    
    # Direct CO2 emissions
    co2_excess = np.maximum(0, df["co2_ppm"] - 420)  # Above atmospheric baseline
    co2_mass_kg = (co2_excess / 1e6) * EMISSION_FACTORS["monitoring_volume_m3"] * EMISSION_FACTORS["co2_density"]
    
    # Energy emissions
    energy_co2e = df["energy_kwh"] * EMISSION_FACTORS["grid_ef_zimbabwe"]
    
    # Total
    total_co2e = ch4_co2e + co2_mass_kg + energy_co2e
    
    return total_co2e


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create engineered features for better prediction.
    
    Args:
        df: DataFrame with raw sensor readings
        
    Returns:
        DataFrame with additional engineered features
    """
    df = df.copy()
    
    # Parse timestamp
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    
    # Time-based features
    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    df["is_business_hours"] = df["hour"].between(8, 18).astype(int)
    
    # Cyclical encoding for hour (captures circular nature)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    
    # Cyclical encoding for day of week
    df["dow_sin"] = np.sin(2 * np.pi * df["day_of_week"] / 7)
    df["dow_cos"] = np.cos(2 * np.pi * df["day_of_week"] / 7)
    
    # Interaction features
    df["co2_ch4_ratio"] = df["co2_ppm"] / (df["ch4_ppm"] + 0.1)  # Avoid div by zero
    df["temp_humidity_index"] = df["temperature"] * df["humidity"] / 100
    df["energy_per_co2"] = df["energy_kwh"] / (df["co2_ppm"] + 1)
    
    # Derived gas features
    df["co2_excess"] = np.maximum(0, df["co2_ppm"] - 420)
    df["ch4_excess"] = np.maximum(0, df["ch4_ppm"] - 2.0)
    
    # Rolling statistics (if sorted by time)
    df = df.sort_values("timestamp")
    window = 5  # 5-minute window
    
    for col in ["co2_ppm", "ch4_ppm", "temperature", "energy_kwh"]:
        df[f"{col}_rolling_mean"] = df[col].rolling(window=window, min_periods=1).mean()
        df[f"{col}_rolling_std"] = df[col].rolling(window=window, min_periods=1).std().fillna(0)
        df[f"{col}_diff"] = df[col].diff().fillna(0)
    
    # Lag features
    for lag in [1, 5, 10]:
        df[f"co2_lag_{lag}"] = df["co2_ppm"].shift(lag).fillna(df["co2_ppm"])
        df[f"ch4_lag_{lag}"] = df["ch4_ppm"].shift(lag).fillna(df["ch4_ppm"])
    
    return df


def prepare_features(df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Prepare feature matrix and target vector.
    
    Args:
        df: DataFrame with engineered features
        
    Returns:
        Tuple of (X features, y target, feature names)
    """
    # Calculate target
    y = calculate_target_emissions(df)
    
    # Select feature columns
    feature_cols = [
        # Raw sensor readings
        "co2_ppm", "ch4_ppm", "temperature", "humidity", "energy_kwh",
        # Time features
        "hour", "is_weekend", "is_business_hours",
        "hour_sin", "hour_cos", "dow_sin", "dow_cos",
        # Interaction features
        "co2_ch4_ratio", "temp_humidity_index",
        # Derived features
        "co2_excess", "ch4_excess",
        # Rolling features
        "co2_ppm_rolling_mean", "ch4_ppm_rolling_mean",
        "co2_ppm_diff", "ch4_ppm_diff",
        # Lag features
        "co2_lag_1", "ch4_lag_1"
    ]
    
    # Filter to available columns
    feature_cols = [col for col in feature_cols if col in df.columns]
    
    X = df[feature_cols].values
    
    return X, y.values, feature_cols


# ==================== Model Training ====================

def train_models(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    feature_names: List[str]
) -> Dict[str, Any]:
    """
    Train and evaluate multiple models.
    
    Args:
        X_train: Training features
        y_train: Training targets
        X_test: Test features
        y_test: Test targets
        feature_names: List of feature names
        
    Returns:
        Dictionary with trained models and metrics
    """
    results = {}
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Model 1: Linear Regression (baseline)
    print("\n[1/4] Training Linear Regression (baseline)...")
    lr = LinearRegression()
    lr.fit(X_train_scaled, y_train)
    y_pred_lr = lr.predict(X_test_scaled)
    
    results["linear_regression"] = {
        "model": lr,
        "r2": r2_score(y_test, y_pred_lr),
        "rmse": np.sqrt(mean_squared_error(y_test, y_pred_lr)),
        "mae": mean_absolute_error(y_test, y_pred_lr)
    }
    print(f"    R2: {results['linear_regression']['r2']:.4f}")
    print(f"    RMSE: {results['linear_regression']['rmse']:.6f}")
    
    # Model 2: Ridge Regression
    print("\n[2/4] Training Ridge Regression...")
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train_scaled, y_train)
    y_pred_ridge = ridge.predict(X_test_scaled)
    
    results["ridge"] = {
        "model": ridge,
        "r2": r2_score(y_test, y_pred_ridge),
        "rmse": np.sqrt(mean_squared_error(y_test, y_pred_ridge)),
        "mae": mean_absolute_error(y_test, y_pred_ridge)
    }
    print(f"    R2: {results['ridge']['r2']:.4f}")
    print(f"    RMSE: {results['ridge']['rmse']:.6f}")
    
    # Model 3: Random Forest
    print("\n[3/4] Training Random Forest...")
    rf = RandomForestRegressor(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=RANDOM_STATE,
        n_jobs=-1
    )
    rf.fit(X_train, y_train)  # RF doesn't need scaling
    y_pred_rf = rf.predict(X_test)
    
    results["random_forest"] = {
        "model": rf,
        "r2": r2_score(y_test, y_pred_rf),
        "rmse": np.sqrt(mean_squared_error(y_test, y_pred_rf)),
        "mae": mean_absolute_error(y_test, y_pred_rf),
        "feature_importance": dict(zip(feature_names, rf.feature_importances_))
    }
    print(f"    R2: {results['random_forest']['r2']:.4f}")
    print(f"    RMSE: {results['random_forest']['rmse']:.6f}")
    
    # Model 4: Gradient Boosting
    print("\n[4/4] Training Gradient Boosting...")
    gb = GradientBoostingRegressor(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        min_samples_split=5,
        random_state=RANDOM_STATE
    )
    gb.fit(X_train, y_train)
    y_pred_gb = gb.predict(X_test)
    
    results["gradient_boosting"] = {
        "model": gb,
        "r2": r2_score(y_test, y_pred_gb),
        "rmse": np.sqrt(mean_squared_error(y_test, y_pred_gb)),
        "mae": mean_absolute_error(y_test, y_pred_gb),
        "feature_importance": dict(zip(feature_names, gb.feature_importances_))
    }
    print(f"    R2: {results['gradient_boosting']['r2']:.4f}")
    print(f"    RMSE: {results['gradient_boosting']['rmse']:.6f}")
    
    # Add scaler to results
    results["scaler"] = scaler
    results["feature_names"] = feature_names
    
    return results


def select_best_model(results: Dict[str, Any]) -> Tuple[str, Any]:
    """
    Select the best model based on R2 score.
    
    Args:
        results: Dictionary with model results
        
    Returns:
        Tuple of (model name, model object)
    """
    model_scores = {}
    for name in ["linear_regression", "ridge", "random_forest", "gradient_boosting"]:
        if name in results:
            model_scores[name] = results[name]["r2"]
    
    best_name = max(model_scores, key=model_scores.get)
    best_model = results[best_name]["model"]
    
    print(f"\n[BEST MODEL] {best_name}")
    print(f"    R2 Score: {model_scores[best_name]:.4f}")
    
    return best_name, best_model


def plot_results(
    y_test: np.ndarray,
    y_pred: np.ndarray,
    results: Dict[str, Any],
    output_dir: str
):
    """
    Generate visualization plots.
    
    Args:
        y_test: Actual values
        y_pred: Predicted values
        results: Training results
        output_dir: Directory to save plots
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Plot 1: Actual vs Predicted
    plt.figure(figsize=(10, 6))
    plt.scatter(y_test, y_pred, alpha=0.5, s=10)
    plt.plot([y_test.min(), y_test.max()], [y_test.min(), y_test.max()], 'r--', lw=2)
    plt.xlabel("Actual CO2e (kg)")
    plt.ylabel("Predicted CO2e (kg)")
    plt.title("Actual vs Predicted Emissions")
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "actual_vs_predicted.png"), dpi=150)
    plt.close()
    
    # Plot 2: Model Comparison
    model_names = []
    r2_scores = []
    rmse_scores = []
    
    for name in ["linear_regression", "ridge", "random_forest", "gradient_boosting"]:
        if name in results:
            model_names.append(name.replace("_", " ").title())
            r2_scores.append(results[name]["r2"])
            rmse_scores.append(results[name]["rmse"])
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # R2 comparison
    axes[0].barh(model_names, r2_scores, color='steelblue')
    axes[0].set_xlabel("R² Score")
    axes[0].set_title("Model Comparison - R² Score")
    axes[0].set_xlim(0, 1)
    
    # RMSE comparison
    axes[1].barh(model_names, rmse_scores, color='coral')
    axes[1].set_xlabel("RMSE (kg CO2e)")
    axes[1].set_title("Model Comparison - RMSE")
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "model_comparison.png"), dpi=150)
    plt.close()
    
    # Plot 3: Feature Importance (for tree models)
    if "random_forest" in results and "feature_importance" in results["random_forest"]:
        importance = results["random_forest"]["feature_importance"]
        sorted_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:15]
        
        plt.figure(figsize=(10, 8))
        names = [f[0] for f in sorted_features]
        values = [f[1] for f in sorted_features]
        plt.barh(names, values, color='teal')
        plt.xlabel("Feature Importance")
        plt.title("Top 15 Feature Importance (Random Forest)")
        plt.gca().invert_yaxis()
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, "feature_importance.png"), dpi=150)
        plt.close()
    
    # Plot 4: Residuals
    residuals = y_test - y_pred
    plt.figure(figsize=(10, 6))
    plt.hist(residuals, bins=50, edgecolor='black', alpha=0.7)
    plt.axvline(x=0, color='r', linestyle='--')
    plt.xlabel("Residual (Actual - Predicted)")
    plt.ylabel("Frequency")
    plt.title("Residual Distribution")
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "residuals.png"), dpi=150)
    plt.close()
    
    print(f"[PLOTS] Saved visualizations to {output_dir}")


def save_model(
    model,
    scaler,
    feature_names: List[str],
    results: Dict[str, Any],
    model_name: str,
    output_dir: str
) -> str:
    """
    Save the trained model for deployment.
    
    Args:
        model: Trained model object
        scaler: Feature scaler
        feature_names: List of feature names
        results: Training results
        model_name: Name of the selected model
        output_dir: Directory to save model
        
    Returns:
        Path to saved model
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Create model package
    model_package = {
        "model": model,
        "scaler": scaler,
        "feature_names": feature_names,
        "model_type": model_name,
        "metrics": {
            "r2": results[model_name]["r2"],
            "rmse": results[model_name]["rmse"],
            "mae": results[model_name]["mae"]
        },
        "emission_factors": EMISSION_FACTORS,
        "created_at": datetime.utcnow().isoformat(),
        "version": "v1"
    }
    
    # Save with joblib
    model_path = os.path.join(output_dir, "carbon_predictor_v1.joblib")
    joblib.dump(model_package, model_path)
    print(f"[SAVED] Model saved to {model_path}")
    
    # Save metadata as JSON
    metadata = {
        "model_type": model_name,
        "feature_names": feature_names,
        "metrics": model_package["metrics"],
        "emission_factors": EMISSION_FACTORS,
        "created_at": model_package["created_at"],
        "version": "v1"
    }
    
    metadata_path = os.path.join(output_dir, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"[SAVED] Metadata saved to {metadata_path}")
    
    return model_path


# ==================== Main Pipeline ====================

def generate_training_data(samples: int = 10000) -> pd.DataFrame:
    """
    Generate training data using multiple scenarios.
    
    Args:
        samples: Number of samples to generate per scenario
        
    Returns:
        DataFrame with combined training data
    """
    print(f"[DATA] Generating {samples} samples per scenario...")
    
    scenarios = [
        FacilityScenario.normal_operations(),
        FacilityScenario.waste_processing(),
        FacilityScenario.industrial_combustion(),
        FacilityScenario.agricultural()
    ]
    
    all_data = []
    
    for scenario in scenarios:
        print(f"    Generating: {scenario['name']}")
        generator = SensorDataGenerator(scenario, seed=RANDOM_STATE)
        
        # Generate data over 7 days
        hours = int(samples / 60)  # Convert samples to hours
        df = generator.generate_historical_data(hours=hours, interval_minutes=1)
        all_data.append(df)
    
    combined = pd.concat(all_data, ignore_index=True)
    print(f"[DATA] Generated {len(combined)} total samples")
    
    return combined


def main():
    parser = argparse.ArgumentParser(
        description="Train Carbon Emission Prediction Model"
    )
    
    parser.add_argument(
        "--samples",
        type=int,
        default=5000,
        help="Number of samples per scenario (default: 5000)"
    )
    
    parser.add_argument(
        "--data",
        type=str,
        default=None,
        help="Path to existing CSV data (skips generation)"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        default="../models",
        help="Output directory for models (default: ../models)"
    )
    
    parser.add_argument(
        "--no-plots",
        action="store_true",
        help="Skip generating visualization plots"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("   Carbon Emission Prediction - Model Training Pipeline")
    print("=" * 60)
    print()
    
    # Step 1: Load or generate data
    if args.data and os.path.exists(args.data):
        print(f"[STEP 1] Loading data from {args.data}...")
        df = pd.read_csv(args.data)
    else:
        print("[STEP 1] Generating training data...")
        df = generate_training_data(args.samples)
    
    print(f"    Dataset shape: {df.shape}")
    print(f"    Columns: {list(df.columns)}")
    
    # Step 2: Feature engineering
    print("\n[STEP 2] Engineering features...")
    df_featured = engineer_features(df)
    print(f"    Engineered features: {len(df_featured.columns)} columns")
    
    # Step 3: Prepare features
    print("\n[STEP 3] Preparing feature matrix...")
    X, y, feature_names = prepare_features(df_featured)
    print(f"    Features: {X.shape}")
    print(f"    Target range: [{y.min():.6f}, {y.max():.6f}] kg CO2e")
    
    # Step 4: Split data
    print("\n[STEP 4] Splitting data...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    print(f"    Training set: {X_train.shape[0]} samples")
    print(f"    Test set: {X_test.shape[0]} samples")
    
    # Step 5: Train models
    print("\n[STEP 5] Training models...")
    results = train_models(X_train, y_train, X_test, y_test, feature_names)
    
    # Step 6: Select best model
    print("\n[STEP 6] Selecting best model...")
    best_name, best_model = select_best_model(results)
    
    # Step 7: Generate predictions for plots
    if best_name in ["linear_regression", "ridge"]:
        scaler = results["scaler"]
        y_pred = best_model.predict(scaler.transform(X_test))
    else:
        y_pred = best_model.predict(X_test)
    
    # Step 8: Generate plots
    if not args.no_plots:
        print("\n[STEP 7] Generating visualizations...")
        plot_results(y_test, y_pred, results, os.path.join(args.output, "plots"))
    
    # Step 9: Save model
    print("\n[STEP 8] Saving model...")
    model_path = save_model(
        best_model,
        results["scaler"],
        feature_names,
        results,
        best_name,
        args.output
    )
    
    # Summary
    print("\n" + "=" * 60)
    print("   Training Complete!")
    print("=" * 60)
    print(f"""
Summary:
    - Best Model: {best_name}
    - R² Score: {results[best_name]['r2']:.4f}
    - RMSE: {results[best_name]['rmse']:.6f} kg CO2e
    - MAE: {results[best_name]['mae']:.6f} kg CO2e
    - Model saved to: {model_path}

Next Steps:
    1. Upload model to S3:
       aws s3 cp {model_path} s3://carbon-monitor-models/models/
    
    2. Update Lambda environment variable:
       MODEL_KEY = "models/carbon_predictor_v1.joblib"
    
    3. Test prediction:
       python -c "import joblib; m = joblib.load('{model_path}'); print(m)"
    """)


if __name__ == "__main__":
    main()
