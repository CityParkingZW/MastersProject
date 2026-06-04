'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import {
  Loader2, TrendingUp, MapPin, Calendar, Wind, Scale,
  FileDown, Code2, Play,
} from 'lucide-react'

// ── Carbon constants (3,000 m³ Kgotso coverage, Harare 1,483 m) ───────────────
const MONITORING_VOL_M3  = 3_000
const AMBIENT_PPM        = 420

interface Reading { ts: Date; source: string; ppm: number; temp: number; hum: number }
interface ForecastPoint { hour_offset: number; predicted_ppm: number; lower_ppm: number; upper_ppm: number; carbon_kg_h: number }
interface ForecastResult {
  success: boolean
  source?: string
  model_version?: string
  baseline_ppm?: number
  forecast: ForecastPoint[]
  carbon_summary?: { forecast_window_kg: number; monthly_projection_tco2e: number; monitoring_vol_m3: number; method?: string }
}

function fmt(d: Date) {
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`
}
function toDateInput(d: Date) { return d.toISOString().slice(0, 10) }

export default function ForecastReportPage() {
  const [all,        setAll]        = useState<Reading[]>([])
  const [loading,    setLoading]    = useState(true)
  const [running,    setRunning]    = useState(false)
  const [showJson,   setShowJson]   = useState(false)

  const [source,     setSource]     = useState('')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [horizon,    setHorizon]    = useState(24)

  const [result,     setResult]     = useState<ForecastResult | null>(null)
  const [ranAt,      setRanAt]      = useState<Date | null>(null)
  const [error,      setError]      = useState('')

  // ── Load readings once (also gives us sources + date bounds) ────────────────
  useEffect(() => {
    (async () => {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'kgotso_readings'), orderBy('timestamp', 'asc')))
      const rows: Reading[] = snap.docs.flatMap(d => {
        const x = d.data()
        const ts = x.timestamp?.toDate?.() as Date | undefined
        if (!ts || typeof x.co2_ppm !== 'number') return []
        return [{ ts, source: x.source_id ?? 'ixxkut7za9s', ppm: x.co2_ppm, temp: x.temperature_celsius ?? 0, hum: x.humidity_percent ?? 0 }]
      })
      setAll(rows)
      if (rows.length) {
        const srcs = Array.from(new Set(rows.map(r => r.source)))
        setSource(srcs[0])
        const last  = rows[rows.length - 1].ts
        const start = new Date(last.getTime() - 7 * 86_400_000) // default: last 7 days
        setStartDate(toDateInput(start))
        setEndDate(toDateInput(last))
      }
      setLoading(false)
    })()
  }, [])

  const sources = useMemo(() => Array.from(new Set(all.map(r => r.source))), [all])

  // ── The seed window selected by source + date range ────────────────────────
  const seedWindow = useMemo(() => {
    if (!source || !startDate || !endDate) return [] as Reading[]
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate   + 'T23:59:59')
    return all
      .filter(r => r.source === source && r.ts >= s && r.ts <= e)
      .sort((a, b) => a.ts.getTime() - b.ts.getTime())
  }, [all, source, startDate, endDate])

  // Model uses lag-1..lag-24, so seed with up to the last 48 hours of the range
  const modelSeed = seedWindow.slice(-48)

  // ── The exact JSON payload that will be POSTed ──────────────────────────────
  const payload = useMemo(() => ({
    recent_co2:     modelSeed.map(r => r.ppm),
    last_timestamp: modelSeed.length ? modelSeed[modelSeed.length - 1].ts.toISOString() : null,
    forecast_hours: horizon,
  }), [modelSeed, horizon])

  async function runForecast() {
    setError('')
    if (modelSeed.length === 0) { setError('No readings in the selected source and date range.'); return }
    setRunning(true)
    setResult(null)
    try {
      // We post via the app route (forwards to Render, falls back to local model)
      const res = await fetch('/api/predict-kgotso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readings: modelSeed.map(r => ({
            co2_ppm: r.ppm, temperature_celsius: r.temp, humidity_percent: r.hum, hour: r.ts.getHours(),
          })),
          last_timestamp: payload.last_timestamp,
          forecast_hours: horizon,
        }),
      })
      const json = await res.json() as ForecastResult
      if (!json.success) { setError('Forecast failed. Try again (Render may be cold-starting).'); return }
      setResult(json)
      setRanAt(new Date())
    } catch (e) {
      setError('Request error: ' + String(e))
    } finally {
      setRunning(false)
    }
  }

  // ── Build combined chart: historical seed window + forecast ─────────────────
  const chartData = useMemo(() => {
    if (!result) return []
    const histStep = Math.max(1, Math.floor(seedWindow.length / 60))
    const hist = seedWindow
      .filter((_, i) => i % histStep === 0 || i === seedWindow.length - 1)
      .map(r => ({ label: fmt(r.ts), actual: r.ppm as number | undefined, predicted: undefined as number | undefined, lower: undefined as number | undefined, upper: undefined as number | undefined }))
    const base = modelSeed.length ? modelSeed[modelSeed.length - 1].ts : new Date()
    const fore = result.forecast.map((f, i) => ({
      label:     fmt(new Date(base.getTime() + (i + 1) * 3_600_000)),
      actual:    undefined as number | undefined,
      predicted: f.predicted_ppm,
      lower:     f.lower_ppm,
      upper:     f.upper_ppm,
    }))
    return [...hist, ...fore]
  }, [result, seedWindow, modelSeed])

  const cs = result?.carbon_summary

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forecast Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select a monitoring source and date range — the app builds the request from the stored
            readings, runs the CO₂ forecast model, and produces a report.
          </p>
        </div>

        {/* ── Input form ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Forecast Inputs</CardTitle>
            <CardDescription>Source + date range define the data sent to the model.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex h-20 items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading readings…
              </div>
            ) : (
              <>
                <div className="grid sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Source</label>
                    <select
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {sources.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Start date</label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> End date</label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Horizon</label>
                    <select
                      value={horizon}
                      onChange={e => setHorizon(Number(e.target.value))}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value={12}>12 hours</option>
                      <option value={24}>24 hours</option>
                      <option value={48}>48 hours</option>
                    </select>
                  </div>
                </div>

                {/* Seed summary + JSON preview */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{seedWindow.length} readings in range</Badge>
                  <Badge variant="outline">{modelSeed.length} sent as model seed (last 48 h)</Badge>
                  <button onClick={() => setShowJson(v => !v)} className="inline-flex items-center gap-1 underline hover:text-foreground">
                    <Code2 className="h-3 w-3" /> {showJson ? 'Hide' : 'Show'} POST JSON
                  </button>
                </div>
                {showJson && (
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-48 overflow-y-auto">
{JSON.stringify(payload, null, 2)}
                  </pre>
                )}

                <div className="flex items-center gap-3">
                  <Button onClick={runForecast} disabled={running || modelSeed.length === 0} className="gap-1.5">
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {running ? 'Forecasting…' : 'Generate Forecast Report'}
                  </Button>
                  {error && <span className="text-sm text-destructive">{error}</span>}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Report output ──────────────────────────────────────────────── */}
        {result && cs && (
          <div className="space-y-5">
            {/* Report header */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FileDown className="h-4 w-4" /> CO₂ Forecast Report</CardTitle>
                    <CardDescription className="mt-1">
                      Source <span className="font-mono">{source}</span> · {startDate} → {endDate} · {horizon} h horizon
                      {ranAt && <> · generated {ranAt.toLocaleString()}</>}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {result.source === 'render-ml' ? 'Render GBR model' : (result.model_version ?? 'model')}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                      <FileDown className="h-3.5 w-3.5" /> Print / Save PDF
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Wind className="h-3 w-3" /> Baseline CO₂</p>
                    <p className="text-2xl font-bold tabular-nums">{result.baseline_ppm ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">ppm (recent mean)</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Peak forecast</p>
                    <p className="text-2xl font-bold tabular-nums">{Math.max(...result.forecast.map(f => f.predicted_ppm))}</p>
                    <p className="text-xs text-muted-foreground">ppm (next {horizon} h)</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" /> Window carbon</p>
                    <p className="text-2xl font-bold tabular-nums">{cs.forecast_window_kg.toFixed(3)}</p>
                    <p className="text-xs text-muted-foreground">kg CO₂e over {horizon} h</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" /> Monthly projection</p>
                    <p className="text-2xl font-bold tabular-nums">{cs.monthly_projection_tco2e.toFixed(4)}</p>
                    <p className="text-xs text-muted-foreground">tCO₂e / month</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Chart */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Historical (selected range) + Forecast</CardTitle></CardHeader>
              <CardContent className="h-72 pr-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={42} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${v} ppm`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={600} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '600 ppm', position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }} />
                    <Line type="monotone" dataKey="actual"    stroke="#3b82f6" dot={false} strokeWidth={2} name="Actual" connectNulls={false} />
                    <Line type="monotone" dataKey="predicted" stroke="#f97316" dot={false} strokeWidth={2} name="Forecast" strokeDasharray="5 3" connectNulls={false} />
                    <Line type="monotone" dataKey="upper"     stroke="#f9731640" dot={false} strokeWidth={1} name="Upper" strokeDasharray="2 4" connectNulls={false} />
                    <Line type="monotone" dataKey="lower"     stroke="#f9731640" dot={false} strokeWidth={1} name="Lower" strokeDasharray="2 4" connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Forecast table */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Hour-by-Hour Forecast</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="pb-2 pr-4">+h</th>
                      <th className="pb-2 pr-4">Predicted</th>
                      <th className="pb-2 pr-4">Range (lower–upper)</th>
                      <th className="pb-2">Carbon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.forecast.map(f => (
                      <tr key={f.hour_offset} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 tabular-nums">{f.hour_offset}</td>
                        <td className="py-1.5 pr-4 tabular-nums font-medium">{f.predicted_ppm} ppm</td>
                        <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">{f.lower_ppm} – {f.upper_ppm}</td>
                        <td className="py-1.5 tabular-nums">{f.carbon_kg_h.toFixed(4)} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Methodology */}
            <Card>
              <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
                <p><span className="font-medium text-foreground">Method:</span> {cs.method ?? 'autoregressive CO₂ forecast + Harare altitude carbon density'}</p>
                <p>Carbon = max(0, ppm − {AMBIENT_PPM}) × {MONITORING_VOL_M3.toLocaleString()} m³ × 1.09 kg/m³ × (44.01/28.97) / 10⁶ per hour. Measured gas: CO₂.</p>
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </AppShell>
  )
}
