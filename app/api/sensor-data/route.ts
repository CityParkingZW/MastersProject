import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

interface LiveReading {
  device_id: string
  facility_id: string
  co2_ppm: number
  ch4_ppm: number
  temperature: number
  humidity: number
  energy_kwh: number
  uptime_ms: number
  received_at: string
}

// In-memory cache — keeps the last reading per device for fast polling
const latestByDevice = new Map<string, LiveReading>()

// POST — ESP32 sends sensor data here every ~10 seconds
// Expected body: { device_id, facility_id, co2_ppm, ch4_ppm, temperature, humidity, energy_kwh, uptime_ms }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const device_id: string = body.device_id || 'dev-unknown'
    const facility_id: string = body.facility_id || 'unknown'
    const now = new Date().toISOString()

    const reading: LiveReading = {
      device_id,
      facility_id,
      co2_ppm:     Number(body.co2_ppm)     || 0,
      ch4_ppm:     Number(body.ch4_ppm)     || 0,
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
      timestamp: now,
      co2_ppm:     reading.co2_ppm,
      ch4_ppm:     reading.ch4_ppm,
      temperature: reading.temperature,
      humidity:    reading.humidity,
      energy_kwh:  reading.energy_kwh,
      air_quality_index: Math.round(reading.co2_ppm / 10),
      data_source: 'esp32',
      createdAt: FieldValue.serverTimestamp(),
    }

    await adminDb.collection('sensor_readings').add(firestoreDoc)

    // Update device last_seen
    await adminDb.collection('devices').doc(device_id).update({
      last_seen: now,
      status: 'online',
      updatedAt: now,
    }).catch(() => {
      // Device doc may not exist yet — ignore silently
    })

    console.log(`[ESP32] ${device_id} @ ${facility_id} — CO2: ${reading.co2_ppm} ppm`)
    return NextResponse.json({ ok: true, received_at: now })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// GET — Dashboard polls this every 5 seconds
// Query param: ?device_id=dev-hps-001  (optional; returns all if omitted)
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

  // No device_id — return the most recent reading across all devices
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
