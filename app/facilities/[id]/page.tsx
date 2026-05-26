'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Loader2, Pencil, MapPin, Factory, Phone, Mail, CheckCircle, XCircle,
  FileText, ShieldCheck, ShieldAlert, ShieldX, Shield, Clock, AlertTriangle,
  ChevronRight, Leaf, Eye, Scale, TrendingUp, TrendingDown, Plus,
} from 'lucide-react'
import type { Facility, MRVReport, ZCMAProject, ZCMAProjectType, ZCMAProjectStatus } from '@/lib/types'
import { ZCMA_PROJECT_TYPES, ZCMA_PROJECT_STATUSES } from '@/lib/types'
import { cn } from '@/lib/utils'

// ── MRV report status config ──────────────────────────────────────────────────
const reportStatusConfig = {
  pending:  { icon: Clock,       color: 'text-warning',     bg: 'bg-warning/10 border-warning/30',         label: 'Pending' },
  verified: { icon: CheckCircle, color: 'text-accent',      bg: 'bg-accent/10 border-accent/30',           label: 'Verified' },
  rejected: { icon: XCircle,     color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'Rejected' },
}

// ── Conformity status derivation ──────────────────────────────────────────────
function deriveConformityStatus(facility: Facility, latest?: MRVReport) {
  if (!latest) {
    return {
      label: 'Not Reported', description: 'No MRV reports submitted yet',
      color: 'text-muted-foreground', bg: 'bg-muted/40 border-border', icon: Shield,
    }
  }
  if (latest.verification_status === 'rejected') {
    return {
      label: 'Non-Compliant',
      description: latest.rejection_reason ? `Reason: ${latest.rejection_reason}` : 'Report was rejected by verifier',
      color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', icon: ShieldX,
    }
  }
  const today = new Date().toISOString().split('T')[0]
  if (
    facility.next_verification_date &&
    facility.next_verification_date < today &&
    latest.verification_status !== 'verified'
  ) {
    return {
      label: 'Verification Overdue', description: `Scheduled for ${facility.next_verification_date}`,
      color: 'text-warning', bg: 'bg-warning/10 border-warning/30', icon: AlertTriangle,
    }
  }
  if (latest.verification_status === 'pending') {
    return {
      label: 'Audit Phase', description: 'Report submitted, awaiting third-party verification',
      color: 'text-warning', bg: 'bg-warning/10 border-warning/30', icon: Clock,
    }
  }
  // Verified — check against monthly target
  const targetTonne = facility.monthly_emission_target_kg / 1000
  if (latest.total_emissions_tco2e > targetTonne * 1.05) {
    return {
      label: 'Exceeding Limits',
      description: `${latest.total_emissions_tco2e.toFixed(2)} t emitted vs ${targetTonne.toFixed(2)} t target`,
      color: 'text-warning', bg: 'bg-warning/10 border-warning/30', icon: ShieldAlert,
    }
  }
  return {
    label: 'Complying', description: 'Verified report within emission targets',
    color: 'text-accent', bg: 'bg-accent/10 border-accent/30', icon: ShieldCheck,
  }
}

// ── Boolean value helper (avoids nested ternary) ──────────────────────────────
function BoolValue({ yes }: { yes: boolean }) {
  if (yes) return <CheckCircle className="h-4 w-4 text-accent" />
  return <XCircle className="h-4 w-4 text-muted-foreground" />
}

// ── Row helper ────────────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex flex-col xs:flex-row xs:items-center gap-0.5 xs:gap-2 py-2 border-b border-border last:border-0">
      <span className="text-xs sm:text-sm text-muted-foreground xs:w-40 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm font-medium">
        {typeof value === 'boolean' ? <BoolValue yes={value} /> : String(value)}
      </span>
    </div>
  )
}

