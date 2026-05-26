// Client-side data simulator for demo purposes
// This generates realistic sensor data patterns

import type { SensorReading, CarbonEmission, Prediction, Alert, DailyEmissionSummary } from './types'

// Zimbabwe grid emission factor (kg CO2/kWh)
const GRID_EMISSION_FACTOR = 0.92

// Methane GWP (Global Warming Potential)
const CH4_GWP = 28

// Base values with realistic ranges
const BASE_VALUES = {
  co2_ppm: { min: 400, max: 800, base: 450 },
  ch4_ppm: { min: 1.8, max: 10, base: 2.5 },
  temperature: { min: 18, max: 35, base: 25 },
  humidity: { min: 30, max: 80, base: 55 },
  energy_kwh: { min: 50, max: 500, base: 150 },
}

// Time-based patterns (hour of day multipliers)
const HOURLY_PATTERNS = {
  energy: [0.3, 0.25, 0.2, 0.2, 0.25, 0.4, 0.6, 0.8, 1.0, 1.0, 0.95, 0.9, 0.85, 0.9, 0.95, 1.0, 0.9, 0.7, 0.5, 0.45, 0.4, 0.38, 0.35, 0.32],
  co2: [0.6, 0.55, 0.5, 0.5, 0.55, 0.7, 0.85, 0.95, 1.0, 1.0, 0.95, 0.9, 0.88, 0.9, 0.92, 0.95, 0.85, 0.75, 0.65, 0.6, 0.58, 0.55, 0.6, 0.58],
}

function getHourMultiplier(hour: number, pattern: number[]): number {
  return pattern[hour] || 1
}

function addNoise(value: number, noisePercent: number = 5): number {
  const noise = (Math.random() - 0.5) * 2 * (noisePercent / 100) * value
  return value + noise
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function generateSensorReading(deviceId: string = 'CM001', facilityId: string = 'FAC001'): SensorReading {
  const now = new Date()
  const hour = now.getHours()
  
  // Apply time-based patterns
  const energyMultiplier = getHourMultiplier(hour, HOURLY_PATTERNS.energy)
  const co2Multiplier = getHourMultiplier(hour, HOURLY_PATTERNS.co2)
  
  // Generate values with patterns and noise
  const energy_kwh = addNoise(BASE_VALUES.energy_kwh.base * energyMultiplier, 10)
  const co2_ppm = addNoise(BASE_VALUES.co2_ppm.base * co2Multiplier, 8)
  const ch4_ppm = addNoise(BASE_VALUES.ch4_ppm.base * (0.8 + Math.random() * 0.4), 15)
  const temperature = addNoise(BASE_VALUES.temperature.base + (hour >= 10 && hour <= 16 ? 5 : 0), 5)
  const humidity = addNoise(BASE_VALUES.humidity.base - (hour >= 10 && hour <= 16 ? 10 : 0), 8)
  
  return {
    device_id: deviceId,
    facility_id: facilityId,
    timestamp: now.toISOString(),
    co2_ppm: clamp(co2_ppm, BASE_VALUES.co2_ppm.min, BASE_VALUES.co2_ppm.max),
    ch4_ppm: clamp(ch4_ppm, BASE_VALUES.ch4_ppm.min, BASE_VALUES.ch4_ppm.max),
    temperature: clamp(temperature, BASE_VALUES.temperature.min, BASE_VALUES.temperature.max),
    humidity: clamp(humidity, BASE_VALUES.humidity.min, BASE_VALUES.humidity.max),
    energy_kwh: clamp(energy_kwh, BASE_VALUES.energy_kwh.min, BASE_VALUES.energy_kwh.max),
    air_quality_index: Math.round(clamp((co2_ppm - 400) / 4, 0, 100)),
    data_source: 'simulator' as const,
  }
}

export function generateHistoricalData(hours: number = 24, deviceId: string = 'CM001'): SensorReading[] {
  const data: SensorReading[] = []
  const now = new Date()
  
  for (let i = hours; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000)
    const hour = timestamp.getHours()
    
    const energyMultiplier = getHourMultiplier(hour, HOURLY_PATTERNS.energy)
    const co2Multiplier = getHourMultiplier(hour, HOURLY_PATTERNS.co2)
    
    data.push({
      device_id: deviceId,
      facility_id: 'FAC001',
      timestamp: timestamp.toISOString(),
      co2_ppm: clamp(addNoise(BASE_VALUES.co2_ppm.base * co2Multiplier, 8), BASE_VALUES.co2_ppm.min, BASE_VALUES.co2_ppm.max),
      ch4_ppm: clamp(addNoise(BASE_VALUES.ch4_ppm.base * (0.8 + Math.random() * 0.4), 15), BASE_VALUES.ch4_ppm.min, BASE_VALUES.ch4_ppm.max),
      temperature: clamp(addNoise(BASE_VALUES.temperature.base + (hour >= 10 && hour <= 16 ? 5 : 0), 5), BASE_VALUES.temperature.min, BASE_VALUES.temperature.max),
      humidity: clamp(addNoise(BASE_VALUES.humidity.base - (hour >= 10 && hour <= 16 ? 10 : 0), 8), BASE_VALUES.humidity.min, BASE_VALUES.humidity.max),
      energy_kwh: clamp(addNoise(BASE_VALUES.energy_kwh.base * energyMultiplier, 10), BASE_VALUES.energy_kwh.min, BASE_VALUES.energy_kwh.max),
      air_quality_index: Math.round(Math.random() * 50 + 25),
      data_source: 'simulator' as const,
    })
  }

  return data
}

