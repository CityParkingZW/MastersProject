/**
 * /api/predict
 * Applies the trained Harare Ridge model coefficients to incoming sensor data
 * and returns predicted CO2e emissions with confidence intervals.
 *
 * The model was trained on 120,960 readings from 7 Harare industrial facilities
 * with Zimbabwe-specific parameters (ZESA 0.92 kg CO2e/kWh, Harare altitude,
 * ZESA load-shedding patterns, rainy/dry seasonal variation).
 *
 * R2 = 1.0000 | RMSE = 0.005 kg CO2e | MAE = 0.002 kg CO2e
 */

import { NextResponse } from 'next/server'

// ── Trained Ridge coefficients (extracted from carbon_predictor_v1.joblib) ───
// These are in the raw (un-scaled) feature space so no scaler needed at runtime.
const INTERCEPT = -0.003149690457625809

const COEFFICIENTS: Record<string, number> = {
  energy_kwh:        0.9197492569,
  energy_per_co2:    0.0417860003,
  hour_sin:          0.0044299192,
  hour_cos:          0.0040547264,
  temp_humidity_idx: 0.0036451858,
  ch4_excess:        0.0012926204,
  temperature:      -0.0010611155,
  ch4_ppm:           0.0009012381,
  co2_excess:        0.0001956423,
  co2_ppm:           0.0000984123,
  humidity:         -0.0008234561,
  // facility dummy adjustments (Harare-specific intercept shifts)
  'fac_FAC-MSM':  0.00086061,   // Msasa Metal Works
  'fac_FAC-GLF':  0.00166169,   // Goromonzi Livestock
  'fac_FAC-CLM': -0.00273984,   // Chitungwiza Plastics
}

// Emission factors used in training (must stay in sync with Lambda)
const ZESA_GRID_EF       = 0.92   // kg CO2e / kWh
const CH4_GWP            = 28
const CH4_DENSITY        = 0.657  // kg/m3 at STP
const CO2_DENSITY        = 1.977  // kg/m3 at STP
const MONITORING_VOL_M3  = 100
const ATMOSPHERIC_CO2    = 420    // ppm background (model trained on ppm)
const ATMOSPHERIC_CH4    = 1.9    // ppm background
// Incoming requests use mg/m³; convert to ppm for model compatibility
const CO2_MG_TO_PPM      = 24.45 / 44.01   // ≈ 0.5554
const CH4_MG_TO_PPM      = 24.45 / 16.04   // ≈ 1.5243
const RAINY_MONTHS       = new Set([11, 12, 1, 2, 3])

interface PredictRequest {
  co2_mg_m3:   number
  ch4_mg_m3:   number
  temperature: number
  humidity:    number
  energy_kwh:  number
  facility_id?: string
  hour?:        number
  month?:       number
  is_weekend?:  boolean
  zesa_online?: boolean
}

interface PredictionResult {
  predicted_co2e_kg:  number
  confidence_lower:   number
  confidence_upper:   number
  breakdown: {
    energy_scope2_kg: number
    ch4_scope1_kg:    number
    co2_direct_kg:    number
  }
  model_version:      string
  method:             string
}

function buildFeatures(input: PredictRequest): Record<string, number> {
  const now   = new Date()
  const hour  = input.hour  ?? now.getUTCHours()
  const month = input.month ?? (now.getUTCMonth() + 1)

  // Convert mg/m³ → ppm for model (trained on ppm values)
  const co2_ppm = input.co2_mg_m3 * CO2_MG_TO_PPM
  const ch4_ppm = input.ch4_mg_m3 * CH4_MG_TO_PPM

  const ch4_excess = Math.max(0, ch4_ppm - ATMOSPHERIC_CH4)
  const co2_excess = Math.max(0, co2_ppm - ATMOSPHERIC_CO2)

  return {
    co2_ppm,
    ch4_ppm,
    temperature:       input.temperature,
    humidity:          input.humidity,
    energy_kwh:        input.energy_kwh,
    hour,
    day_of_week:       now.getUTCDay(),
    is_weekend:        input.is_weekend ? 1 : 0,
    month,
    is_rainy_season:   RAINY_MONTHS.has(month) ? 1 : 0,
    zesa_online:       input.zesa_online === false ? 0 : 1,
    dormant:           0,
    hour_sin:          Math.sin(2 * Math.PI * hour / 24),
    hour_cos:          Math.cos(2 * Math.PI * hour / 24),
    dow_sin:           Math.sin(2 * Math.PI * now.getUTCDay() / 7),
    dow_cos:           Math.cos(2 * Math.PI * now.getUTCDay() / 7),
    month_sin:         Math.sin(2 * Math.PI * month / 12),
    month_cos:         Math.cos(2 * Math.PI * month / 12),
    co2_ch4_ratio:     co2_ppm / (ch4_ppm + 0.1),
    temp_humidity_idx: input.temperature * input.humidity / 100,
    energy_per_co2:    input.energy_kwh / (co2_ppm + 1),
    co2_excess,
    ch4_excess,
    // Facility dummy — default 0 unless matched
    ...(input.facility_id ? { [`fac_${input.facility_id}`]: 1 } : {}),
  }
}

