'use client'

import { useState, useEffect } from 'react'
import {
  collection, query, orderBy, getDocs, addDoc,
  doc, updateDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, FileText, CheckCircle, Clock, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Carbon calc ────────────────────────────────────────────────────────────────
const MONITORING_VOL_M3   = 3_000
const HARARE_AIR_DENSITY  = 1.09
const CO2_MOL_MASS        = 44.01
const AIR_MOL_MASS        = 28.97
const AMBIENT_CO2_PPM     = 420
const CO2_SCALE           = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (CO2_MOL_MASS / AIR_MOL_MASS)) / 1e6

function excessKgH(ppm: number) {
  return Math.max(0, ppm - AMBIENT_CO2_PPM) * CO2_SCALE
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const SHORT_MONTHS= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

interface KgotsoReport {
  id:                    string
  report_id:             string
  period_label:          string     // 'June 2023'
  period_start:          string
  period_end:            string
  avg_co2_ppm:           number
  max_co2_ppm:           number
  min_co2_ppm:           number
  total_co2e_tonne:      number
  reading_count:         number
  data_completeness_pct: number
  verification_status:   'pending' | 'verified'
  summary?:              string
  methodology_notes?:    string
  generated_at:          string
  generated_by?:         string
}

const statusConfig = {
  pending:  { icon: Clock,        color: 'text-yellow-600',  bg: 'bg-yellow-500/10 border-yellow-500/30',  label: 'Pending' },
  verified: { icon: CheckCircle,  color: 'text-green-600',   bg: 'bg-green-500/10 border-green-500/30',    label: 'Verified' },
}

export default function ReportsPage() {
  const { appUser } = useAuth()
  const isAdmin = appUser?.role === 'admin'

  const [reports,     setReports]     = useState<KgotsoReport[]>([])
  const [loading,     setLoading]     = useState(true)
  const [generating,  setGenerating]  = useState(false)
  const [editReport,  setEditReport]  = useState<KgotsoReport | null>(null)
  const [editSummary, setEditSummary] = useState('')
  const [savingEdit,  setSavingEdit]  = useState(false)

  // Available months from the dataset
  const availableMonths: { year: number; month: number; label: string }[] = []
  const start = new Date(2023, 5, 1)  // June 2023
  const end   = new Date(2024, 4, 1)  // May 2024
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    availableMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` })
  }

  async function loadReports() {
    setLoading(true)
    const snap = await getDocs(query(collection(db, 'kgotso_reports'), orderBy('period_start', 'desc')))
    setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as KgotsoReport)))
    setLoading(false)
  }

  useEffect(() => { loadReports() }, [])

  async function generateReport(year: number, month: number) {
    setGenerating(true)
    try {
      // Fetch all readings for this month
      const snap = await getDocs(
        query(collection(db, 'kgotso_readings'), orderBy('timestamp', 'asc'))
      )
      const rows = snap.docs
        .map(d => {
          const data = d.data()
          const ts   = data.timestamp?.toDate?.() as Date | undefined
          if (!ts || typeof data.co2_ppm !== 'number') return null
          if (ts.getFullYear() !== year || ts.getMonth() + 1 !== month) return null
          return { ppm: data.co2_ppm as number }
        })
        .filter(Boolean) as { ppm: number }[]

      if (rows.length === 0) {
        alert(`No data found for ${MONTH_NAMES[month-1]} ${year}.`)
        return
      }

      const ppms       = rows.map(r => r.ppm)
      const avg_ppm    = Math.round(ppms.reduce((s,v)=>s+v,0) / ppms.length)
      const max_ppm    = Math.max(...ppms)
      const min_ppm    = Math.min(...ppms)
      const co2e_kg    = rows.reduce((s,r)=>s+excessKgH(r.ppm),0)
      const completeness = Math.min(100, Math.round((rows.length / 720) * 100))

      const startDate = new Date(year, month-1, 1)
      const endDate   = new Date(year, month, 0)
      const reportId  = `KGOTSO-MRV-${year}-${String(month).padStart(2,'0')}`

      await addDoc(collection(db, 'kgotso_reports'), {
        report_id:             reportId,
        period_label:          `${MONTH_NAMES[month-1]} ${year}`,
        period_start:          startDate.toISOString().slice(0,10),
        period_end:            endDate.toISOString().slice(0,10),
        avg_co2_ppm:           avg_ppm,
        max_co2_ppm:           max_ppm,
        min_co2_ppm:           min_ppm,
        total_co2e_tonne:      Number((co2e_kg / 1000).toFixed(6)),
        reading_count:         rows.length,
        data_completeness_pct: completeness,
        verification_status:   'pending',
        summary:               '',
        methodology_notes:     `Scope 1 direct CO₂. Monitoring volume: ${MONITORING_VOL_M3} m³. Harare altitude 1,483 m (air density 1.09 kg/m³). Ambient baseline: 420 ppm. Excess CO₂ = max(0, ppm − 420) × ${MONITORING_VOL_M3} × 1.09 × (44.01/28.97) / 10⁶ kg/h.`,
        generated_at:          new Date().toISOString(),
        generated_by:          appUser?.uid ?? 'system',
      })

      await loadReports()
    } finally {
      setGenerating(false)
    }
  }

  async function saveEdit() {
    if (!editReport) return
    setSavingEdit(true)
    await updateDoc(doc(db, 'kgotso_reports', editReport.id), {
      summary:             editSummary,
      verification_status: 'verified',
    })
    setSavingEdit(false)
    setEditReport(null)
    await loadReports()
  }

  // Which months already have a report
  const reportedKeys = new Set(reports.map(r => r.period_start?.slice(0,7)))

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MRV Reports</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitoring, Reporting &amp; Verification — Kgotso ClimateHealth · Harare
            </p>
          </div>
        </div>

        {/* Generate new report */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Generate Report</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">Select a month to compute statistics and create a new MRV report.</p>
              <div className="flex flex-wrap gap-2">
                {availableMonths.map(({ year, month, label }) => {
                  const key   = `${year}-${String(month).padStart(2,'0')}`
                  const exists = reportedKeys.has(key)
                  return (
                    <Button
                      key={key}
                      variant={exists ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={generating || exists}
                      onClick={() => generateReport(year, month)}
                      className="text-xs"
                    >
                      {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                      {label}
                      {exists && ' ✓'}
                    </Button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Report list */}
        {reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>No reports yet. Click a month above to generate the first one.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const sc = statusConfig[r.verification_status] ?? statusConfig.pending
              const Icon = sc.icon
              return (
                <Card key={r.id}>
                  <CardContent className="pt-5 pb-4 px-5">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      {/* Left: metadata */}
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{r.period_label}</span>
                          <span className="text-xs text-muted-foreground font-mono">{r.report_id}</span>
                          <Badge variant="outline" className={cn('text-xs', sc.bg, sc.color)}>
                            <Icon className="h-3 w-3 mr-1" />{sc.label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm mt-2">
                          <div>
                            <span className="text-muted-foreground text-xs">Avg CO₂</span>
                            <p className="font-medium tabular-nums">{r.avg_co2_ppm} ppm</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs">Max CO₂</span>
                            <p className="font-medium tabular-nums">{r.max_co2_ppm} ppm</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs">Carbon footprint</span>
                            <p className="font-medium tabular-nums">{r.total_co2e_tonne.toFixed(4)} tCO₂e</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs">Data completeness</span>
                            <p className={cn('font-medium tabular-nums', r.data_completeness_pct >= 80 ? 'text-green-600' : 'text-yellow-600')}>{r.data_completeness_pct}%</p>
                          </div>
                        </div>
                        {r.summary && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.summary}</p>
                        )}
                      </div>

                      {/* Right: actions */}
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => { setEditReport(r); setEditSummary(r.summary ?? '') }}
                        >
                          {r.verification_status === 'verified' ? 'Edit' : 'Review & Verify'}
                        </Button>
                      )}
                    </div>

                    {/* Methodology note (collapsed) */}
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
                        Methodology notes
                      </summary>
                      <p className="text-xs text-muted-foreground mt-1">{r.methodology_notes}</p>
                    </details>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Edit / verify dialog */}
        <Dialog open={!!editReport} onOpenChange={open => { if (!open) setEditReport(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Review Report — {editReport?.period_label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Avg CO₂</span><p className="font-medium">{editReport?.avg_co2_ppm} ppm</p></div>
                <div><span className="text-muted-foreground">Max CO₂</span><p className="font-medium">{editReport?.max_co2_ppm} ppm</p></div>
                <div><span className="text-muted-foreground">Carbon footprint</span><p className="font-medium">{editReport?.total_co2e_tonne.toFixed(4)} tCO₂e</p></div>
                <div><span className="text-muted-foreground">Data completeness</span><p className="font-medium">{editReport?.data_completeness_pct}%</p></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="summary">Executive Summary</Label>
                <Textarea
                  id="summary"
                  rows={5}
                  value={editSummary}
                  onChange={e => setEditSummary(e.target.value)}
                  placeholder="Describe the monitoring period, key findings, and any anomalies…"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditReport(null)}>Cancel</Button>
              <Button disabled={savingEdit} onClick={saveEdit}>
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
