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
  FileDown, Code2, Play, Trophy,
} from 'lucide-react'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

// ── Carbon constants (3,000 m³ Kgotso coverage, Harare 1,483 m) ───────────────
const MONITORING_VOL_M3  = 3_000
const HARARE_AIR_DENSITY = 1.09
const AMBIENT_PPM        = 420
const CO2_SCALE          = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (44.01 / 28.97)) / 1e6
const excessKgH = (ppm: number) => Math.max(0, ppm - AMBIENT_PPM) * CO2_SCALE

// Per-model line colours
const MODEL_COLORS: Record<string, string> = {
  gbr:            '#f97316',  // orange
  ridge:          '#8b5cf6',  // violet
  seasonal_naive: '#94a3b8',  // gray
}

interface Reading { ts: Date; source: string; ppm: number; temp: number; hum: number }
interface ModelForecast {
  key: string; label: string; is_best: boolean
  metrics: { r2: number; rmse: number; mae: number }
  forecast: { hour_offset: number; predicted_ppm: number }[]
}
interface CompareResult {
  success: boolean
  best: string
  baseline_ppm: number
  forecast_hours: number
  models: ModelForecast[]
}

function fmt(d: Date) {
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`
}
function toDateInput(d: Date) { return d.toISOString().slice(0, 10) }

export default function ForecastReportPage() {
  const [all,       setAll]       = useState<Reading[]>([])
  const [loading,   setLoading]   = useState(true)
  const [running,   setRunning]   = useState(false)
  const [showJson,  setShowJson]  = useState(false)

  const [source,    setSource]    = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [horizon,   setHorizon]   = useState(24)

  const [result,    setResult]    = useState<CompareResult | null>(null)
  const [ranAt,     setRanAt]     = useState<Date | null>(null)
  const [error,     setError]     = useState('')

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
        setSource(Array.from(new Set(rows.map(r => r.source)))[0])
        const last  = rows[rows.length - 1].ts
        setStartDate(toDateInput(new Date(last.getTime() - 7 * 86_400_000)))
        setEndDate(toDateInput(last))
      }
      setLoading(false)
    })()
  }, [])

  const sources = useMemo(() => Array.from(new Set(all.map(r => r.source))), [all])

  const seedWindow = useMemo(() => {
    if (!source || !startDate || !endDate) return [] as Reading[]
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate   + 'T23:59:59')
    return all.filter(r => r.source === source && r.ts >= s && r.ts <= e)
              .sort((a, b) => a.ts.getTime() - b.ts.getTime())
  }, [all, source, startDate, endDate])

  const modelSeed = seedWindow.slice(-48)

  const payload = useMemo(() => ({
    recent_co2:     modelSeed.map(r => r.ppm),
    last_timestamp: modelSeed.length ? modelSeed[modelSeed.length - 1].ts.toISOString() : null,
    forecast_hours: horizon,
  }), [modelSeed, horizon])

  async function runForecast() {
    setError('')
    if (modelSeed.length === 0) { setError('No readings in the selected source and date range.'); return }
    setRunning(true); setResult(null)
    try {
      const res = await fetch('/api/forecast-compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readings: modelSeed.map(r => ({ co2_ppm: r.ppm })),
          last_timestamp: payload.last_timestamp,
          forecast_hours: horizon,
        }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Comparison failed. Render may be cold-starting — try again.'); return }
      setResult(json as CompareResult)
      setRanAt(new Date())
    } catch (e) {
      setError('Request error: ' + String(e))
    } finally {
      setRunning(false)
    }
  }

  const bestModel = result?.models.find(m => m.is_best) ?? result?.models[0]

  // KPIs derived from the best model's forecast
  const bestPreds = bestModel?.forecast.map(f => f.predicted_ppm) ?? []
  const peakPpm   = bestPreds.length ? Math.max(...bestPreds) : 0
  const windowKg  = bestPreds.reduce((s, p) => s + excessKgH(p), 0)
  const monthlyTco2e = bestPreds.length ? (windowKg / bestPreds.length * 24 * 30 / 1000) : 0

  // Combined chart: history (actual) + one forecast line per model
  const chartData = useMemo(() => {
    if (!result) return [] as Record<string, number | string | undefined>[]
    const step = Math.max(1, Math.floor(seedWindow.length / 60))
    const hist = seedWindow
      .filter((_, i) => i % step === 0 || i === seedWindow.length - 1)
      .map(r => ({ label: fmt(r.ts), actual: r.ppm as number | undefined }))
    const base = modelSeed.length ? modelSeed[modelSeed.length - 1].ts : new Date()
    const fore = Array.from({ length: result.forecast_hours }, (_, i) => {
      const row: Record<string, number | string | undefined> = {
        label: fmt(new Date(base.getTime() + (i + 1) * 3_600_000)),
      }
      result.models.forEach(m => { row[m.key] = m.forecast[i]?.predicted_ppm })
      return row
    })
    return [...hist, ...fore]
  }, [result, seedWindow, modelSeed])

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forecast Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a source and date range — the app builds the request from stored readings, runs
            <span className="font-medium"> three forecast models</span>, and compares them.
          </p>
        </div>

        {/* Inputs */}
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Forecast Inputs</CardTitle>
            <CardDescription>Source + date range define the data sent to the models.</CardDescription>
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
                    <select value={source} onChange={e => setSource(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                      {sources.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}
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
                    <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                      <option value={12}>12 hours</option>
                      <option value={24}>24 hours</option>
                      <option value={48}>48 hours</option>
                    </select>
                  </div>
                </div>

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
                    {running ? 'Running 3 models…' : 'Generate Forecast Report'}
                  </Button>
                  {error && <span className="text-sm text-destructive">{error}</span>}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Report */}
        {result && bestModel && (
          <div className="space-y-5">
            {/* Header */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FileDown className="h-4 w-4" /> CO₂ Forecast Report — Model Comparison</CardTitle>
                    <CardDescription className="mt-1">
                      Source <span className="font-mono">{sourceLabel(source)}</span> · {startDate} → {endDate} · {horizon} h horizon
                      {ranAt && <> · generated {ranAt.toLocaleString()}</>}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 print:hidden">
                    <FileDown className="h-3.5 w-3.5" /> Print / Save PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Wind className="h-3 w-3" /> Baseline CO₂</p>
                    <p className="text-2xl font-bold tabular-nums">{result.baseline_ppm}</p>
                    <p className="text-xs text-muted-foreground">ppm (recent mean)</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Peak ({bestModel.label})</p>
                    <p className="text-2xl font-bold tabular-nums">{peakPpm}</p>
                    <p className="text-xs text-muted-foreground">ppm (next {horizon} h)</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" /> Window carbon</p>
                    <p className="text-2xl font-bold tabular-nums">{windowKg.toFixed(3)}</p>
                    <p className="text-xs text-muted-foreground">kg CO₂e over {horizon} h</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" /> Monthly projection</p>
                    <p className="text-2xl font-bold tabular-nums">{monthlyTco2e.toFixed(4)}</p>
                    <p className="text-xs text-muted-foreground">tCO₂e / month</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Comparison chart */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Forecast — 3 Models vs Actual</CardTitle></CardHeader>
              <CardContent className="h-80 pr-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={42} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${v} ppm`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={600} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '600 ppm', position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }} />
                    <Line type="monotone" dataKey="actual" stroke="#3b82f6" dot={false} strokeWidth={2} name="Actual" connectNulls={false} />
                    {result.models.map(m => (
                      <Line key={m.key} type="monotone" dataKey={m.key}
                        stroke={MODEL_COLORS[m.key] ?? '#64748b'} dot={false}
                        strokeWidth={m.is_best ? 2.5 : 1.5}
                        strokeDasharray={m.key === 'seasonal_naive' ? '2 3' : m.is_best ? undefined : '5 3'}
                        name={m.label + (m.is_best ? ' ★' : '')} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Metrics comparison */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Model Performance (held-out test set)</CardTitle>
                <CardDescription>Lower RMSE/MAE and higher R² are better. ★ = model used for the report KPIs.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="pb-2 pr-4">Model</th>
                      <th className="pb-2 pr-4">R²</th>
                      <th className="pb-2 pr-4">RMSE (ppm)</th>
                      <th className="pb-2">MAE (ppm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.models.map(m => (
                      <tr key={m.key} className={cn('border-b last:border-0', m.is_best && 'bg-primary/5')}>
                        <td className="py-2 pr-4 font-medium flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MODEL_COLORS[m.key] ?? '#64748b' }} />
                          {m.label}
                          {m.is_best && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{m.metrics.r2.toFixed(4)}</td>
                        <td className="py-2 pr-4 tabular-nums">{m.metrics.rmse.toFixed(2)}</td>
                        <td className="py-2 tabular-nums">{m.metrics.mae.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Per-model hour-by-hour */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Hour-by-Hour Forecast (all models, ppm)</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="pb-2 pr-4">+h</th>
                      {result.models.map(m => <th key={m.key} className="pb-2 pr-4">{m.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: result.forecast_hours }, (_, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 tabular-nums">{i + 1}</td>
                        {result.models.map(m => (
                          <td key={m.key} className="py-1.5 pr-4 tabular-nums">{m.forecast[i]?.predicted_ppm ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Methodology */}
            <Card>
              <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
                <p><span className="font-medium text-foreground">Models:</span> Gradient Boosting &amp; Ridge are trained autoregressive learners (lags 1/2/3/24 h + diurnal/seasonal features); Seasonal-Naïve predicts the value 24 h earlier (baseline).</p>
                <p>Carbon (KPIs, best model) = max(0, ppm − {AMBIENT_PPM}) × {MONITORING_VOL_M3.toLocaleString()} m³ × {HARARE_AIR_DENSITY} kg/m³ × (44.01/28.97) / 10⁶ per hour. Measured gas: CO₂.</p>
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </AppShell>
  )
}
