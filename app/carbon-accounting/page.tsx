'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import {
  Loader2, Leaf, Plus, Pencil, Trash2, AlertCircle,
  TrendingDown, TrendingUp, Minus, Building2, Scale,
} from 'lucide-react'
import {
  ZCMA_PROJECT_TYPES, ZCMA_PROJECT_STATUSES,
  type ZCMAProject, type ZCMAProjectType, type ZCMAProjectStatus,
  type Facility, type MRVReport,
} from '@/lib/types'
import { cn } from '@/lib/utils'

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: ComboboxOption[] = ZCMA_PROJECT_TYPES.map(t => ({ value: t.value, label: t.label }))
const STATUS_OPTIONS: ComboboxOption[] = ZCMA_PROJECT_STATUSES.map(s => ({ value: s.value, label: s.label }))

const TYPE_COLORS: Record<ZCMAProjectType, string> = {
  afforestation:   'bg-accent/10 text-accent border-accent/30',
  reforestation:   'bg-accent/15 text-accent border-accent/40',
  soil_carbon:     'bg-warning/10 text-warning border-warning/30',
  methane_capture: 'bg-primary/10 text-primary border-primary/30',
  renewable_energy:'bg-primary/15 text-primary border-primary/40',
  cookstoves:      'bg-warning/15 text-warning border-warning/40',
  other:           'bg-muted text-muted-foreground',
}

const STATUS_COLORS: Record<ZCMAProjectStatus, string> = {
  active:               'bg-accent/10 text-accent border-accent/30',
  verified:             'bg-primary/10 text-primary border-primary/30',
  pending_verification: 'bg-warning/10 text-warning border-warning/30',
  suspended:            'bg-destructive/10 text-destructive border-destructive/30',
  completed:            'bg-muted text-muted-foreground',
}

const ACTIVE_STATUSES: ZCMAProjectStatus[] = ['active', 'verified']