export function calculateCarbonEmission(reading: SensorReading): CarbonEmission {
  // Calculate CO2e from energy consumption (Scope 2)
  const energy_co2e_kg = reading.energy_kwh * GRID_EMISSION_FACTOR
  
  // Calculate CO2e from methane (Scope 1 - fugitive emissions)
  // Assuming CH4 leak rate based on PPM above background
  const ch4_excess = Math.max(0, reading.ch4_ppm - 1.8) // Background CH4 is ~1.8 ppm
  const ch4_mass_kg = ch4_excess * 0.001 // Simplified conversion
  const ch4_co2e_kg = ch4_mass_kg * CH4_GWP
  
  // Direct CO2 from facility operations (Scope 1 - stationary combustion)
  const co2_excess = Math.max(0, reading.co2_ppm - 420) // Background CO2 is ~420 ppm
  const co2_direct_kg = co2_excess * 0.0001 // Simplified conversion
  
  return {
    timestamp: reading.timestamp,
    facility_id: reading.facility_id,
    co2_direct_kg,
    ch4_co2e_kg,
    energy_co2e_kg,
    total_co2e_kg: co2_direct_kg + ch4_co2e_kg + energy_co2e_kg,
    scope: energy_co2e_kg > (co2_direct_kg + ch4_co2e_kg) ? 2 : 1,
  }
}

