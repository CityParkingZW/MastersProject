'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Loader2, FileText, CheckCircle, Clock, XCircle,
  Lock, ArrowLeft, Save, AlertCircle,
} from 'lucide-react'
import type { MRVReport } from '@/lib/types'
import { cn } from '@/lib/utils'

const statusConfig = {
  pending:  { icon: Clock,       color: 'text-warning',     bg: 'bg-warning/10 border-warning/30',         label: 'Pending Verification' },
  verified: { icon: CheckCircle, color: 'text-accent',      bg: 'bg-accent/10 border-accent/30',           label: 'Verified' },
  rejected: { icon: XCircle,     color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'Rejected' },
}

function ReadOnlyRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 py-2 border-b border-border last:border-0">
      <span className="text-xs sm:text-sm text-muted-foreground sm:w-48 shrink-0 flex items-center gap-1.5">
        <Lock className="h-3 w-3 opacity-40 shrink-0" />
        {label}
      </span>
      <span className="text-sm font-mono font-medium break-all">{value}</span>
    </div>
  )
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { appUser } = useAuth()
  const router = useRouter()
  const [report,   setReport]   = useState<MRVReport | null>(null)
  const [facility, setFacility] = useState<{ id: string; facility_name: string; province: string; city_town: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Editable fields — only these can be saved
  const [summary, setSummary] = useState('')
  const [adminComments, setAdminComments] = useState('')
  const [methodologyNotes, setMethodologyNotes] = useState('')
  const [dataQualityStatement, setDataQualityStatement] = useState('')
  const [verificationStatus, setVerificationStatus] = useState<MRVReport['verification_status']>('pending')
  const [rejectionReason, setRejectionReason] = useState('')

  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'mrv_reports', id))
      if (!snap.exists()) { setLoading(false); return }

      const data = { ...snap.data(), report_id: snap.id } as MRVReport
      setReport(data)
      setSummary(data.summary ?? '')
      setAdminComments(data.admin_comments ?? '')
      setMethodologyNotes(data.methodology_notes ?? '')
      setDataQualityStatement(data.data_quality_statement ?? '')
      setVerificationStatus(data.verification_status)
      setRejectionReason(data.rejection_reason ?? '')

      // Load facility name
      const facSnap = await getDoc(doc(db, 'facilities', data.facility_id))
      if (facSnap.exists()) {
        const f = facSnap.data()
        setFacility({
          id:            facSnap.id,
          facility_name: f.facility_name,
          province:      f.province,
          city_town:     f.city_town,
        })
      }
      setLoading(false)
    }
    load()
  }, [id])

  const handleSave = async () => {
    if (!isAdmin || !report) return
    if (verificationStatus === 'rejected' && !rejectionReason.trim()) {
      setError('A rejection reason is required when status is Rejected.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await updateDoc(doc(db, 'mrv_reports', id), {
        summary,
        admin_comments:         adminComments,
        methodology_notes:      methodologyNotes,
        data_quality_statement: dataQualityStatement,
        verification_status:    verificationStatus,
        rejection_reason:       verificationStatus === 'rejected' ? rejectionReason : '',
        last_edited_by:         appUser?.uid,
        last_edited_at:         new Date().toISOString(),
      })
      setReport(prev => prev ? {
        ...prev,
        summary,
        admin_comments:         adminComments,
        methodology_notes:      methodologyNotes,
        data_quality_statement: dataQualityStatement,
        verification_status:    verificationStatus,
        rejection_reason:       verificationStatus === 'rejected' ? rejectionReason : '',
        last_edited_by:         appUser?.uid,
        last_edited_at:         new Date().toISOString(),
      } : null)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <AppShell>
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    </AppShell>
  )

  if (!report) return (
    <AppShell>
      <div className="p-6 text-muted-foreground">Report not found.</div>
    </AppShell>
  )

  const st = statusConfig[report.verification_status]
  const StatusIcon = st.icon

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-4xl w-full">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/reports">
              <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
                <ArrowLeft className="mr-1.5 h-4 w-4" />Back to Reports
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary shrink-0" />
              <Link
                href={`/facilities/${report.facility_id}`}
                className="hover:underline hover:text-primary"
              >
                {facility?.facility_name ?? report.facility_id}
              </Link>
            </h1>
            {facility && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {facility.province} · {facility.city_town}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Report <span className="font-mono text-xs">{report.report_id}</span>
              {' · '}Generated {new Date(report.generated_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {report.zcma_compliant && (
              <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">ZCMA ✓</Badge>
            )}
            <div className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-medium', st.bg, st.color)}>
              <StatusIcon className="h-4 w-4" />
              {st.label}
            </div>
          </div>
        </div>

        {/* ── SECTION 1: Sensor-calculated emission data (READ ONLY) ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Emission Data — Sensor Recorded Values (Read Only)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl sm:text-4xl font-bold font-mono">{report.total_emissions_tco2e.toFixed(3)}</span>
              <span className="text-muted-foreground text-sm">tCO2e total</span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(['scope1', 'scope2', 'scope3'] as const).map(s => (
                <div key={s} className="p-3 rounded-lg bg-secondary text-center">
                  <p className="text-xs text-muted-foreground capitalize">{s.replace('scope', 'Scope ')}</p>
                  <p className="font-mono font-semibold mt-0.5">{report.emissions_by_scope[s].toFixed(3)} t</p>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-0">
              <ReadOnlyRow label="Reporting Period Start" value={new Date(report.reporting_period.start).toLocaleDateString()} />
              <ReadOnlyRow label="Reporting Period End"   value={new Date(report.reporting_period.end).toLocaleDateString()} />
              <ReadOnlyRow label="Generated At"           value={new Date(report.generated_at).toLocaleString()} />
              {report.generated_by && <ReadOnlyRow label="Generated By (UID)" value={report.generated_by} />}
            </div>

            <Separator />

            {/* Emissions by source */}
            <div>
              <p className="text-sm font-medium mb-3 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 opacity-40" />
                Emissions by Source
              </p>
              <div className="space-y-2">
                {report.emissions_by_source.map((src, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2.5 border-b border-border last:border-0 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{src.source_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{src.methodology}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-sm">{src.emissions_tco2e.toFixed(3)} tCO2e</span>
                      <Badge variant="outline" className="text-xs capitalize shrink-0">
                        {src.data_quality}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground italic flex items-center gap-1.5 pt-1">
              <Lock className="h-3 w-3" />
              These values are calculated directly from sensor readings and cannot be edited.
            </p>
          </CardContent>
        </Card>

        {/* ── SECTION 2: Admin-editable fields ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide">
              {isAdmin ? 'Report Summary & Admin Notes' : 'Report Summary & Notes'}
            </CardTitle>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">These fields are editable by administrators only.</p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Verification status — admin only */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Verification Status
                {!isAdmin && <Lock className="h-3 w-3 opacity-40" />}
              </Label>
              {isAdmin ? (
                <Select
                  value={verificationStatus}
                  onValueChange={v => setVerificationStatus(v as MRVReport['verification_status'])}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending Verification</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-medium w-fit', st.bg, st.color)}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {st.label}
                </div>
              )}
            </div>

            {/* Rejection reason — shown only when rejected */}
            {(verificationStatus === 'rejected' || report.rejection_reason) && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Rejection Reason
                  {!isAdmin && <Lock className="h-3 w-3 opacity-40" />}
                  {isAdmin && verificationStatus === 'rejected' && (
                    <span className="text-destructive text-xs">*required</span>
                  )}
                </Label>
                <Textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Explain why the report was rejected..."
                  rows={2}
                  readOnly={!isAdmin}
                  className={cn(!isAdmin && 'bg-secondary cursor-default')}
                />
              </div>
            )}

            <Separator />

            {/* Executive Summary */}
            <div className="space-y-2">
              <Label htmlFor="summary">Executive Summary</Label>
              <Textarea
                id="summary"
                value={summary}
                onChange={e => setSummary(e.target.value)}
                placeholder="Provide a narrative summary of emissions for this reporting period..."
                rows={4}
                readOnly={!isAdmin}
                className={cn(!isAdmin && 'bg-secondary cursor-default')}
              />
            </div>

            {/* Methodology Notes */}
            <div className="space-y-2">
              <Label htmlFor="methodology">Methodology Notes</Label>
              <Textarea
                id="methodology"
                value={methodologyNotes}
                onChange={e => setMethodologyNotes(e.target.value)}
                placeholder="Describe the methodologies and emission factors used (GHG Protocol, IPCC 2006, ZESA grid factor, etc.)..."
                rows={3}
                readOnly={!isAdmin}
                className={cn(!isAdmin && 'bg-secondary cursor-default')}
              />
            </div>

            {/* Data Quality Statement */}
            <div className="space-y-2">
              <Label htmlFor="dqs">Data Quality Statement</Label>
              <Textarea
                id="dqs"
                value={dataQualityStatement}
                onChange={e => setDataQualityStatement(e.target.value)}
                placeholder="Describe data completeness, measurement uncertainty, and any data gaps during this period..."
                rows={3}
                readOnly={!isAdmin}
                className={cn(!isAdmin && 'bg-secondary cursor-default')}
              />
            </div>

            {/* Admin Comments (internal only) */}
            {isAdmin && (
              <div className="space-y-2">
                <Label htmlFor="comments">Internal Admin Comments</Label>
                <p className="text-xs text-muted-foreground">Visible to admins only — not included in exported reports.</p>
                <Textarea
                  id="comments"
                  value={adminComments}
                  onChange={e => setAdminComments(e.target.value)}
                  placeholder="Internal notes about this report (not exported)..."
                  rows={3}
                />
              </div>
            )}

            {/* Last edited note */}
            {report.last_edited_at && (
              <p className="text-xs text-muted-foreground">
                Last edited {new Date(report.last_edited_at).toLocaleString()}
                {report.last_edited_by && ` · UID: ${report.last_edited_by}`}
              </p>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Save button — admin only */}
            {isAdmin && (
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <><Save className="h-4 w-4" />Save Changes</>
                  )}
                </Button>
                {saved && (
                  <span className="text-sm text-accent flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4" />Saved
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
