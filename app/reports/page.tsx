'use client'

import { useState, useEffect } from 'react'
import {
  collection, query, orderBy, getDocs, addDoc, doc, updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  CheckCircle, Database, FileText, ShieldCheck,
  Clock, Plus, Loader2, Wind, Scale, TrendingUp, FileDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Carbon accounting constants (3,000 m³ Kgotso coverage, Harare 1,483 m) ────
const MONITORING_VOL_M3   = 3_000
const HARARE_AIR_DENSITY  = 1.09
const CO2_MOL_MASS        = 44.01
const AIR_MOL_MASS        = 28.97
const AMBIENT_CO2_PPM     = 420
const CO2_SCALE           = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (CO2_MOL_MASS / AIR_MOL_MASS)) / 1e6

function excessKgH(ppm: number) {
  return Math.max(0, ppm - AMBIENT_CO2_PPM) * CO2_SCALE
}

const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface MonthReading { ts: Date; ppm: number; temp: number; hum: number }

interface KgotsoReport {
  id:                    string
  report_id:             string
  period_label:          string
  period_start:          string
  period_end:            string
  measured_gas:          string
  // Monitoring
  avg_co2_ppm:           number
  max_co2_ppm:           number
  min_co2_ppm:           number
  avg_temp_c:            number
  avg_humidity_pct:      number
  reading_count:         number
  data_completeness_pct: number
  // Reporting / accounting
  total_co2e_tonne:      number
  // Prediction
  projected_next_month_tco2e: number | null
  model_version:         string
  // Verification
  verification_status:   'pending' | 'verified'
  summary?:              string
  methodology_notes?:    string
  generated_at:          string
  generated_by?:         string
}

const statusConfig = {
  pending:  { icon: Clock,       color: 'text-yellow-600', bg: 'bg-yellow-500/10 border-yellow-500/30', label: 'Pending Verification' },
  verified: { icon: CheckCircle, color: 'text-green-600',  bg: 'bg-green-500/10 border-green-500/30',   label: 'Verified' },
}