const emptyForm = {
  project_name: '',
  facility_id: '',
  project_type: 'afforestation' as ZCMAProjectType,
  zcma_project_id: '',
  start_date: '',
  area_hectares: '' as number | '',
  annual_sequestration_tco2e: '' as number | '',
  credits_issued: 0,
  credits_retired: 0,
  status: 'active' as ZCMAProjectStatus,
  methodology: '',
  verifier: '',
  description: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeLabel(t: ZCMAProjectType) {
  return ZCMA_PROJECT_TYPES.find(x => x.value === t)?.label ?? t
}
function statusLabel(s: ZCMAProjectStatus) {
  return ZCMA_PROJECT_STATUSES.find(x => x.value === s)?.label ?? s
}

function coverageStatus(emissions: number, offsets: number): {
  label: string; color: string; bg: string
} {
  if (emissions === 0) return { label: 'No Data', color: 'text-muted-foreground', bg: 'bg-muted' }
  const pct = offsets / emissions
  if (pct <= 0)   return { label: 'No Coverage',    color: 'text-destructive', bg: 'bg-destructive/10' }
  if (pct < 0.5)  return { label: 'Low Coverage',   color: 'text-destructive', bg: 'bg-destructive/10' }
  if (pct < 1)    return { label: 'Partial',         color: 'text-warning',    bg: 'bg-warning/10' }
  return              { label: 'Carbon Neutral',  color: 'text-accent',     bg: 'bg-accent/10' }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CarbonAccountingPage() {
  const { appUser } = useAuth()
  const isAdmin = appUser?.role === 'admin'

  const [facilities, setFacilities]  = useState<Facility[]>([])
  const [reports,    setReports]     = useState<MRVReport[]>([])
  const [projects,   setProjects]    = useState<ZCMAProject[]>([])
  const [loading,    setLoading]     = useState(true)

  const [dialogOpen,   setDialogOpen]   = useState(false)
  const [editProject,  setEditProject]  = useState<ZCMAProject | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ZCMAProject | null>(null)
  const [form,         setForm]         = useState(emptyForm)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const fetchAll = async () => {
    const [facSnap, repSnap, projSnap] = await Promise.all([
      getDocs(collection(db, 'facilities')),
      getDocs(query(collection(db, 'mrv_reports'), orderBy('generated_at', 'desc'))),
      getDocs(collection(db, 'zcma_projects')),
    ])
    const allFacs = facSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Facility)
    const accessible = appUser?.facilityIds[0] === '*'
      ? allFacs
      : allFacs.filter(f => appUser?.facilityIds.includes(f.id))
    setFacilities(accessible)
    setReports(repSnap.docs.map(d => ({ ...d.data(), report_id: d.id }) as MRVReport))
    setProjects(projSnap.docs.map(d => ({ ...d.data(), id: d.id }) as ZCMAProject))
    setLoading(false)
  }

  useEffect(() => { if (appUser) fetchAll() }, [appUser])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ────────────────────────────────────────────────────────────

  const facilityOptions = useMemo<ComboboxOption[]>(
    () => facilities.map(f => ({ value: f.id, label: f.facility_name })),
    [facilities]
  )

  const latestReportByFacility = useMemo(() => {
    const map = new Map<string, MRVReport>()
    for (const r of reports) { if (!map.has(r.facility_id)) map.set(r.facility_id, r) }
    return map
  }, [reports])

  const offsetsByFacility = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of projects) {
      if (ACTIVE_STATUSES.includes(p.status)) {
        map.set(p.facility_id, (map.get(p.facility_id) ?? 0) + p.annual_sequestration_tco2e)
      }
    }
    return map
  }, [projects])

  const totalEmissions = useMemo(() =>
    facilities.reduce((s, f) => s + (latestReportByFacility.get(f.id)?.total_emissions_tco2e ?? 0), 0),
    [facilities, latestReportByFacility]
  )

  const totalOffsets = useMemo(() =>
    projects.filter(p => ACTIVE_STATUSES.includes(p.status))
      .reduce((s, p) => s + p.annual_sequestration_tco2e, 0),
    [projects]
  )

  const netPosition    = totalEmissions - totalOffsets
  const coveragePct    = totalEmissions > 0 ? Math.min(100, (totalOffsets / totalEmissions) * 100) : 0
  const balanceMax     = Math.max(totalEmissions, totalOffsets, 1)
  const emissionsWidth = (totalEmissions / balanceMax) * 100
  const offsetsWidth   = (totalOffsets   / balanceMax) * 100

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditProject(null)
    setForm({ ...emptyForm, facility_id: facilities[0]?.id ?? '' })
    setError('')
    setDialogOpen(true)
  }

  const openEdit = (p: ZCMAProject) => {
    setEditProject(p)
    setForm({
      project_name:               p.project_name,
      facility_id:                p.facility_id,
      project_type:               p.project_type,
      zcma_project_id:            p.zcma_project_id ?? '',
      start_date:                 p.start_date,
      area_hectares:              p.area_hectares ?? '',
      annual_sequestration_tco2e: p.annual_sequestration_tco2e,
      credits_issued:             p.credits_issued,
      credits_retired:            p.credits_retired,
      status:                     p.status,
      methodology:                p.methodology ?? '',
      verifier:                   p.verifier ?? '',
      description:                p.description ?? '',
    })
    setError('')
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.project_name.trim() || !form.facility_id || !form.annual_sequestration_tco2e) {
      setError('Project name, facility and annual sequestration are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      const data = {
        project_name:               form.project_name.trim(),
        facility_id:                form.facility_id,
        project_type:               form.project_type,
        zcma_project_id:            form.zcma_project_id || null,
        start_date:                 form.start_date,
        area_hectares:              form.area_hectares === '' ? null : Number(form.area_hectares),
        annual_sequestration_tco2e: Number(form.annual_sequestration_tco2e),
        credits_issued:             Number(form.credits_issued),
        credits_retired:            Number(form.credits_retired),
        status:                     form.status,
        methodology:                form.methodology || null,
        verifier:                   form.verifier || null,
        description:                form.description || null,
        updatedAt:                  now,
      }
      if (editProject) {
        await updateDoc(doc(db, 'zcma_projects', editProject.id), data)
      } else {
        await addDoc(collection(db, 'zcma_projects'), {
          ...data, createdAt: now, createdBy: appUser?.uid ?? '',
        })
      }
      setDialogOpen(false)
      await fetchAll()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save project.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'zcma_projects', deleteTarget.id))
      setDeleteTarget(null)
      await fetchAll()
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl w-full">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <Scale className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              Carbon Accounting
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Net carbon position — facility emissions vs ZCMA project offsets
            </p>
          </div>
          {isAdmin && (
            <Button onClick={openCreate} className="shrink-0">
              <Plus className="mr-2 h-4 w-4" /> Add Project
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* ── Summary stats ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                {
                  label: 'Gross Emissions',
                  value: totalEmissions.toFixed(2),
                  unit: 'tCO2e/yr',
                  icon: <TrendingUp className="h-4 w-4" />,
                  color: 'text-destructive',
                  note: `${facilities.filter(f => latestReportByFacility.has(f.id)).length} facilities reporting`,
                },
                {
                  label: 'Annual Offsets',
                  value: totalOffsets.toFixed(2),
                  unit: 'tCO2e/yr',
                  icon: <Leaf className="h-4 w-4" />,
                  color: 'text-accent',
                  note: `${projects.filter(p => ACTIVE_STATUSES.includes(p.status)).length} active projects`,
                },
                {
                  label: 'Net Position',
                  value: (netPosition > 0 ? '+' : '') + netPosition.toFixed(2),
                  unit: 'tCO2e/yr',
                  icon: netPosition > 0 ? <TrendingUp className="h-4 w-4" /> : netPosition < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />,
                  color: netPosition > 0 ? 'text-destructive' : 'text-accent',
                  note: netPosition > 0 ? 'Net emitter' : netPosition < 0 ? 'Net sequesterer' : 'Carbon neutral',
                },
                {
                  label: 'Coverage',
                  value: coveragePct.toFixed(1) + '%',
                  unit: 'offset',
                  icon: <Scale className="h-4 w-4" />,
                  color: coveragePct >= 100 ? 'text-accent' : coveragePct >= 50 ? 'text-warning' : 'text-destructive',
                  note: coveragePct >= 100 ? 'Fully offset' : `${(100 - coveragePct).toFixed(1)}% gap remaining`,
                },
              ].map(stat => (
                <Card key={stat.label}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs sm:text-sm text-muted-foreground font-medium">{stat.label}</p>
                      <span className={cn('shrink-0', stat.color)}>{stat.icon}</span>
                    </div>
                    <p className={cn('text-2xl sm:text-3xl font-bold font-mono', stat.color)}>{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{stat.unit}</p>
                    <p className="text-xs text-muted-foreground mt-2 opacity-70">{stat.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Balance visual ───────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Carbon Balance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {/* Emissions bar */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 sm:w-32 shrink-0 text-right">
                      Emissions
                    </span>
                    <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-destructive/70 rounded-full transition-all duration-500"
                        style={{ width: `${emissionsWidth}%` }}
                      />
                    </div>
                    <span className="font-mono text-sm text-destructive w-24 shrink-0">
                      {totalEmissions.toFixed(2)} t
                    </span>
                  </div>
                  {/* Offsets bar */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 sm:w-32 shrink-0 text-right">
                      Offsets
                    </span>
                    <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent/70 rounded-full transition-all duration-500"
                        style={{ width: `${offsetsWidth}%` }}
                      />
                    </div>
                    <span className="font-mono text-sm text-accent w-24 shrink-0">
                      {totalOffsets.toFixed(2)} t
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-2xl font-bold font-mono',
                      netPosition > 0 ? 'text-destructive' : 'text-accent',
                    )}>
                      {netPosition > 0 ? '+' : ''}{netPosition.toFixed(2)} tCO2e/yr
                    </span>
                    <span className="text-sm text-muted-foreground">net position</span>
                  </div>
                  <div className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium',
                    netPosition > 0
                      ? 'bg-destructive/10 text-destructive border-destructive/30'
                      : 'bg-accent/10 text-accent border-accent/30',
                  )}>
                    {netPosition > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {netPosition > 0 ? 'Net Emitter' : 'Net Sequesterer'} · {coveragePct.toFixed(1)}% offset
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Per-facility breakdown ────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Facility Carbon Accounts
                </CardTitle>
                <CardDescription>Latest report emissions vs active project offsets per facility</CardDescription>
              </CardHeader>
              <CardContent className="p-0 sm:p-6 sm:pt-0">
                {facilities.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground text-sm px-6">No facilities found.</div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="text-left font-semibold py-3 px-4">Facility</th>
                            <th className="text-right font-semibold py-3 px-4">Emissions (tCO2e/yr)</th>
                            <th className="text-right font-semibold py-3 px-4">Offsets (tCO2e/yr)</th>
                            <th className="text-right font-semibold py-3 px-4">Net (tCO2e/yr)</th>
                            <th className="text-left font-semibold py-3 px-4">Coverage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {facilities.map(fac => {
                            const report  = latestReportByFacility.get(fac.id)
                            const emis    = report?.total_emissions_tco2e ?? 0
                            const offsets = offsetsByFacility.get(fac.id) ?? 0
                            const net     = emis - offsets
                            const cs      = coverageStatus(emis, offsets)
                            return (
                              <tr key={fac.id} className="hover:bg-secondary/30 transition-colors">
                                <td className="py-3 px-4">
                                  <Link
                                    href={`/facilities/${fac.id}`}
                                    className="font-medium hover:underline hover:text-primary"
                                  >
                                    {fac.facility_name}
                                  </Link>
                                  {report && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      Report{' '}
                                      <Link href={`/reports/${report.report_id}`} className="font-mono hover:underline">
                                        {report.report_id}
                                      </Link>
                                    </p>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right font-mono">
                                  {emis > 0 ? (
                                    <span className="text-destructive">{emis.toFixed(2)}</span>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">No data</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right font-mono">
                                  {offsets > 0 ? (
                                    <span className="text-accent">{offsets.toFixed(2)}</span>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-semibold">
                                  {emis === 0 ? (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  ) : (
                                    <span className={net > 0 ? 'text-destructive' : 'text-accent'}>
                                      {net > 0 ? '+' : ''}{net.toFixed(2)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <span className={cn('text-xs px-2 py-1 rounded-full', cs.bg, cs.color)}>
                                    {cs.label}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border bg-secondary/30">
                            <td className="py-3 px-4 font-semibold text-xs uppercase tracking-wide">Total</td>
                            <td className="py-3 px-4 text-right font-mono font-semibold text-destructive">
                              {totalEmissions.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold text-accent">
                              {totalOffsets.toFixed(2)}
                            </td>
                            <td className={cn(
                              'py-3 px-4 text-right font-mono font-bold',
                              netPosition > 0 ? 'text-destructive' : 'text-accent',
                            )}>
                              {netPosition > 0 ? '+' : ''}{netPosition.toFixed(2)}
                            </td>
                            <td className="py-3 px-4">
                              <span className={cn(
                                'text-xs px-2 py-1 rounded-full font-semibold',
                                coveragePct >= 100
                                  ? 'bg-accent/10 text-accent'
                                  : coveragePct >= 50
                                    ? 'bg-warning/10 text-warning'
                                    : 'bg-destructive/10 text-destructive',
                              )}>
                                {coveragePct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="sm:hidden divide-y divide-border">
                      {facilities.map(fac => {
                        const report  = latestReportByFacility.get(fac.id)
                        const emis    = report?.total_emissions_tco2e ?? 0
                        const offsets = offsetsByFacility.get(fac.id) ?? 0
                        const net     = emis - offsets
                        const cs      = coverageStatus(emis, offsets)
                        return (
                          <div key={fac.id} className="px-4 py-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Link href={`/facilities/${fac.id}`} className="font-medium hover:underline hover:text-primary text-sm">
                                {fac.facility_name}
                              </Link>
                              <span className={cn('text-xs px-2 py-0.5 rounded-full', cs.bg, cs.color)}>
                                {cs.label}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-xs text-muted-foreground">Emissions</p>
                                <p className="font-mono text-sm text-destructive">{emis > 0 ? emis.toFixed(1) : '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Offsets</p>
                                <p className="font-mono text-sm text-accent">{offsets > 0 ? offsets.toFixed(1) : '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Net</p>
                                <p className={cn('font-mono text-sm font-semibold', net > 0 ? 'text-destructive' : 'text-accent')}>
                                  {emis === 0 ? '—' : (net > 0 ? '+' : '') + net.toFixed(1)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── ZCMA Projects ─────────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                      <Leaf className="h-4 w-4" /> ZCMA Carbon Projects
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Registered sequestration and offset projects
                    </CardDescription>
                  </div>
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={openCreate} className="shrink-0">
                      <Plus className="mr-2 h-3.5 w-3.5" /> Add Project
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 sm:p-6 sm:pt-0">
                {projects.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground px-6">
                    <Leaf className="h-10 w-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">No projects registered yet</p>
                    {isAdmin && (
                      <Button variant="outline" size="sm" onClick={openCreate} className="mt-4">
                        <Plus className="mr-2 h-4 w-4" /> Register First Project
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="text-left font-semibold py-3 px-4">Project</th>
                            <th className="text-left font-semibold py-3 px-4">Facility</th>
                            <th className="text-left font-semibold py-3 px-4">Type</th>
                            <th className="text-right font-semibold py-3 px-4">Area (ha)</th>
                            <th className="text-right font-semibold py-3 px-4">Annual Seq. (tCO2e)</th>
                            <th className="text-right font-semibold py-3 px-4">Credits Issued</th>
                            <th className="text-left font-semibold py-3 px-4">Status</th>
                            {isAdmin && <th className="py-3 px-4" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {projects.map(p => {
                            const fac = facilities.find(f => f.id === p.facility_id)
                            return (
                              <tr key={p.id} className="hover:bg-secondary/30 transition-colors">
                                <td className="py-3 px-4">
                                  <p className="font-medium">{p.project_name}</p>
                                  {p.zcma_project_id && (
                                    <p className="text-xs text-muted-foreground font-mono">{p.zcma_project_id}</p>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  {fac ? (
                                    <Link href={`/facilities/${fac.id}`} className="hover:underline hover:text-primary">
                                      {fac.facility_name}
                                    </Link>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">{p.facility_id}</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <Badge variant="outline" className={cn('text-xs', TYPE_COLORS[p.project_type])}>
                                    {typeLabel(p.project_type)}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                                  {p.area_hectares != null ? p.area_hectares.toLocaleString() : '—'}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-semibold text-accent">
                                  {p.annual_sequestration_tco2e.toFixed(2)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                                  <span>{p.credits_issued.toLocaleString()}</span>
                                  {p.credits_retired > 0 && (
                                    <span className="text-xs ml-1 opacity-60">({p.credits_retired} retired)</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <Badge variant="outline" className={cn('text-xs', STATUS_COLORS[p.status])}>
                                    {statusLabel(p.status)}
                                  </Badge>
                                </td>
                                {isAdmin && (
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-1 justify-end">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setDeleteTarget(p)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border bg-secondary/30">
                            <td className="py-3 px-4 font-semibold text-xs uppercase tracking-wide" colSpan={3}>
                              Total ({projects.length} projects)
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold">
                              {projects.reduce((s, p) => s + (p.area_hectares ?? 0), 0).toLocaleString()} ha
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-accent">
                              {projects.filter(p => ACTIVE_STATUSES.includes(p.status))
                                .reduce((s, p) => s + p.annual_sequestration_tco2e, 0).toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold">
                              {projects.reduce((s, p) => s + p.credits_issued, 0).toLocaleString()}
                            </td>
                            <td colSpan={isAdmin ? 2 : 1} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden divide-y divide-border">
                      {projects.map(p => {
                        const fac = facilities.find(f => f.id === p.facility_id)
                        return (
                          <div key={p.id} className="px-4 py-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{p.project_name}</p>
                                {fac && (
                                  <Link href={`/facilities/${fac.id}`} className="text-xs text-muted-foreground hover:underline hover:text-primary">
                                    {fac.facility_name}
                                  </Link>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="outline" className={cn('text-xs', STATUS_COLORS[p.status])}>
                                  {statusLabel(p.status)}
                                </Badge>
                                {isAdmin && (
                                  <>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => setDeleteTarget(p)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={cn('text-xs', TYPE_COLORS[p.project_type])}>
                                {typeLabel(p.project_type)}
                              </Badge>
                              {p.area_hectares != null && (
                                <span className="text-xs text-muted-foreground">{p.area_hectares} ha</span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-center">
                              <div className="bg-secondary rounded-lg p-2">
                                <p className="text-xs text-muted-foreground">Annual Seq.</p>
                                <p className="font-mono text-sm font-semibold text-accent">
                                  {p.annual_sequestration_tco2e.toFixed(2)} t
                                </p>
                              </div>
                              <div className="bg-secondary rounded-lg p-2">
                                <p className="text-xs text-muted-foreground">Credits Issued</p>
                                <p className="font-mono text-sm font-semibold">
                                  {p.credits_issued.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Add / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProject ? 'Edit Project' : 'Register Carbon Project'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Project Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.project_name}
                  onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))}
                  placeholder="e.g. Mazowe Reforestation Initiative"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Facility <span className="text-destructive">*</span></Label>
                <Combobox
                  options={facilityOptions}
                  value={form.facility_id}
                  onValueChange={v => setForm(f => ({ ...f, facility_id: v }))}
                  placeholder="Select facility…"
                  searchPlaceholder="Search facilities…"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Project Type <span className="text-destructive">*</span></Label>
                <Combobox
                  options={TYPE_OPTIONS}
                  value={form.project_type}
                  onValueChange={v => setForm(f => ({ ...f, project_type: v as ZCMAProjectType }))}
                  placeholder="Select type…"
                />
              </div>

              <div className="space-y-1.5">
                <Label>ZCMA Project ID</Label>
                <Input
                  value={form.zcma_project_id}
                  onChange={e => setForm(f => ({ ...f, zcma_project_id: e.target.value }))}
                  placeholder="e.g. ZCMA-PRJ-2024-001"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Area (hectares)</Label>
                <Input
                  type="number"
                  value={form.area_hectares}
                  onChange={e => setForm(f => ({ ...f, area_hectares: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                  placeholder="e.g. 250.5"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Annual Sequestration (tCO2e) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  value={form.annual_sequestration_tco2e}
                  onChange={e => setForm(f => ({ ...f, annual_sequestration_tco2e: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                  placeholder="e.g. 450.00"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Credits Issued (VCUs)</Label>
                <Input
                  type="number"
                  value={form.credits_issued}
                  onChange={e => setForm(f => ({ ...f, credits_issued: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Credits Retired</Label>
                <Input
                  type="number"
                  value={form.credits_retired}
                  onChange={e => setForm(f => ({ ...f, credits_retired: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Status <span className="text-destructive">*</span></Label>
                <Combobox
                  options={STATUS_OPTIONS}
                  value={form.status}
                  onValueChange={v => setForm(f => ({ ...f, status: v as ZCMAProjectStatus }))}
                  placeholder="Select status…"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Methodology</Label>
                <Input
                  value={form.methodology}
                  onChange={e => setForm(f => ({ ...f, methodology: e.target.value }))}
                  placeholder="e.g. VM0010, AR-ACM0003"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Verifier</Label>
                <Input
                  value={form.verifier}
                  onChange={e => setForm(f => ({ ...f, verifier: e.target.value }))}
                  placeholder="e.g. Bureau Veritas"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of the project…"
                  rows={3}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editProject ? 'Save Changes' : 'Register Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.project_name}</strong>?
            This will affect the carbon balance calculations. This cannot be undone.
          </p>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
