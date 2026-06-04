/**
 * /api/forecast-compare
 * Proxies to the Render ML service's /kgotso/compare endpoint, which returns
 * forecasts from all three models (Gradient Boosting, Ridge, Seasonal-Naive)
 * plus their held-out metrics. Requires the trained models, so there is no
 * local fallback — if Render is unavailable it surfaces an error.
 */

import { NextResponse } from 'next/server'

interface CompareRequest {
  readings:        { co2_ppm: number }[]
  last_timestamp?: string
  forecast_hours:  number
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as CompareRequest
    if (!Array.isArray(body.readings) || body.readings.length === 0) {
      return NextResponse.json({ error: 'readings array required' }, { status: 400 })
    }

    const renderUrl = process.env.RENDER_ML_URL ?? process.env.KGOTSO_ML_URL
    if (!renderUrl) {
      return NextResponse.json(
        { error: 'Model comparison requires the Render ML service (RENDER_ML_URL not set).' },
        { status: 503 },
      )
    }

    const res = await fetch(`${renderUrl.replace(/\/$/, '')}/kgotso/compare`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recent_co2:     body.readings.map(r => r.co2_ppm),
        last_timestamp: body.last_timestamp ?? null,
        forecast_hours: Math.min(body.forecast_hours ?? 24, 48),
      }),
      signal: AbortSignal.timeout(45_000),  // allow for cold start
    })

    if (!res.ok) {
      const detail = await res.text()
      return NextResponse.json({ error: 'Render compare failed', detail }, { status: 502 })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: 'Comparison request failed (Render may be cold-starting — try again)', detail: String(err) },
      { status: 504 },
    )
  }
}
