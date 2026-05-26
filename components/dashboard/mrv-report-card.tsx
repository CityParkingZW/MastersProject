'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { FileText, Download, CheckCircle, Clock, XCircle, Pencil, Eye } from 'lucide-react'
import type { MRVReport } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MRVReportCardProps {
  report: MRVReport | null
  onGenerate?: () => void
  onDownload?: () => void
  isGenerating?: boolean
  isAdmin?: boolean
  className?: string
}

export function MRVReportCard({
  report,
  onGenerate,
  onDownload,
  isGenerating = false,
  isAdmin = false,
  className,
}: MRVReportCardProps) {
  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'text-warning',
      bg: 'bg-warning/10 border-warning/30',
      label: 'Pending Verification',
    },
    verified: {
      icon: CheckCircle,
      color: 'text-accent',
      bg: 'bg-accent/10 border-accent/30',
      label: 'Verified',
    },
    rejected: {
      icon: XCircle,
      color: 'text-destructive',
      bg: 'bg-destructive/10 border-destructive/30',
      label: 'Rejected',
    },
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>MRV Compliance Report</CardTitle>
              <CardDescription>ZCMA Registry Compatible</CardDescription>
            </div>
          </div>
          {report?.zcma_compliant && (
            <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
              ZCMA Compliant
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {report ? (
          <>
            {/* Report status */}
            <div className={cn('flex items-center gap-3 p-3 rounded-lg border', statusConfig[report.verification_status].bg)}>
              {(() => {
                const StatusIcon = statusConfig[report.verification_status].icon
                return <StatusIcon className={cn('h-5 w-5', statusConfig[report.verification_status].color)} />
              })()}
              <div className="flex-1">
                <p className={cn('font-medium', statusConfig[report.verification_status].color)}>
                  {statusConfig[report.verification_status].label}
                </p>
                <p className="text-xs text-muted-foreground">
                  Report{' '}
                  <Link
                    href={`/reports/${report.report_id}`}
                    className="font-mono hover:underline text-foreground"
                  >
                    {report.report_id}
                  </Link>
                </p>
              </div>
            </div>

            {/* Report period */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Reporting Period</p>
                <p className="text-sm font-mono">
                  {new Date(report.reporting_period.start).toLocaleDateString()} - {new Date(report.reporting_period.end).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Generated</p>
                <p className="text-sm font-mono">{new Date(report.generated_at).toLocaleString()}</p>
              </div>
            </div>

            <Separator />

            {/* Emissions summary */}
            <div>
              <p className="text-sm font-medium mb-3">Total Emissions</p>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold font-mono">{report.total_emissions_tco2e.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground">tCO2e</span>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="p-2 rounded bg-secondary">
                  <p className="text-xs text-muted-foreground">Scope 1</p>
                  <p className="font-mono text-sm">{report.emissions_by_scope.scope1.toFixed(2)}t</p>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <p className="text-xs text-muted-foreground">Scope 2</p>
                  <p className="font-mono text-sm">{report.emissions_by_scope.scope2.toFixed(2)}t</p>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <p className="text-xs text-muted-foreground">Scope 3</p>
                  <p className="font-mono text-sm">{report.emissions_by_scope.scope3.toFixed(2)}t</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={onDownload} className="flex-1" variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
              <Link href={`/reports/${report.report_id}`} className="flex-1">
                <Button variant="outline" className="w-full">
                  {isAdmin
                    ? <><Pencil className="mr-2 h-4 w-4" />Edit Report</>
                    : <><Eye    className="mr-2 h-4 w-4" />View Report</>}
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              No report generated yet. Generate a compliance report for the current period.
            </p>
            <Button onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Report
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