// ── Page component ────────────────────────────────────────────────────────────
export default function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { appUser } = useAuth()
  const [facility, setFacility] = useState<Facility | null>(null)
  const [reports,  setReports]  = useState<MRVReport[]>([])
  const [projects, setProjects] = useState<ZCMAProject[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      const [facSnap, rSnap, pSnap] = await Promise.all([
        getDoc(doc(db, 'facilities', id)),
        getDocs(query(collection(db, 'mrv_reports'), where('facility_id', '==', id))),
        getDocs(query(collection(db, 'zcma_projects'), where('facility_id', '==', id))),
      ])
      if (facSnap.exists()) setFacility({ id: facSnap.id, ...facSnap.data() } as Facility)
      setReports(
        rSnap.docs
          .map(d => ({ ...d.data(), report_id: d.id }) as MRVReport)
          .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
          .slice(0, 5)
      )
      setProjects(pSnap.docs.map(d => ({ ...d.data(), id: d.id }) as ZCMAProject))
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <AppShell>
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    </AppShell>
  )

  if (!facility) return (
    <AppShell>
      <div className="p-6 text-muted-foreground">Facility not found.</div>
    </AppShell>
  )

  const canEdit     = appUser?.role === 'admin' || appUser?.role === 'operator'
  const isAdmin     = appUser?.role === 'admin'
  const latestReport = reports[0]
  const conformity  = deriveConformityStatus(facility, latestReport)
  const ConformityIcon = conformity.icon
  const allTimeTotalTonne = reports.reduce((s, r) => s + r.total_emissions_tco2e, 0)
  const targetTonne = facility.monthly_emission_target_kg / 1000

  // Net carbon position
  const activeProjects   = projects.filter(p => p.status === 'active' || p.status === 'verified')
  const totalOffsets     = activeProjects.reduce((s, p) => s + p.annual_sequestration_tco2e, 0)
  const latestEmissions  = latestReport?.total_emissions_tco2e ?? 0
  const netPosition      = latestEmissions - totalOffsets
  const coveragePct      = latestEmissions > 0 ? Math.min(100, (totalOffsets / latestEmissions) * 100) : 0

  const typeLabel  = (t: ZCMAProjectType)  => ZCMA_PROJECT_TYPES.find(x => x.value === t)?.label ?? t
  const statusLabel = (s: ZCMAProjectStatus) => ZCMA_PROJECT_STATUSES.find(x => x.value === s)?.label ?? s

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

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-4xl w-full">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{facility.facility_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{facility.legal_entity_name}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge
                variant="outline"
                className={facility.operational_status === 'Operational'
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'bg-muted text-muted-foreground'}
              >
                {facility.operational_status}
              </Badge>
              {facility.iso_14064_certified && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">ISO 14064</Badge>
              )}
              {facility.zcma_compliant && (
                <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">ZCMA ✓</Badge>
              )}
            </div>
          </div>
          {canEdit && (
            <Link href={`/facilities/${id}/edit`}>
              <Button variant="outline"><Pencil className="mr-2 h-4 w-4" />Edit</Button>
            </Link>
          )}
        </div>

        {/* ── Conformity Status + Carbon Footprint ── */}
        <div className="grid sm:grid-cols-3 gap-3 sm:gap-4">

          {/* Conformity Status */}
          <Card className={cn('border', conformity.bg)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Conformity Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3">
                <ConformityIcon className={cn('h-8 w-8 shrink-0 mt-0.5', conformity.color)} />
                <div>
                  <p className={cn('font-bold text-lg leading-tight', conformity.color)}>
                    {conformity.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {conformity.description}
                  </p>
                </div>
              </div>
              {latestReport && (
                <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/60">
                  Based on report from {new Date(latestReport.generated_at).toLocaleDateString()}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Carbon Footprint */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Carbon Footprint — From MRV Reports
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestReport ? (
                <>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-3xl font-bold font-mono">
                      {latestReport.total_emissions_tco2e.toFixed(3)}
                    </span>
                    <span className="text-sm text-muted-foreground">tCO2e latest period</span>
                    <span className={cn(
                      'ml-auto text-xs font-medium px-2 py-0.5 rounded-full border',
                      latestReport.total_emissions_tco2e <= targetTonne
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-warning/10 text-warning border-warning/30',
                    )}>
                      {latestReport.total_emissions_tco2e <= targetTonne
                        ? 'Within target'
                        : `${((latestReport.total_emissions_tco2e / targetTonne - 1) * 100).toFixed(0)}% over target`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {(['scope1', 'scope2', 'scope3'] as const).map(s => (
                      <div key={s} className="p-2 rounded-lg bg-secondary text-center">
                        <p className="text-xs text-muted-foreground">{s.replace('scope', 'Scope ')}</p>
                        <p className="font-mono font-semibold text-sm mt-0.5">
                          {latestReport.emissions_by_scope[s].toFixed(3)} t
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
                    <span>
                      All-time: <span className="font-mono font-medium text-foreground">{allTimeTotalTonne.toFixed(2)} tCO2e</span>
                      {' '}({reports.length} report{reports.length !== 1 ? 's' : ''})
                    </span>
                    <span>
                      Target: <span className="font-mono font-medium text-foreground">{targetTonne.toFixed(2)} t/period</span>
                    </span>
                  </div>
                </>
              ) : (
                <div className="py-6 text-center text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-25" />
                  <p className="text-sm">
                    No reports yet — carbon footprint will appear here once an MRV report is generated.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Net Carbon Position ── */}
        <Card className={cn('border', netPosition > 0 && latestEmissions > 0 ? 'border-destructive/30' : latestEmissions > 0 ? 'border-accent/30' : '')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Scale className="h-4 w-4" /> Net Carbon Position
              </CardTitle>
              <Link href="/carbon-accounting">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground -mr-2">
                  Full Accounting <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {latestEmissions === 0 && totalOffsets === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No emissions or offset data yet for this facility.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-secondary text-center">
                  <p className="text-xs text-muted-foreground">Emissions</p>
                  <p className="font-mono font-semibold text-destructive mt-0.5">
                    {latestEmissions > 0 ? latestEmissions.toFixed(2) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">tCO2e/period</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary text-center">
                  <p className="text-xs text-muted-foreground">Offsets</p>
                  <p className="font-mono font-semibold text-accent mt-0.5">
                    {totalOffsets > 0 ? totalOffsets.toFixed(2) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">tCO2e/yr</p>
                </div>
                <div className={cn('p-3 rounded-lg text-center', netPosition > 0 && latestEmissions > 0 ? 'bg-destructive/10' : 'bg-accent/10')}>
                  <p className="text-xs text-muted-foreground">Net Position</p>
                  <p className={cn('font-mono font-bold text-lg mt-0.5', netPosition > 0 && latestEmissions > 0 ? 'text-destructive' : 'text-accent')}>
                    {latestEmissions > 0 ? (netPosition > 0 ? '+' : '') + netPosition.toFixed(2) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">tCO2e</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary text-center">
                  <p className="text-xs text-muted-foreground">Coverage</p>
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    {coveragePct >= 100
                      ? <TrendingDown className="h-4 w-4 text-accent" />
                      : <TrendingUp className="h-4 w-4 text-destructive" />}
                    <p className={cn('font-mono font-semibold', coveragePct >= 100 ? 'text-accent' : 'text-destructive')}>
                      {latestEmissions > 0 ? coveragePct.toFixed(1) + '%' : '—'}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">offset</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Identification + Location + Operations + Emission Profile ── */}
        <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide">Identification</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-0">
              <Row label="ZCMA Registry ID"  value={facility.zcma_registry_id} />
              <Row label="CIPA Reg. Number"  value={facility.cipa_reg_number} />
              <Row label="ZIMRA BP Number"   value={facility.zimra_bp_number} />
              <Row label="Trading Name"      value={facility.trading_name} />
              <Row label="Reporting Year"    value={facility.reporting_year} />
              <Row label="GHG Base Year"     value={facility.base_year} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Location
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-0">
              <Row label="Province"          value={facility.province} />
              <Row label="District"          value={facility.district} />
              <Row label="City / Town"       value={facility.city_town} />
              <Row label="Physical Address"  value={facility.physical_address} />
              <Row label="Postal Address"    value={facility.postal_address} />
              <Row label="Land Area"         value={facility.land_area_hectares ? `${facility.land_area_hectares} ha` : undefined} />
              <Row label="GPS Coordinates"   value={facility.gps_latitude ? `${facility.gps_latitude}, ${facility.gps_longitude}` : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide flex items-center gap-2">
                <Factory className="h-4 w-4" /> Operations
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-0">
              <Row label="Industry Sector"    value={`${facility.industry_sector_code} — ${facility.industry_sector_label}`} />
              <Row label="Sub-sector"         value={facility.sub_sector} />
              <Row label="Operation Start"    value={facility.operation_start_date} />
              <Row label="Employees"          value={facility.number_of_employees} />
              <Row label="Installed Capacity" value={facility.installed_capacity ? `${facility.installed_capacity} ${facility.capacity_unit}` : undefined} />
              <Row label="Annual Production"  value={facility.annual_production ? `${facility.annual_production} ${facility.production_unit}` : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide">Emission Profile</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-0">
              <Row label="Primary Fuel"    value={facility.primary_fuel_type} />
              <Row label="Secondary Fuel"  value={facility.secondary_fuel_type} />
              <Row label="Monthly Target"  value={`${facility.monthly_emission_target_kg.toLocaleString()} kg CO2e`} />
              <Row label="Scope 1"         value={facility.scope1_applicable} />
              <Row label="Scope 2"         value={facility.scope2_applicable} />
              <Row label="Scope 3"         value={facility.scope3_applicable} />
            </CardContent>
          </Card>
        </div>

        {/* ── MRV Reports ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide flex items-center gap-2">
                  <FileText className="h-4 w-4" /> MRV Reports
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Most recent compliance reports for this facility
                </CardDescription>
              </div>
              <Link href="/reports">
                <Button variant="outline" size="sm" className="gap-1.5">
                  View All <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">No reports generated yet</p>
                <p className="text-xs mt-1">Generate a report from the dashboard or the Reports page.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {reports.map(r => {
                  const st = reportStatusConfig[r.verification_status]
                  const StatusIcon = st.icon
                  return (
                    <div key={r.report_id} className="flex items-center justify-between gap-3 py-3 flex-wrap">
                      <div className="space-y-0.5 min-w-0">
                        <Link
                          href={`/reports/${r.report_id}`}
                          className="font-mono text-xs font-semibold hover:underline hover:text-primary"
                        >
                          {r.report_id}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.reporting_period.start).toLocaleDateString()} — {new Date(r.reporting_period.end).toLocaleDateString()}
                          <span className="ml-2 opacity-60">
                            · Generated {new Date(r.generated_at).toLocaleDateString()}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-auto shrink-0">
                        <span className="font-mono text-sm font-semibold">
                          {r.total_emissions_tco2e.toFixed(2)}
                          <span className="text-xs font-normal text-muted-foreground ml-1">tCO2e</span>
                        </span>
                        <div className={cn(
                          'flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium',
                          st.bg, st.color,
                        )}>
                          <StatusIcon className="h-3 w-3" />
                          {st.label}
                        </div>
                        <Link href={`/reports/${r.report_id}`}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs">
                            {isAdmin
                              ? <><Pencil className="h-3 w-3" />Edit</>
                              : <><Eye   className="h-3 w-3" />View</>}
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Contacts ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide">Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                { label: 'Facility Manager',      contact: facility.facility_manager },
                { label: 'Environmental Officer', contact: facility.environmental_officer },
              ].map(({ label, contact }) => (
                <div key={label} className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className="font-medium">{contact.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{contact.title}</p>
                  {contact.email && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />{contact.email}
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />{contact.phone}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Separator className="my-4" />
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <Row label="Verification Body"  value={facility.verification_body} />
              <Row label="Last Verified"      value={facility.last_verification_date} />
              <Row label="Next Verification"  value={facility.next_verification_date} />
            </div>
          </CardContent>
        </Card>

        {/* ── ZCMA Carbon Projects ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide flex items-center gap-2">
                  <Leaf className="h-4 w-4" /> ZCMA Carbon Projects
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Sequestration and offset projects registered with the ZCMA Registry
                </CardDescription>
              </div>
              <Link href="/carbon-accounting">
                <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
                  <Scale className="h-3.5 w-3.5" />
                  {isAdmin ? 'Manage Projects' : 'Carbon Accounting'}
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0">
            {projects.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground px-6">
                <Leaf className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">No ZCMA projects registered for this facility</p>
                {isAdmin && (
                  <Link href="/carbon-accounting">
                    <Button variant="outline" size="sm" className="mt-4">
                      <Plus className="mr-2 h-3.5 w-3.5" /> Register a Project
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left font-semibold py-3 px-4">Project</th>
                        <th className="text-left font-semibold py-3 px-4">Type</th>
                        <th className="text-right font-semibold py-3 px-4">Area (ha)</th>
                        <th className="text-right font-semibold py-3 px-4">Annual Seq. (tCO2e)</th>
                        <th className="text-right font-semibold py-3 px-4">Credits</th>
                        <th className="text-left font-semibold py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {projects.map(p => (
                        <tr key={p.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="py-3 px-4">
                            <p className="font-medium">{p.project_name}</p>
                            {p.zcma_project_id && (
                              <p className="text-xs text-muted-foreground font-mono">{p.zcma_project_id}</p>
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
                            {p.credits_issued.toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className={cn('text-xs', STATUS_COLORS[p.status])}>
                              {statusLabel(p.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile list */}
                <div className="sm:hidden divide-y divide-border">
                  {projects.map(p => (
                    <div key={p.id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">{p.project_name}</p>
                        <Badge variant="outline" className={cn('text-xs shrink-0', STATUS_COLORS[p.status])}>
                          {statusLabel(p.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-xs', TYPE_COLORS[p.project_type])}>
                          {typeLabel(p.project_type)}
                        </Badge>
                        {p.area_hectares != null && (
                          <span className="text-xs text-muted-foreground">{p.area_hectares} ha</span>
                        )}
                        <span className="text-xs font-mono text-accent font-semibold">
                          {p.annual_sequestration_tco2e.toFixed(2)} tCO2e/yr
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary footer */}
                <div className="border-t border-border mt-0 pt-4 px-4 sm:px-0 pb-4 sm:pb-0 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  {[
                    { label: 'Projects', value: String(projects.length) },
                    { label: 'Total Area', value: projects.reduce((s, p) => s + (p.area_hectares ?? 0), 0).toLocaleString() + ' ha' },
                    { label: 'Annual Seq.', value: activeProjects.reduce((s, p) => s + p.annual_sequestration_tco2e, 0).toFixed(2) + ' tCO2e' },
                    { label: 'Credits Issued', value: projects.reduce((s, p) => s + p.credits_issued, 0).toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-mono font-semibold text-base mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </AppShell>
  )
}