export default function MRVReportsPage() {
  const { appUser } = useAuth()
  const isAdmin = appUser?.role === 'admin'

  const [allReadings, setAllReadings] = useState<MonthReading[]>([])
  const [reports,      setReports]    = useState<KgotsoReport[]>([])
  const [loading,      setLoading]    = useState(true)
  const [generating,   setGenerating] = useState<string | null>(null)
  const [editReport,   setEditReport] = useState<KgotsoReport | null>(null)
  const [editSummary,  setEditSummary]= useState('')
  const [savingEdit,   setSavingEdit] = useState(false)

  // Months covered by the dataset
  const availableMonths: { year: number; month: number; label: string }[] = []
  for (let d = new Date(2023, 5, 1); d <= new Date(2024, 4, 1); d.setMonth(d.getMonth() + 1)) {
    availableMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` })
  }

  async function loadAll() {
    setLoading(true)
    const [readSnap, repSnap] = await Promise.all([
      getDocs(query(collection(db, 'kgotso_readings'), orderBy('timestamp', 'asc'))),
      getDocs(query(collection(db, 'kgotso_reports'),  orderBy('period_start', 'desc'))),
    ])
    setAllReadings(readSnap.docs.flatMap(d => {
      const data = d.data()
      const ts = data.timestamp?.toDate?.() as Date | undefined
      if (!ts || typeof data.co2_ppm !== 'number') return []
      return [{ ts, ppm: data.co2_ppm, temp: data.temperature_celsius ?? 0, hum: data.humidity_percent ?? 0 }]
    }))
    setReports(repSnap.docs.map(d => ({ id: d.id, ...d.data() } as KgotsoReport)))
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function generateReport(year: number, month: number) {
    const key = `${year}-${String(month).padStart(2,'0')}`
    setGenerating(key)
    try {
      const rows = allReadings
        .filter(r => r.ts.getFullYear() === year && r.ts.getMonth() + 1 === month)
        .sort((a, b) => a.ts.getTime() - b.ts.getTime())

      if (rows.length === 0) { alert(`No data for ${MONTH_NAMES[month-1]} ${year}.`); return }

      const ppms        = rows.map(r => r.ppm)
      const avg_ppm     = Math.round(ppms.reduce((s,v)=>s+v,0) / ppms.length)
      const max_ppm     = Math.max(...ppms)
      const min_ppm     = Math.min(...ppms)
      const avg_temp    = Math.round(rows.reduce((s,r)=>s+r.temp,0) / rows.length)
      const avg_hum     = Math.round(rows.reduce((s,r)=>s+r.hum,0) / rows.length)
      const co2e_kg     = rows.reduce((s,r)=>s+excessKgH(r.ppm),0)
      const completeness= Math.min(100, Math.round((rows.length / 720) * 100))

      // ── Prediction: ask the Render GBR model for next-month projection ──────
      let projected: number | null = null
      let modelVersion = 'accounting-only'
      try {
        const last24 = rows.slice(-24)
        const res = await fetch('/api/predict-kgotso', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            readings: last24.map(r => ({
              co2_ppm: r.ppm, temperature_celsius: r.temp, humidity_percent: r.hum, hour: r.ts.getHours(),
            })),
            last_timestamp: last24[last24.length - 1]?.ts.toISOString(),
            forecast_hours: 24,
          }),
        })
        const json = await res.json()
        if (json.success) {
          projected    = json.carbon_summary?.monthly_projection_tco2e ?? null
          modelVersion = json.model_version ?? (json.source === 'render-ml' ? 'Render GBR' : 'local diurnal')
        }
      } catch { /* prediction best-effort; report still valid without it */ }

      const startDate = new Date(year, month - 1, 1)
      const endDate   = new Date(year, month, 0)

      await addDoc(collection(db, 'kgotso_reports'), {
        report_id:             `KGOTSO-MRV-${key}`,
        period_label:          `${MONTH_NAMES[month-1]} ${year}`,
        period_start:          startDate.toISOString().slice(0,10),
        period_end:            endDate.toISOString().slice(0,10),
        measured_gas:          'CO₂',
        avg_co2_ppm:           avg_ppm,
        max_co2_ppm:           max_ppm,
        min_co2_ppm:           min_ppm,
        avg_temp_c:            avg_temp,
        avg_humidity_pct:      avg_hum,
        reading_count:         rows.length,
        data_completeness_pct: completeness,
        total_co2e_tonne:      Number((co2e_kg / 1000).toFixed(6)),
        projected_next_month_tco2e: projected,
        model_version:         modelVersion,
        verification_status:   'pending',
        summary:               '',
        methodology_notes:     `Measured gas: CO₂ (ppm). Scope 1 excess-CO₂ accounting over a ${MONITORING_VOL_M3} m³ coverage area (Kgotso ClimateHealth, Harare, 1,483 m, air density 1.09 kg/m³, ambient baseline 420 ppm). Excess CO₂ = max(0, ppm − 420) × ${MONITORING_VOL_M3} × 1.09 × (44.01/28.97) / 10⁶ kg per hour, summed across the month. Next-month projection from the ${modelVersion} forecast model.`,
        generated_at:          new Date().toISOString(),
        generated_by:          appUser?.uid ?? 'system',
      })

      await loadAll()
    } finally {
      setGenerating(null)
    }
  }

  async function saveVerification() {
    if (!editReport) return
    setSavingEdit(true)
    await updateDoc(doc(db, 'kgotso_reports', editReport.id), {
      summary: editSummary,
      verification_status: 'verified',
    })
    setSavingEdit(false)
    setEditReport(null)
    await loadAll()
  }

  const reportedKeys = new Set(reports.map(r => r.period_start?.slice(0,7)))

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MRV Framework</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitoring, Reporting &amp; Verification — Kgotso ClimateHealth · Zimbabwe Carbon Monitor
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 print:hidden shrink-0">
            <FileDown className="h-3.5 w-3.5" /> Print / Save PDF
          </Button>
        </div>

        {/* Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Framework Overview</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              The MRV (Monitoring, Reporting, and Verification) framework ensures accurate,
              transparent, and auditable carbon emissions tracking using an IoT-enabled system.
            </p>
            <p>
              This implementation aligns with international best practices such as the
              GHG Protocol and ISO 14064, adapted for a cloud-based, real-time monitoring environment.
            </p>
          </CardContent>
        </Card>

        {/* Layers */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-sm">Monitoring</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">IoT Layer</Badge>
              <p>Real-time environmental data collection using ESP32 devices and CO₂ sensors.</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>CO₂ readings (ppm)</li>
                <li>Timestamped sensor data</li>
                <li>Firebase Firestore storage</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-4 w-4 text-purple-600" />
              <CardTitle className="text-sm">Reporting</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">Analytics Layer</Badge>
              <p>Aggregation and transformation of sensor data into structured MRV reports.</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Average, max, min CO₂</li>
                <li>Total emissions (tCO₂e)</li>
                <li>Monthly report generation</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <CardTitle className="text-sm">Verification</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">Validation Layer</Badge>
              <p>Ensures data integrity and audit readiness through review workflows.</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Admin review &amp; approval</li>
                <li>Status: Pending / Verified</li>
                <li>Audit metadata tracking</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            GENERATOR — month-by-month MRV-framed reports
           ════════════════════════════════════════════════════════════════ */}
        <div className="pt-2">
          <h2 className="text-lg font-bold tracking-tight">Generate MRV Reports</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each report applies the three MRV layers to one month of measured CO₂ data:
            monitoring statistics, carbon accounting (tCO₂e), and a model-projected next-month footprint.
          </p>
        </div>

        {/* Generate controls (admin only) */}
        {isAdmin ? (
          <Card className="print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Select a month to generate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {availableMonths.map(({ year, month, label }) => {
                  const key    = `${year}-${String(month).padStart(2,'0')}`
                  const exists = reportedKeys.has(key)
                  const busy   = generating === key
                  return (
                    <Button
                      key={key}
                      variant={exists ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={!!generating || exists || loading}
                      onClick={() => generateReport(year, month)}
                      className="text-xs"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                      {label}{exists && ' ✓'}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Generating fetches that month's readings, computes the carbon footprint, and calls the
                forecast model for the next-month projection. Months already generated are marked ✓.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              Sign in as an administrator to generate or verify reports. Existing reports are shown below.
            </CardContent>
          </Card>
        )}

        {/* Report list */}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 gap-2 text-muted-foreground">
              <FileText className="h-7 w-7" />
              <p className="text-sm">No reports generated yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const sc = statusConfig[r.verification_status] ?? statusConfig.pending
              const Icon = sc.icon
              return (
                <Card key={r.id}>
                  <CardContent className="pt-5 pb-4 px-5 space-y-4">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.period_label}</span>
                        <span className="text-xs text-muted-foreground font-mono">{r.report_id}</span>
                        <Badge variant="outline" className={cn('text-xs', sc.bg, sc.color)}>
                          <Icon className="h-3 w-3 mr-1" />{sc.label}
                        </Badge>
                        <Badge variant="outline" className="text-xs">Gas: {r.measured_gas}</Badge>
                      </div>
                      {isAdmin && (
                        <Button variant="outline" size="sm" className="shrink-0 print:hidden"
                          onClick={() => { setEditReport(r); setEditSummary(r.summary ?? '') }}>
                          {r.verification_status === 'verified' ? 'Edit' : 'Review & Verify'}
                        </Button>
                      )}
                    </div>

                    {/* Three MRV layers */}
                    <div className="grid sm:grid-cols-3 gap-3">
                      {/* Monitoring */}
                      <div className="rounded-md border p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                          <Database className="h-3.5 w-3.5" /> Monitoring
                        </div>
                        <div className="text-sm space-y-0.5">
                          <p className="flex justify-between"><span className="text-muted-foreground">Avg CO₂</span><span className="tabular-nums font-medium">{r.avg_co2_ppm} ppm</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Max / Min</span><span className="tabular-nums">{r.max_co2_ppm} / {r.min_co2_ppm}</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Avg temp</span><span className="tabular-nums">{r.avg_temp_c} °C</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Avg humidity</span><span className="tabular-nums">{r.avg_humidity_pct} %</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Readings</span><span className="tabular-nums">{r.reading_count}</span></p>
                        </div>
                      </div>

                      {/* Reporting / Accounting */}
                      <div className="rounded-md border p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600">
                          <Scale className="h-3.5 w-3.5" /> Reporting &amp; Accounting
                        </div>
                        <div className="text-sm space-y-0.5">
                          <p className="text-muted-foreground text-xs">Measured carbon footprint</p>
                          <p className="text-2xl font-bold tabular-nums">{r.total_co2e_tonne.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">tCO₂e (Scope 1, {MONITORING_VOL_M3.toLocaleString()} m³)</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                            <TrendingUp className="h-3 w-3" />
                            Next-month projection:&nbsp;
                            <span className="font-medium text-foreground tabular-nums">
                              {r.projected_next_month_tco2e != null ? `${r.projected_next_month_tco2e.toFixed(4)} tCO₂e` : '—'}
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* Verification */}
                      <div className="rounded-md border p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
                          <ShieldCheck className="h-3.5 w-3.5" /> Verification
                        </div>
                        <div className="text-sm space-y-0.5">
                          <p className="flex justify-between"><span className="text-muted-foreground">Status</span><span className={cn('font-medium', sc.color)}>{sc.label}</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Completeness</span>
                            <span className={cn('tabular-nums font-medium', r.data_completeness_pct >= 80 ? 'text-green-600' : 'text-yellow-600')}>{r.data_completeness_pct}%</span>
                          </p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="text-xs">{r.model_version}</span></p>
                        </div>
                      </div>
                    </div>

                    {r.summary && (
                      <div className="text-sm">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Executive Summary</span>
                        <p className="text-muted-foreground mt-0.5">{r.summary}</p>
                      </div>
                    )}

                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">Methodology notes</summary>
                      <p className="text-xs text-muted-foreground mt-1">{r.methodology_notes}</p>
                    </details>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Verify dialog */}
        <Dialog open={!!editReport} onOpenChange={open => { if (!open) setEditReport(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Review &amp; Verify — {editReport?.period_label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Avg CO₂</span><p className="font-medium">{editReport?.avg_co2_ppm} ppm</p></div>
                <div><span className="text-muted-foreground">Footprint</span><p className="font-medium">{editReport?.total_co2e_tonne.toFixed(4)} tCO₂e</p></div>
                <div><span className="text-muted-foreground">Next-month projection</span><p className="font-medium">{editReport?.projected_next_month_tco2e != null ? `${editReport.projected_next_month_tco2e.toFixed(4)} tCO₂e` : '—'}</p></div>
                <div><span className="text-muted-foreground">Completeness</span><p className="font-medium">{editReport?.data_completeness_pct}%</p></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="summary">Executive Summary</Label>
                <Textarea id="summary" rows={5} value={editSummary} onChange={e => setEditSummary(e.target.value)}
                  placeholder="Summarize the monitoring period, key findings, anomalies, and verification notes…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditReport(null)}>Cancel</Button>
              <Button disabled={savingEdit} onClick={saveVerification}>
                {savingEdit && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Verify &amp; Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AppShell>
  )
}
