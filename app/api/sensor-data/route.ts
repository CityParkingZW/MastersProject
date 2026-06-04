import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

// Conversion factors: sensor hardware reports ppm; we store and display mg/m³
const CO2_PPM_TO_MG  = 44.01 / 24.45   // ≈ 1.8004
const CH4_PPM_TO_MG  = 16.04 / 24.45   // ≈ 0.6561

interface LiveReading {
  device_id:   string
  facility_id: string
  co2_mg_m3:   number
  ch4_mg_m3:   number
  temperature: number
  humidity:    number
  energy_kwh:  number
  uptime_ms:   number
  received_at: string
}

// In-memory cache — keeps the last reading per device for fast polling
const latestByDevice = new Map<string, LiveReading>()

// POST — ESP32 sends sensor data here every ~10 seconds
// Accepts either mg/m³ fields (co2_mg_m3, ch4_mg_m3) or legacy ppm fields
// (co2_ppm, ch4_ppm) — ppm values are converted on ingestion.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const device_id:   string = body.device_id   || 'dev-unknown'
    const facility_id: string = body.facility_id || 'unknown'
    const now = new Date().toISOString()

    // Accept mg/m³ directly; fall back to ppm and convert
    const co2_mg_m3 = body.co2_mg_m3 == null
      ? Number(body.co2_ppm || 0) * CO2_PPM_TO_MG
      : Number(body.co2_mg_m3)

    const ch4_mg_m3 = body.ch4_mg_m3 == null
      ? Number(body.ch4_ppm || 0) * CH4_PPM_TO_MG
      : Number(body.ch4_mg_m3)

    const reading: LiveReading = {
      device_id,
      facility_id,
      co2_mg_m3,
      ch4_mg_m3,
      temperature: Number(body.temperature) || 0,
      humidity:    Number(body.humidity)    || 0,
      energy_kwh:  Number(body.energy_kwh)  || 0,
      uptime_ms:   Number(body.uptime_ms)   || 0,
      received_at: now,
    }

    // Update fast-poll cache
    latestByDevice.set(device_id, reading)

    // Persist to Firestore (sensor_readings collection)
    const firestoreDoc = {
      device_id,
      facility_id,
      timestamp:         now,
      co2_mg_m3:         reading.co2_mg_m3,
      ch4_mg_m3:         reading.ch4_mg_m3,
      temperature:       reading.temperature,
      humidity:          reading.humidity,
      energy_kwh:        reading.energy_kwh,
      air_quality_index: Math.round(Math.max(0, Math.min(100, (reading.co2_mg_m3 - 720) / 7.2))),
      data_source:       'esp32',
      createdAt:         FieldValue.serverTimestamp(),
    }

    await adminDb.collection('sensor_readings').add(firestoreDoc)

    await adminDb.collection('devices').doc(device_id).update({
      last_seen: now,
      status:    'online',
      updatedAt: now,
    }).catch(() => {})

    console.log(`[ESP32] ${device_id} @ ${facility_id} — CO₂: ${reading.co2_mg_m3.toFixed(1)} mg/m³`)
    return NextResponse.json({ ok: true, received_at: now })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// GET — Dashboard polls this every 5 seconds
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const device_id = searchParams.get('device_id')

  if (device_id) {
    const reading = latestByDevice.get(device_id)
    if (!reading) return NextResponse.json({ connected: false })

    const age = Date.now() - new Date(reading.received_at).getTime()
    if (age > 30_000) {
      return NextResponse.json({ connected: false, last_seen: reading.received_at })
    }
    return NextResponse.json({ connected: true, ...reading })
  }

  let newest: LiveReading | null = null
  for (const r of latestByDevice.values()) {
    if (!newest || r.received_at > newest.received_at) newest = r
  }

  if (!newest) return NextResponse.json({ connected: false })

  const age = Date.now() - new Date(newest.received_at).getTime()
  if (age > 30_000) {
    return NextResponse.json({ connected: false, last_seen: newest.received_at })
  }
  return NextResponse.json({ connected: true, ...newest })
}
