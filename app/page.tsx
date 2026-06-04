'use client'

import { useState, useEffect, useCallback } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
  Legend, Area, AreaChart,
} from 'recharts'
import { Thermometer, Droplets, Wind, MapPin, Activity, RefreshCw } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KgotsoReading {
  id:                   string
  source_id:            string
  timestamp:            Date
  co2_ppm:              number
  temperature_celsius:  number
  humidity_percent:     number
  data_source?:         string
}

interface ForecastPoint {
  hour_offset:   number
  predicted_ppm: number
  lower_ppm:     number
  upper_ppm:     number
  carbon_kg_h:   number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AMBIENT_PPM         = 420
const MONITORING_VOL_M3   = 3_000
const HARARE_AIR_DENSITY  = 1.09
const CO2_SCALE           = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (44.01 / 28.97)) / 1e6

function excessKgPerHour(ppm: number) {
  return Math.max(0, ppm - AMBIENT_PPM) * CO2_SCALE
}

function getAQ(co2: number) {
  if (co2 < 600)  return { label: 'Good',      bg: 'bg-green-500/10',  text: 'text-green-700 dark:text-green-400',  dot: 'bg-green-500'  }
  if (co2 < 800)  return { label: 'Moderate',  bg: 'bg-yellow-500/10', text: 'text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-500' }
  if (co2 < 1000) return { label: 'Poor',      bg: 'bg-orange-500/10', text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500' }
  return           { label: 'Very Poor',        bg: 'bg-red-500/10',    text: 'text-red-700 dark:text-red-400',      dot: 'bg-red-500'    }
}

function fmtTime(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KgotsoDashboard() {
  const { appUser }    = useAuth()
  const [readings,   setReadings]   = useState<KgotsoReading[]>([])
  const [forecast,   setForecast]   = useState<ForecastPoint[]>([])
  const [isLive,     setIsLive]     = useState(false)
  const [forecasting, setForecasting] = useState(false)
  const [forecastModel, setForecastModel] = useState<string>('')

  // ── Real-time listener ────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'kgotso_readings'),
      orderBy('timestamp', 'desc'),
      limit(168),
    )
    return onSnapshot(q, snap => {
      const docs: KgotsoReading[] = snap.docs.map(d => {
        const data = d.data()
        return {
          id:                  d.id,
          source_id:           data.source_id ?? 'ixxkut7za9s',
          timestamp:           data.timestamp?.toDate?.() ?? new Date(),
          co2_ppm:             data.co2_ppm,
          temperature_celsius: data.temperature_celsius,
          humidity_percent:    data.humidity_percent,
          data_source:         data.data_source,
        }
      }).reverse()
      setReadings(docs)
      const now = Date.now()
      setIsLive(docs.some(r => now - r.timestamp.getTime() < 5 * 60_000))
    })
  }, [])

  // ── Forecast trigger ──────────────────────────────────────────────────────
  const runForecast = useCallback(async (currentReadings: KgotsoReading[]) => {
    if (currentReadings.length === 0) return
    setForecasting(true)
    try {
      // Send up to 24 h of history so the model can use the lag_24 feature
      const window = currentReadings.slice(-24)
      const payload = {
        readings: window.map(r => ({
          co2_ppm:             r.co2_ppm,
          temperature_celsius: r.temperature_celsius,
          humidity_percent:    r.humidity_percent,
          hour:                r.timestamp.getHours(),
        })),
        last_timestamp: window[window.length - 1]?.timestamp.toISOString(),
        forecast_hours: 24,
      }
      const res  = await fetch('/api/predict-kgotso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json()
      if (json.success) {
        setForecast(json.forecast)
        const isRender = json.source === 'render-ml'
        setForecastModel(isRender
          ? (json.model_version ?? 'Render ML')
          : 'Local diurnal (Render offline)')
      }
    } finally {
      setForecasting(false)
    }
  }, [])

  // Auto-run forecast when readings change significantly
  useEffect(() => {
    if (readings.length > 0) runForecast(readings)
  }, [readings.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────────────
  const latest = readings[readings.length - 1]
  const aq     = latest ? getAQ(latest.co2_ppm) : null

  const step      = Math.max(1, Math.floor(readings.length / 72))
  const histData  = readings
    .filter((_, i) => i % step === 0 || i === readings.length - 1)
    .map(r => ({ time: fmtTime(r.timestamp), co2: r.co2_ppm, temp: r.temperature_celsius, humidity: r.humidity_percent }))

  // Build combined historical + forecast chart (last 24 h of history + 24 h forecast)
  const last24 = readings.slice(-24).map(r => ({
    label:     fmtTime(r.timestamp),
    actual:    r.co2_ppm,
    predicted: undefined as number | undefined,
    lower:     undefined as number | undefined,
    upper:     undefined as number | undefined,
  }))
  const forecastChart = forecast.slice(0, 24).map((f, i) => {
    const base    = latest?.timestamp ?? new Date()
    const futureD = new Date(base.getTime() + (i + 1) * 3_600_000)
    return {
      label:     fmtTime(futureD),
      actual:    undefined as number | undefined,
      predicted: f.predicted_ppm,
      lower:     f.lower_ppm,
      upper:     f.upper_ppm,
    }
  })
  const combinedChart = [...last24, ...forecastChart]

  // Monthly carbon footprint estimate (tCO2e)
  const monthCarbonKg = readings
    .filter(r => {
      const now = new Date()
      return r.timestamp.getMonth() === now.getMonth() && r.timestamp.getFullYear() === now.getFullYear()
    })
    .reduce((s, r) => s + excessKgPerHour(r.co2_ppm), 0)
  const projectedMonthlyTco2e = readings.length > 0
    ? ((monthCarbonKg / Math.max(readings.length, 1)) * 24 * 30 / 1000)
    : 0

  const co2Min  = readings.length ? Math.min(...readings.map(r => r.co2_ppm))  : 0
  const co2Max  = readings.length ? Math.max(...readings.map(r => r.co2_ppm))  : 0
  const tempAvg = readings.length ? Math.round(readings.reduce((s,r)=>s+r.temperature_celsius,0)/readings.length) : 0
  const humAvg  = readings.length ? Math.round(readings.reduce((s,r)=>s+r.humidity_percent,0)/readings.length)  : 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Air Quality Dashboard</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Harare, Zimbabwe</span>
              <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Kgotso ClimateHealth</span>
              {latest && <span>Last reading: {fmtTime(latest.timestamp)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {aq && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium ${aq.bg} ${aq.text}`}>
                <span className={`h-2 w-2 rounded-full ${aq.dot}`} />
                Air Quality: {aq.label}
              </div>
            )}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border ${isLive ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400' : 'border-border text-muted-foreground'}`}>
              <span className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {isLive ? 'Live' : 'Historical'}
            </div>
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Wind className="h-4 w-4" /> CO₂
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums">{latest?.co2_ppm ?? '—'}</span>
                <span className="text-sm text-muted-foreground">ppm</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Min {co2Min} / Max {co2Max}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Thermometer className="h-4 w-4" /> Temperature
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums">{latest?.temperature_celsius ?? '—'}</span>
                <span className="text-sm text-muted-foreground">°C</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Avg {tempAvg}°C</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Droplets className="h-4 w-4" /> Humidity
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums">{latest?.humidity_percent ?? '—'}</span>
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Avg {humAvg}%</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" /> Carbon Footprint
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums">{projectedMonthlyTco2e.toFixed(3)}</span>
                <span className="text-sm text-muted-foreground">tCO₂e/mo</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Scope 1 projection · {MONITORING_VOL_M3} m³</p>
            </CardContent>
          </Card>
        </div>

        {/* Forecast + history combined */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>CO₂ Forecast — Next 24 Hours</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last 24 h actual + 24 h ML prediction with confidence band
                  {forecastModel && <span className="ml-1">· <span className="font-medium">{forecastModel}</span></span>}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={forecasting} onClick={() => runForecast(readings)} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${forecasting ? 'animate-spin' : ''}`} />
                {forecasting ? 'Forecasting…' : 'Re-run'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-72 pr-4">
            {combinedChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                No data yet — run the seed or replay script.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={combinedChart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [`${v} ppm`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={600} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '600 ppm', position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }} />
                  <ReferenceLine x={last24.at(-1)?.label} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: 'Now', position: 'insideTopLeft', fontSize: 10, fill: '#94a3b8' }} />
                  <Line type="monotone" dataKey="actual"    stroke="#3b82f6" dot={false} strokeWidth={2} name="Actual CO₂ (ppm)"    connectNulls={false} />
                  <Line type="monotone" dataKey="predicted" stroke="#f97316" dot={false} strokeWidth={2} name="Forecast CO₂ (ppm)"  connectNulls={false} strokeDasharray="5 3" />
                  <Line type="monotone" dataKey="upper"     stroke="#f9731640" dot={false} strokeWidth={1} name="Upper bound"        connectNulls={false} strokeDasharray="2 4" />
                  <Line type="monotone" dataKey="lower"     stroke="#f9731640" dot={false} strokeWidth={1} name="Lower bound"        connectNulls={false} strokeDasharray="2 4" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Historical trend */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">CO₂ History ({readings.length} readings)</CardTitle>
            </CardHeader>
            <CardContent className="h-52 pr-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9 }} width={36} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${v} ppm`, 'CO₂']} />
                  <ReferenceLine y={600} stroke="#f59e0b" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="co2" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} dot={false} name="CO₂ ppm" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Temperature &amp; Humidity</CardTitle>
            </CardHeader>
            <CardContent className="h-52 pr-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="t" domain={['auto','auto']} tick={{ fontSize: 9 }} width={30} />
                  <YAxis yAxisId="h" orientation="right" domain={[0,100]} tick={{ fontSize: 9 }} width={30} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="t" type="monotone" dataKey="temp"     stroke="#ef4444" dot={false} strokeWidth={1.5} name="Temp (°C)"   />
                  <Line yAxisId="h" type="monotone" dataKey="humidity" stroke="#06b6d4" dot={false} strokeWidth={1.5} name="Humidity (%)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Air quality reference */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Indoor CO₂ Reference Levels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[
                { range: '< 600 ppm',    label: 'Good',      desc: 'Excellent ventilation', c: 'text-green-600'  },
                { range: '600–800 ppm',  label: 'Moderate',  desc: 'Consider airing out',   c: 'text-yellow-600' },
                { range: '800–1000 ppm', label: 'Poor',      desc: 'Open windows',           c: 'text-orange-600' },
                { range: '> 1000 ppm',   label: 'Very Poor', desc: 'Ventilate immediately',  c: 'text-red-600'    },
              ].map(({ range, label, desc, c }) => (
                <div key={label} className="rounded-md border p-3 space-y-1">
                  <p className={`font-semibold ${c}`}>{label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{range}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  )
}