export function generatePredictions(historicalData: SensorReading[], hoursAhead: number = 24): Prediction[] {
  const predictions: Prediction[] = []
  const lastReading = historicalData[historicalData.length - 1]
  const now = new Date(lastReading.timestamp)
  
  // Calculate trend from last 6 hours
  const recentData = historicalData.slice(-6)
  const avgEnergy = recentData.reduce((sum, r) => sum + r.energy_kwh, 0) / recentData.length
  const avgCH4 = recentData.reduce((sum, r) => sum + r.ch4_ppm, 0) / recentData.length
  
  for (let i = 1; i <= hoursAhead; i++) {
    const futureTime = new Date(now.getTime() + i * 60 * 60 * 1000)
    const hour = futureTime.getHours()
    
    // Apply patterns with decay
    const energyMultiplier = getHourMultiplier(hour, HOURLY_PATTERNS.energy)
    const predictedEnergy = avgEnergy * energyMultiplier * (0.95 + Math.random() * 0.1)
    const predictedCH4 = avgCH4 * (0.9 + Math.random() * 0.2)
    
    // Calculate predicted CO2e
    const energyContribution = predictedEnergy * GRID_EMISSION_FACTOR
    const ch4Contribution = (predictedCH4 - 1.8) * 0.001 * CH4_GWP
    const predicted_co2e_kg = energyContribution + ch4Contribution
    
    // Confidence intervals widen with time
    const uncertainty = 0.1 + (i / hoursAhead) * 0.3
    
    predictions.push({
      timestamp: futureTime.toISOString(),
      predicted_co2e_kg,
      confidence_lower: predicted_co2e_kg * (1 - uncertainty),
      confidence_upper: predicted_co2e_kg * (1 + uncertainty),
      model_version: 'XGBoost-v1.0',
      factors: {
        energy_contribution: energyContribution / predicted_co2e_kg,
        ch4_contribution: ch4Contribution / predicted_co2e_kg,
        temperature_factor: 1.0,
      },
    })
  }
  
  return predictions
}

export function generateDailySummaries(days: number = 30): DailyEmissionSummary[] {
  const summaries: DailyEmissionSummary[] = []
  const now = new Date()
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    
    // Weekend vs weekday pattern
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    const baseEmission = isWeekend ? 2500 : 4500
    
    const total = addNoise(baseEmission, 15)
    const scope1 = total * (0.3 + Math.random() * 0.1)
    const scope2 = total - scope1
    
    const dateStr = date.toISOString().split('T')[0]
    summaries.push({
      id:            `sim-${dateStr}`,
      facility_id:   'sim-facility',
      date:          dateStr,
      total_co2e_kg: total,
      scope1_kg:     scope1,
      scope2_kg:     scope2,
      breakdown: {
        stationary_combustion: scope1 * 0.6,
        process_emissions:     scope1 * 0.25,
        fugitive_emissions:    scope1 * 0.15,
        purchased_electricity: scope2,
      },
      avg_co2_ppm:   addNoise(520, 10),
      max_co2_ppm:   addNoise(680, 15),
      reading_count: 288,
      createdAt:     date.toISOString(),
      updatedAt:     date.toISOString(),
    })
  }
  
  return summaries
}

export function generateAlerts(reading: SensorReading): Alert[] {
  const alerts: Alert[] = []
  const now = new Date().toISOString()
  
  const base = { facility_id: reading.facility_id, device_id: reading.device_id, timestamp: now, acknowledged: false }

  // High CO2 alert
  if (reading.co2_ppm > 650) {
    const co2Critical = reading.co2_ppm > 750
    alerts.push({
      ...base,
      id: `alert-co2-${Date.now()}`,
      type: co2Critical ? 'critical' : 'warning',
      message: `CO2 levels ${co2Critical ? 'critically ' : ''}elevated`,
      sensor: 'MQ-135',
      value: reading.co2_ppm,
      threshold: 650,
    })
  }

  // High methane alert
  if (reading.ch4_ppm > 5) {
    alerts.push({
      ...base,
      id: `alert-ch4-${Date.now()}`,
      type: reading.ch4_ppm > 8 ? 'critical' : 'warning',
      message: 'Methane leak detected',
      sensor: 'MQ-4',
      value: reading.ch4_ppm,
      threshold: 5,
    })
  }

  // High temperature alert
  if (reading.temperature > 32) {
    alerts.push({
      ...base,
      id: `alert-temp-${Date.now()}`,
      type: 'warning',
      message: 'High temperature in facility',
      sensor: 'DHT22',
      value: reading.temperature,
      threshold: 32,
    })
  }

  // High energy consumption alert
  if (reading.energy_kwh > 400) {
    alerts.push({
      ...base,
      id: `alert-energy-${Date.now()}`,
      type: 'info',
      message: 'Energy consumption spike detected',
      sensor: 'SCT-013',
      value: reading.energy_kwh,
      threshold: 400,
    })
  }
  
  return alerts
}
