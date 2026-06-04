'use client'

import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Database, FileText, ShieldCheck } from 'lucide-react'

export default function MRVFrameworkPage() {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            MRV Framework
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoring, Reporting & Verification — Kgotso ClimateHealth · Zimbabwe Carbon Monitor
          </p>
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

          {/* Monitoring */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-sm">Monitoring</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">IoT Layer</Badge>
              <p>
                Real-time environmental data collection using ESP32 devices and CO₂ sensors.
              </p>
              <ul className="list-disc ml-4 space-y-1">
                <li>CO₂ readings (ppm)</li>
                <li>Timestamped sensor data</li>
                <li>Firebase Firestore storage</li>
              </ul>
            </CardContent>
          </Card>

          {/* Reporting */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-4 w-4 text-purple-600" />
              <CardTitle className="text-sm">Reporting</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">Analytics Layer</Badge>
              <p>
                Aggregation and transformation of sensor data into structured MRV reports.
              </p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Average, max, min CO₂</li>
                <li>Total emissions (tCO₂e)</li>
                <li>Monthly report generation</li>
              </ul>
            </CardContent>
          </Card>

          {/* Verification */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <CardTitle className="text-sm">Verification</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <Badge variant="outline" className="text-xs">Validation Layer</Badge>
              <p>
                Ensures data integrity and audit readiness through review workflows.
              </p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Admin review & approval</li>
                <li>Status: Pending / Verified</li>
                <li>Audit metadata tracking</li>
              </ul>
            </CardContent>
          </Card>

        </div>

        {/* Architecture Mapping */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System Architecture Mapping</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">

              <div className="border rounded-lg p-3">
                <p className="font-medium">Monitoring</p>
                <p className="text-muted-foreground text-xs mt-1">
                  ESP32 Devices + Firestore (kgotso_readings)
                </p>
              </div>

              <div className="border rounded-lg p-3">
                <p className="font-medium">Reporting</p>
                <p className="text-muted-foreground text-xs mt-1">
                  React UI + Aggregation Logic (kgotso_reports)
                </p>
              </div>

              <div className="border rounded-lg p-3">
                <p className="font-medium">Verification</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Admin Dashboard + Review Workflow
                </p>
              </div>

            </div>
          </CardContent>
        </Card>

        {/* Strengths */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Framework Strengths</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc ml-4 space-y-1">
              <li>Real-time IoT-based monitoring</li>
              <li>Automated report generation</li>
              <li>Cloud-native architecture (Firebase)</li>
              <li>Scientific CO₂ estimation model</li>
              <li>Integrated verification workflow</li>
            </ul>
          </CardContent>
        </Card>

        {/* Limitations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current Limitations</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc ml-4 space-y-1">
              <li>Limited to Scope 1 emissions</li>
              <li>No regulatory metadata (ZCMA fields)</li>
              <li>No emissions category breakdown</li>
              <li>Internal verification only (no external auditors)</li>
            </ul>
          </CardContent>
        </Card>

        {/* Future Enhancements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Future Enhancements</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc ml-4 space-y-1">
              <li>Scope 1, 2, 3 emissions classification</li>
              <li>Compliance scoring & carbon targets</li>
              <li>Carbon credit calculations</li>
              <li>External verification integration</li>
              <li>Regulatory reporting (ZCMA-ready)</li>
            </ul>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  )
}