'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, orderBy, where, addDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import {
  Loader2, FileText, CheckCircle, Clock, XCircle,
  Search, Eye, Pencil, Plus, Building2,
} from 'lucide-react'
import type { MRVReport, Facility, DailyEmissionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const statusConfig = {
  pending:  { icon: Clock,       color: 'text-warning',     bg: 'bg-warning/10 border-warning/30',         label: 'Pending' },
  verified: { icon: CheckCircle, color: 'text-accent',      bg: 'bg-accent/10 border-accent/30',           label: 'Verified' },
  rejected: { icon: XCircle,     color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'Rejected' },
}

export default function ReportsPage() {
  const { appUser } = useAuth()
  const router = useRouter()

  const [reports, setReports]       = useState<MRVReport[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)

  const [search,           setSearch]           = useState('')
  const [facilityFilter,   setFacilityFilter]   = useState('all')
  const [newReportFacility, setNewReportFacility] = useState('')

  const isAdmin = appUser?.role === 'admin'

  // Build facilityId → Facility map
  const facilityMap = useMemo(
    () => Object.fromEntries(facilities.map(f => [f.id, f])),
    [facilities]
  )

  const facilityOptions = useMemo<ComboboxOption[]>(
    () => facilities.map(f => ({ value: f.id, label: f.facility_name })),
    [facilities]
  )

  const facilityFilterOptions = useMemo<ComboboxOption[]>(
    () => [{ value: 'all', label: 'All facilities' }, ...facilities.map(f => ({ value: f.id, label: f.facility_name }))],
    [facilities]
  )

  useEffect(() => {
    async function load() {
      // Fetch facilities the user can access
      const facSnap = await getDocs(collection(db, 'facilities'))
      const allFacs = facSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Facility)

      const accessibleFacs = appUser?.facilityIds[0] === '*'
        ? allFacs
        : allFacs.filter(f => appUser?.facilityIds.includes(f.id))

      setFacilities(accessibleFacs)
      if (accessibleFacs.length > 0) setNewReportFacility(accessibleFacs[0].id)

      // Fetch reports — filter by accessible facilities
      const rSnap = await getDocs(
        query(collection(db, 'mrv_reports'), orderBy('generated_at', 'desc'))
      )
      const accessibleIds = new Set(accessibleFacs.map(f => f.id))
      const allReports = rSnap.docs
        .map(d => ({ ...d.data(), report_id: d.id }) as MRVReport)
        .filter(r => appUser?.facilityIds[0] === '*' || accessibleIds.has(r.facility_id))

      setReports(allReports)
      setLoading(false)
    }
    load()
  }, [appUser])

  const filtered = useMemo(() => reports.filter(r => {
    const facName = facilityMap[r.facility_id]?.facility_name ?? r.facility_id
    const matchSearch = (
      facName.toLowerCase().includes(search.toLowerCase()) ||
      r.report_id.toLowerCase().includes(search.toLowerCase())
    )
    const matchFacility = facilityFilter === 'all' || r.facility_id === facilityFilter
    return matchSearch && matchFacility
  }), [reports, search, facilityFilter, facilityMap])

  // Group filtered reports by facility
  const grouped = useMemo(() => {
    const map = new Map<string, MRVReport[]>()
    for (const r of filtered) {
      const existing = map.get(r.facility_id) ?? []
      map.set(r.facility_id, [...existing, r])
    }
    return map
  }, [filtered])

  async function handleGenerateReport() {
    if (!newReportFacility) return
    const fac = facilityMap[newReportFacility]
    if (!fac) return

    setGenerating(true)
    try {
      // Fetch daily summaries for the facility — single where to avoid composite index
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0]

      const snap = await getDocs(
        query(collection(db, 'daily_summaries'), where('facility_id', '==', newReportFacility))
      )

      const summaries = snap.docs
        .map(d => d.data() as DailyEmissionSummary)
        .filter(d => d.date >= thirtyDaysAgo)
        .sort((a, b) => a.date.localeCompare(b.date))
      const totalKg   = summaries.reduce((s, d) => s + d.total_co2e_kg, 0)
      const scope1Kg  = summaries.reduce((s, d) => s + d.scope1_kg, 0)
      const scope2Kg  = summaries.reduce((s, d) => s + d.scope2_kg, 0)
      const toTonne   = (kg: number) => parseFloat((kg / 1000).toFixed(3))

      const now = new Date().toISOString()
      const start = summaries[0]
        ? new Date(summaries[0].date + 'T00:00:00Z').toISOString()
        : thirtyDaysAgo + 'T00:00:00Z'

      const report: Omit<MRVReport, 'report_id'> = {
        facility_id:          newReportFacility,
        reporting_period:     { start, end: now },
        total_emissions_tco2e: toTonne(totalKg),
        emissions_by_scope: {
          scope1: toTonne(scope1Kg),
          scope2: toTonne(scope2Kg),
          scope3: 0,
        },
        emissions_by_source: fac.emission_sources
          .filter(s => s.applicable)
          .map(s => ({
            source_name:      s.description,
            emissions_tco2e:  toTonne(
              s.scope === 1
                ? scope1Kg * (s.source_type === 'stationary_combustion' ? 0.72 : s.source_type === 'process_emissions' ? 0.18 : 0.10)
                : scope2Kg
            ),
            methodology:  s.scope === 2 ? 'ZESA Grid Factor 0.582 kg CO₂e/kWh' : 'GHG Protocol / IPCC 2006',
            data_quality: 'measured' as const,
          })),
        verification_status: 'pending',
        generated_at:        now,
        generated_by:        appUser?.uid,
        zcma_compliant:      fac.zcma_compliant,
      }

      const docRef = await addDoc(collection(db, 'mrv_reports'), report)
      router.push(`/reports/${docRef.id}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl w-full">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              MRV Reports
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              ZCMA-compliant reports — one per facility per reporting period
            </p>
          </div>

          {/* Generate new report — admin / operator */}
          {(isAdmin || appUser?.role === 'operator') && facilities.length > 0 && (
            <div className="flex flex-col xs:flex-row items-stretch xs:items-center gap-2 w-full sm:w-auto">
              <Combobox
                options={facilityOptions}
                value={newReportFacility}
                onValueChange={setNewReportFacility}
                placeholder="Select facility…"
                searchPlaceholder="Search facilities…"
                className="w-full xs:w-52"
              />
              <Button onClick={handleGenerateReport} disabled={generating || !newReportFacility} className="shrink-0">
                {generating
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating…</>
                  : <><Plus   className="mr-2 h-4 w-4" />New Report</>}
              </Button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col xs:flex-row items-stretch xs:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search reports…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 w-full"
            />
          </div>
          <Combobox
            options={facilityFilterOptions}
            value={facilityFilter}
            onValueChange={setFacilityFilter}
            placeholder="All facilities"
            searchPlaceholder="Search facilities…"
            className="w-full xs:w-52"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : grouped.size === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No reports found</p>
              <p className="text-sm mt-1">Select a facility above and click New Report to generate one.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Array.from(grouped.entries()).map(([facId, facReports]) => {
              const fac = facilityMap[facId]
              return (
                <div key={facId}>
                  {/* Facility group header */}
                  <div className="flex items-center gap-3 mb-3">
                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                    <Link
                      href={`/facilities/${facId}`}
                      className="font-semibold text-sm hover:underline hover:text-primary"
                    >
                      {fac?.facility_name ?? facId}
                    </Link>
                    {fac && (
                      <span className="text-xs text-muted-foreground">
                        {fac.province} · {fac.city_town}
                      </span>
                    )}
                    <Badge variant="outline" className="text-xs ml-auto">
                      {facReports.length} report{facReports.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {facReports.map(report => {
                      const st = statusConfig[report.verification_status]
                      const StatusIcon = st.icon
                      return (
                        <Card key={report.report_id} className="hover:border-primary/40 transition-colors">
                          <CardContent className="p-3 sm:p-4">
                            {/* Top row: ID/period + status + action */}
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-sm font-semibold truncate">{report.report_id}</span>
                                  {report.zcma_compliant && (
                                    <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30 text-xs shrink-0">
                                      ZCMA ✓
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {new Date(report.reporting_period.start).toLocaleDateString()} — {new Date(report.reporting_period.end).toLocaleDateString()}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Generated {new Date(report.generated_at).toLocaleString()}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className={cn(
                                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium',
                                  st.bg, st.color
                                )}>
                                  <StatusIcon className="h-3.5 w-3.5" />
                                  {st.label}
                                </div>
                                <Link href={`/reports/${report.report_id}`}>
                                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                                    {isAdmin
                                      ? <><Pencil className="h-3.5 w-3.5" />Edit</>
                                      : <><Eye   className="h-3.5 w-3.5" />View</>}
                                  </Button>
                                </Link>
                              </div>
                            </div>

                            {/* Emission totals row */}
                            <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-xs text-muted-foreground">Total</p>
                                <p className="font-mono font-semibold text-sm">{report.total_emissions_tco2e.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">tCO2e</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Scope 1</p>
                                <p className="font-mono text-sm">{report.emissions_by_scope.scope1.toFixed(2)}t</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Scope 2</p>
                                <p className="font-mono text-sm">{report.emissions_by_scope.scope2.toFixed(2)}t</p>
                              </div>
                            </div>

                            {report.summary && (
                              <p className="mt-3 text-xs sm:text-sm text-muted-foreground border-t border-border pt-3 line-clamp-2">
                                {report.summary}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
