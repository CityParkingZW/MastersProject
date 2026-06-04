/**
 * /api/predict-kgotso
 *
 * Generates a 24-hour CO₂ ppm forecast for the Kgotso ClimateHealth
 * Harare monitoring station using:
 *   1. A diurnal model derived from the June 2023–May 2024 hourly dataset
 *   2. The current reading's temperature + humidity to adjust the baseline
 *   3. A 6-reading rolling mean as the trend anchor
 *
 * Also returns the per-reading carbon footprint in kg CO₂e (Scope 1 direct)
 * using Harare altitude air density and a 3,000 m³ monitoring volume.
 */

import { NextResponse } from 'next/server'

// ── Monitoring volume (1,000 m² × 3 m ceiling, representative urban area) ────
const MONITORING_VOL_M3  = 3_000
const HARARE_AIR_DENSITY = 1.09      // kg/m³ at 1,483 m altitude
const CO2_MOL_MASS       = 44.01
const AIR_MOL_MASS       = 28.97
const AMBIENT_CO2_PPM    = 420       // outdoor background
const CO2_SCALE          = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (CO2_MOL_MASS / AIR_MOL_MASS)) / 1e6
//   = 3000 × 1.09 × 1.5192 / 1e6 ≈ 0.004968 kg per ppm·hour

/** kg CO₂ emitted by 1 ppm of excess CO₂ in the monitored volume for 1 hour */
function excessCO2KgPerHour(co2_ppm: number): number {
  return Math.max(0, co2_ppm - AMBIENT_CO2_PPM) * CO2_SCALE
}

// ── Diurnal adjustment (ppm deviation from daily mean) ───────────────────────
// Derived from the Kgotso dataset: CO₂ peaks ~5 am (cool, no ventilation)
// and dips ~1 pm (solar convection and higher temps dilute concentration).
const DIURNAL_ADJ = [
  12, 10, 8, 7, 9, 13,   // 00–05 h  (night lull → pre-dawn peak)
  10,  7, 3, 0,-3,-5,    // 06–11 h  (morning dispersion)
  -7, -8,-7,-5,-2, 1,    // 12–17 h  (hot afternoon minimum)
   4,  7,10,11,12,12,    // 18–23 h  (evening build-up)
] as const

// Temperature effect: each °C above 20°C reduces CO₂ by ~0.8 ppm (convection)
const TEMP_COEFF     = -0.8
const TEMP_REF       = 20
// Humidity effect: each % above 50% adds ~0.06 ppm (lower air exchange)
const HUMIDITY_COEFF =  0.06
const HUMIDITY_REF   = 50
// Forecast uncertainty band grows with horizon
const UNCERTAINTY_BASE  = 10  // ± ppm at hour 1
const UNCERTAINTY_SLOPE =  1  // + ppm per forecast step

interface ReadingInput {
  co2_ppm:             number
  temperature_celsius: number
  humidity_percent:    number
  hour:                number   // 0–23 local Harare hour
}

interface ForecastPoint {
  hour_offset:     number   // 1 = next hour, 24 = 24 h ahead
  predicted_ppm:   number
  lower_ppm:       number
  upper_ppm:       number
  carbon_kg_h:     number   // kg CO₂e that hour represents
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      readings:        ReadingInput[]  // recent readings, newest last
      forecast_hours:  number          // how many hours to predict
      last_timestamp?: string          // ISO of newest reading (for Render model)
    }

    if (!Array.isArray(body.readings) || body.readings.length === 0) {
      return NextResponse.json({ error: 'readings array required' }, { status: 400 })
    }

    const hrs = Math.min(body.forecast_hours ?? 24, 48)

    // ── Preferred path: the trained Gradient Boosting model on Render ─────────
    // Uses RENDER_ML_URL from apphosting.yaml (or KGOTSO_ML_URL locally).
    const renderUrl = process.env.RENDER_ML_URL ?? process.env.KGOTSO_ML_URL
    if (renderUrl) {
      try {
        const res = await fetch(`${renderUrl.replace(/\/$/, '')}/kgotso/predict`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recent_co2:     body.readings.map(r => r.co2_ppm),
            last_timestamp: body.last_timestamp ?? null,
            forecast_hours: hrs,
          }),
          // Render free tier can cold-start; allow generous timeout
          signal: AbortSignal.timeout(30_000),
        })
        if (res.ok) {
          const data = await res.json()
          return NextResponse.json({ ...data, source: 'render-ml' })
        }
        // non-OK → fall through to local model
      } catch {
        // network error / cold start timeout → fall through to local model
      }
    }

    // ── Fallback: local diurnal model (keeps the app working without Render) ──
    const recent = body.readings.slice(-6)

    // Rolling mean of recent CO₂ as the baseline
    const basePPM = recent.reduce((s, r) => s + r.co2_ppm, 0) / recent.length

    // Use the most recent reading's conditions
    const lastReading = recent[recent.length - 1]
    const tempAdj     = (lastReading.temperature_celsius - TEMP_REF) * TEMP_COEFF
    const humAdj      = (lastReading.humidity_percent    - HUMIDITY_REF) * HUMIDITY_COEFF

    const forecast: ForecastPoint[] = []

    for (let i = 1; i <= hrs; i++) {
      const forecastHour = (lastReading.hour + i) % 24
      const diurnal      = DIURNAL_ADJ[forecastHour]
      const predicted    = Math.max(380, Math.round(basePPM + diurnal + tempAdj + humAdj))
      const band         = UNCERTAINTY_BASE + UNCERTAINTY_SLOPE * i
      forecast.push({
        hour_offset:   i,
        predicted_ppm: predicted,
        lower_ppm:     Math.max(380, predicted - band),
        upper_ppm:     predicted + band,
        carbon_kg_h:   Number(excessCO2KgPerHour(predicted).toFixed(6)),
      })
    }

    // Carbon footprint summary over the forecast window
    const totalCarbonKg = forecast.reduce((s, p) => s + p.carbon_kg_h, 0)

    return NextResponse.json({
      success:  true,
      source:   'local-diurnal',
      model_version: 'Diurnal-Kgotso-fallback',
      baseline_ppm:      Math.round(basePPM),
      forecast_hours:    hrs,
      forecast,
      carbon_summary: {
        forecast_window_kg:     Number(totalCarbonKg.toFixed(4)),
        monthly_projection_tco2e: Number((totalCarbonKg / hrs * 24 * 30 / 1000).toFixed(4)),
        monitoring_vol_m3:      MONITORING_VOL_M3,
        method: 'diurnal-model + Harare altitude density + 3000 m³ monitoring volume',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Forecast failed', detail: String(err) }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint:  '/api/predict-kgotso',
    model:     'Kgotso Diurnal CO₂ Model v1',
    location:  'Harare, Zimbabwe (1,483 m altitude)',
    method:    'rolling-mean + diurnal pattern + temperature/humidity regression',
    carbon_calc: {
      vol_m3:        MONITORING_VOL_M3,
      air_density:   HARARE_AIR_DENSITY,
      ambient_ppm:   AMBIENT_CO2_PPM,
      scale_kg_ppm:  Number(CO2_SCALE.toFixed(6)),
    },
  })
}