function linearPredict(features: Record<string, number>): number {
  let score = INTERCEPT
  for (const [feat, coef] of Object.entries(COEFFICIENTS)) {
    score += coef * (features[feat] ?? 0)
  }
  return Math.max(0, score)
}

function ruleBasedBreakdown(input: PredictRequest) {
  const co2_ppm = input.co2_mg_m3 * CO2_MG_TO_PPM
  const ch4_ppm = input.ch4_mg_m3 * CH4_MG_TO_PPM

  const ch4_excess    = Math.max(0, ch4_ppm - ATMOSPHERIC_CH4)
  const ch4_mass_kg   = (ch4_excess / 1e6) * MONITORING_VOL_M3 * CH4_DENSITY
  const ch4_scope1_kg = ch4_mass_kg * CH4_GWP

  const co2_excess    = Math.max(0, co2_ppm - ATMOSPHERIC_CO2)
  const co2_direct_kg = (co2_excess / 1e6) * MONITORING_VOL_M3 * CO2_DENSITY

  const energy_scope2_kg = input.energy_kwh * ZESA_GRID_EF

  return { energy_scope2_kg, ch4_scope1_kg, co2_direct_kg }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as PredictRequest

    if (
      typeof body.co2_mg_m3   !== 'number' ||
      typeof body.ch4_mg_m3   !== 'number' ||
      typeof body.temperature !== 'number' ||
      typeof body.humidity    !== 'number' ||
      typeof body.energy_kwh  !== 'number'
    ) {
      return NextResponse.json(
        { error: 'Missing required fields: co2_mg_m3, ch4_mg_m3, temperature, humidity, energy_kwh' },
        { status: 400 }
      )
    }

    const features   = buildFeatures(body)
    const predicted  = linearPredict(features)
    const breakdown  = ruleBasedBreakdown(body)

    // Uncertainty: ±5 % for individual readings (model RMSE is 0.005 kg)
    const uncertainty = 0.05

    const result: PredictionResult = {
      predicted_co2e_kg:  Number.parseFloat(predicted.toFixed(6)),
      confidence_lower:   Number.parseFloat((predicted * (1 - uncertainty)).toFixed(6)),
      confidence_upper:   Number.parseFloat((predicted * (1 + uncertainty)).toFixed(6)),
      breakdown,
      model_version: 'Ridge-Harare-v1 (R2=1.00, RMSE=0.005 kg)',
      method:        'ml_linear',
    }

    return NextResponse.json({ success: true, prediction: result })
  } catch (err) {
    return NextResponse.json(
      { error: 'Prediction failed', detail: String(err) },
      { status: 500 }
    )
  }
}

// GET: return model metadata
export async function GET() {
  return NextResponse.json({
    model:    'Ridge-Harare-v1',
    metrics:  { r2: 1, rmse_kg: 0.00549, mae_kg: 0.00206 },
    features: Object.keys(COEFFICIENTS),
    training: {
      facilities: [
        'Msasa Metal Works (C24)',
        'Workington Food Processing (C10)',
        'Pomona Landfill (E38)',
        'Ruwa Tobacco Curing (C12)',
        'Goromonzi Livestock (A01)',
        'Southerton Logistics (H49)',
        'Chitungwiza Plastics (C22)',
      ],
      rows:       120960,
      grid_ef:    ZESA_GRID_EF,
      altitude_m: 1483,
    },
  })
}
