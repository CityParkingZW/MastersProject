'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { collection, addDoc, getDocs, query, where, getDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SensorGauge } from '@/components/dashboard/sensor-gauge'
import { AlertList } from '@/components/dashboard/alert-list'
import { EmissionsChart } from '@/components/dashboard/emissions-chart'
import { SensorTimeSeries } from '@/components/dashboard/sensor-time-series'
import { PredictionChart } from '@/components/dashboard/prediction-chart'
import { CarbonSummary } from '@/components/dashboard/carbon-summary'
import { MRVReportCard } from '@/components/dashboard/mrv-report-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import {
  Thermometer, Droplets, Wind, Zap, Gauge, Factory,
  Scale, TrendingUp, TrendingDown, ChevronRight,
} from 'lucide-react'

import {
  generateSensorReading,
  generateHistoricalData,
  calculateCarbonEmission,
  generatePredictions,
  generateDailySummaries,
  generateAlerts,
} from '@/lib/simulator'

import type { SensorReading, Alert, DailyEmissionSummary, Prediction, MRVReport, Facility, ZCMAProject } from '@/lib/types'

function getCO2Status(r: SensorReading | null): 'critical' | 'warning' | 'normal' {
  if (!r) return 'normal'
  if (r.co2_ppm > 700) return 'critical'
  if (r.co2_ppm > 550) return 'warning'
  return 'normal'
}

function getCH4Status(r: SensorReading | null): 'critical' | 'warning' | 'normal' {
  if (!r) return 'normal'
  if (r.ch4_ppm > 8) return 'critical'
  if (r.ch4_ppm > 5) return 'warning'
  return 'normal'
}

function sourceWeight(sourceType: string): number {
  if (sourceType === 'stationary_combustion') return 0.72
  if (sourceType === 'process_emissions') return 0.18
  return 0.1
}

function buildEmissionSources(
  fac: Facility | null,
  scope1Kg: number,
  scope2Kg: number,
  toTonne: (kg: number) => number,
): MRVReport['emissions_by_source'] {
  if (!fac?.emission_sources) return []
  return fac.emission_sources
    .filter(s => s.applicable)
    .map(s => {
      const rawKg = s.scope === 1 ? scope1Kg * sourceWeight(s.source_type) : scope2Kg
      const methodology = s.scope === 2 ? 'ZESA Grid Factor 0.582 kg CO₂e/kWh' : 'GHG Protocol / IPCC 2006'
      return {
        source_name:     s.description,
        emissions_tco2e: toTonne(rawKg),
        methodology,
        data_quality:    'measured' as const,
      }
    })
}

export default function DashboardPage() {
  const { appUser } = useAuth()
  const router = useRouter()
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting')
  const [esp32Connected, setEsp32Connected] = useState(false)
  const [timeRange, setTimeRange] = useState('24h')
  const [currentReading, setCurrentReading] = useState<SensorReading | null>(null)
  const [historicalData, setHistoricalData] = useState<SensorReading[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [dailySummaries, setDailySummaries] = useState<DailyEmissionSummary[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [mrvReport, setMrvReport] = useState<MRVReport | null>(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [reportFacilityId, setReportFacilityId] = useState('')
  const [facilityProjects, setFacilityProjects] = useState<ZCMAProject[]>([])

  // Initialize historical/summary data from simulator (always used for charts)
  useEffect(() => {
    const historical = generateHistoricalData(24)
    setHistoricalData(historical)
    setDailySummaries(generateDailySummaries(30))
    setPredictions(generatePredictions(historical, 24))
    setConnectionStatus('connected')
  }, [])

  // Poll ESP32 API every 5 seconds for live readings
  useEffect(() => {
    const pollESP32 = async () => {
      try {
        const res = await fetch('/api/sensor-data')
        const data = await res.json()

        if (data.connected) {
          setEsp32Connected(true)
          const reading: SensorReading = {
            device_id: 'esp32-001',
            facility_id: 'FAC001',
            timestamp: data.received_at,
            co2_ppm: data.co2_ppm,
            ch4_ppm: data.ch4_ppm,
            temperature: data.temperature,
            humidity: data.humidity,
            energy_kwh: data.energy_kwh || 0,
            air_quality_index: Math.round(data.co2_ppm / 10),
            data_source: 'esp32' as const,
          }
          setCurrentReading(reading)
          setHistoricalData(prev => [...prev, reading].slice(-48))
          const newAlerts = generateAlerts(reading)
          if (newAlerts.length > 0) {
            setAlerts(prev => [...newAlerts, ...prev].slice(0, 20))
          }
        } else {
          setEsp32Connected(false)
        }
      } catch {
        setEsp32Connected(false)
      }
    }

    const interval = setInterval(pollESP32, 5000)
    pollESP32()
    return () => clearInterval(interval)
  }, [])

  // Simulator fallback — only runs when ESP32 is not connected
  useEffect(() => {
    if (esp32Connected) return

    const updateInterval = setInterval(() => {
      const newReading = generateSensorReading()
      setCurrentReading(newReading)
      setHistoricalData(prev => [...prev, newReading].slice(-48))
      const newAlerts = generateAlerts(newReading)
      if (newAlerts.length > 0) {
        setAlerts(prev => [...newAlerts, ...prev].slice(0, 20))
      }
      if (Math.random() < 0.1) {
        setHistoricalData(current => {
          setPredictions(generatePredictions(current, 24))
          return current
        })
      }
    }, 3000)

    return () => clearInterval(updateInterval)
  }, [esp32Connected])

  // Load facilities accessible to the current user
  useEffect(() => {
    if (!appUser) return
    getDocs(collection(db, 'facilities')).then(snap => {
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Facility)
      const accessible = appUser.facilityIds[0] === '*'
        ? all
        : all.filter(f => appUser.facilityIds.includes(f.id))
      setFacilities(accessible)
      if (accessible.length > 0) setReportFacilityId(accessible[0].id)
    })
  }, [appUser])

  // Load ZCMA projects for the selected facility
  useEffect(() => {
    if (!reportFacilityId) return
    getDocs(query(collection(db, 'zcma_projects'), where('facility_id', '==', reportFacilityId)))
      .then(snap => setFacilityProjects(snap.docs.map(d => ({ ...d.data(), id: d.id }) as ZCMAProject)))
  }, [reportFacilityId])

  // Calculate current emissions
  const currentEmission = currentReading ? calculateCarbonEmission(currentReading) : null

  // Calculate totals
  const totalEmissionsMTD = dailySummaries.reduce((sum, d) => sum + d.total_co2e_kg, 0)
  const targetEmissions = 150000 // 150 tonnes target
  const previousMonthEmissions = totalEmissionsMTD * 1.1 // Simulate 10% reduction

  // Refresh handler
  const handleRefresh = useCallback(() => {
    setConnectionStatus('connecting')
    setTimeout(() => {
      setHistoricalData(generateHistoricalData(24))
      setDailySummaries(generateDailySummaries(30))
      setConnectionStatus('connected')
    }, 1000)
  }, [])

  // Alert acknowledgment
  const handleAcknowledgeAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
  }

  // Generate MRV report — fetches real daily summaries, saves to Firestore, then navigates
  const handleGenerateReport = useCallback(async () => {
    if (!reportFacilityId) return
    setIsGeneratingReport(true)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const snap = await getDocs(
        query(collection(db, 'daily_summaries'), where('facility_id', '==', reportFacilityId))
      )
      const summaries = snap.docs
        .map(d => d.data() as DailyEmissionSummary)
        .filter(d => d.date >= thirtyDaysAgo)
        .sort((a, b) => a.date.localeCompare(b.date))
      const totalKg  = summaries.reduce((s, d) => s + d.total_co2e_kg, 0)
      const scope1Kg = summaries.reduce((s, d) => s + d.scope1_kg, 0)
      const scope2Kg = summaries.reduce((s, d) => s + d.scope2_kg, 0)
      const toTonne  = (kg: number) => Number.parseFloat((kg / 1000).toFixed(3))

      const facSnap = await getDoc(doc(db, 'facilities', reportFacilityId))
      const fac = facSnap.exists() ? facSnap.data() as Facility : null

      const now = new Date().toISOString()
      const start = summaries[0]
        ? new Date(summaries[0].date + 'T00:00:00Z').toISOString()
        : thirtyDaysAgo + 'T00:00:00Z'

      const emissionSources = buildEmissionSources(fac, scope1Kg, scope2Kg, toTonne)

      const report: Omit<MRVReport, 'report_id'> = {
        facility_id:           reportFacilityId,
        reporting_period:      { start, end: now },
        total_emissions_tco2e: toTonne(totalKg),
        emissions_by_scope: {
          scope1: toTonne(scope1Kg),
          scope2: toTonne(scope2Kg),
          scope3: 0,
        },
        emissions_by_source:  emissionSources,
        verification_status:  'pending',
        generated_at:         now,
        generated_by:         appUser?.uid,
        zcma_compliant:       fac?.zcma_compliant ?? true,
      }
      const docRef = await addDoc(collection(db, 'mrv_reports'), report)
      setMrvReport({ ...report, report_id: docRef.id })
      router.push(`/reports/${docRef.id}`)
    } finally {
      setIsGeneratingReport(false)
    }
  }, [reportFacilityId, appUser?.uid, router])

  const co2Status = getCO2Status(currentReading)
  const ch4Status = getCH4Status(currentReading)
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged)
  const facilityOptions: ComboboxOption[] = facilities.map(f => ({ value: f.id, label: f.facility_name }))

  // Carbon net position for selected facility
  const activeProjectOffsets = facilityProjects
    .filter(p => p.status === 'active' || p.status === 'verified')
    .reduce((s, p) => s + p.annual_sequestration_tco2e, 0)
  const latestEmissionsTonne = mrvReport?.total_emissions_tco2e ?? 0
  const netCarbon = latestEmissionsTonne - activeProjectOffsets
  const offsetCoverage = latestEmissionsTonne > 0
    ? Math.min(100, (activeProjectOffsets / latestEmissionsTonne) * 100)
    : 0

  return (
    <AppShell>
    <div className="min-h-screen bg-background">
      <DashboardHeader
        facilityName="Test Facility - Harare Industrial Park"
        connectionStatus={connectionStatus}
        lastUpdate={currentReading?.timestamp || new Date().toISOString()}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        onRefresh={handleRefresh}
        alertCount={unacknowledgedAlerts.length}
      />

      <main className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Top metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          <MetricCard
            title="CO2 Level"
            value={currentReading?.co2_ppm || 0}
            unit="ppm"
            trend={currentReading && currentReading.co2_ppm > 500 ? 'up' : 'stable'}
            trendValue="+2.3%"
            icon={<Wind className="h-4 w-4" />}
            status={co2Status}
          />
          <MetricCard
            title="Methane"
            value={currentReading?.ch4_ppm || 0}
            unit="ppm"
            trend="stable"
            trendValue="-0.5%"
            icon={<Gauge className="h-4 w-4" />}
            status={ch4Status}
          />
          <MetricCard
            title="Temperature"
            value={currentReading?.temperature || 0}
            unit="°C"
            trend="stable"
            icon={<Thermometer className="h-4 w-4" />}
          />
          <MetricCard
            title="Humidity"
            value={currentReading?.humidity || 0}
            unit="%"
            trend="down"
            trendValue="-3.1%"
            icon={<Droplets className="h-4 w-4" />}
          />
          <MetricCard
            title="Energy"
            value={currentReading?.energy_kwh || 0}
            unit="kWh"
            trend="up"
            trendValue="+5.2%"
            icon={<Zap className="h-4 w-4" />}
          />
          <MetricCard
            title="CO2e Rate"
            value={currentEmission?.total_co2e_kg || 0}
            unit="kg/hr"
            trend="stable"
            icon={<Factory className="h-4 w-4" />}
            status={currentEmission && currentEmission.total_co2e_kg > 200 ? 'warning' : 'normal'}
          />
        </div>

        {/* Charts — full width */}
        <Tabs defaultValue="sensors" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="sensors">Sensor Data</TabsTrigger>
            <TabsTrigger value="emissions">Emissions</TabsTrigger>
            <TabsTrigger value="predictions">AI Predictions</TabsTrigger>
          </TabsList>
          <TabsContent value="sensors">
            <SensorTimeSeries data={historicalData} />
          </TabsContent>
          <TabsContent value="emissions">
            <EmissionsChart data={dailySummaries} />
          </TabsContent>
          <TabsContent value="predictions">
            <PredictionChart predictions={predictions} />
          </TabsContent>
        </Tabs>

        {/* Aligned row: Live Sensor Readings + Emissions + Net Carbon */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
          {/* Live Sensor Readings — spans 2 cols so inner 2×2 gauge grid has room */}
          <Card className="md:col-span-2 xl:col-span-2">
            <CardHeader>
              <CardTitle>Live Sensor Readings</CardTitle>
              <CardDescription>Real-time values with threshold indicators</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-6">
                <SensorGauge
                  label="CO2 Concentration"
                  value={currentReading?.co2_ppm || 0}
                  min={300}
                  max={1000}
                  unit="ppm"
                  warningThreshold={600}
                  criticalThreshold={800}
                />
                <SensorGauge
                  label="Methane (CH4)"
                  value={currentReading?.ch4_ppm || 0}
                  min={0}
                  max={15}
                  unit="ppm"
                  warningThreshold={5}
                  criticalThreshold={10}
                />
                <SensorGauge
                  label="Temperature"
                  value={currentReading?.temperature || 0}
                  min={10}
                  max={45}
                  unit="°C"
                  warningThreshold={32}
                  criticalThreshold={40}
                />
                <SensorGauge
                  label="Energy Consumption"
                  value={currentReading?.energy_kwh || 0}
                  min={0}
                  max={600}
                  unit="kWh"
                  warningThreshold={400}
                  criticalThreshold={550}
                />
              </div>
            </CardContent>
          </Card>

          {/* Carbon Emissions Summary */}
          <CarbonSummary
            currentEmissions={totalEmissionsMTD}
            targetEmissions={targetEmissions}
            previousPeriodEmissions={previousMonthEmissions}
            period="Month"
          />

          {/* Net Carbon Position */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Scale className="h-4 w-4 text-primary" />
                  Net Carbon Position
                </CardTitle>
                <Link href="/carbon-accounting">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    Details <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </Link>
              </div>
              <CardDescription className="text-xs">
                {latestEmissionsTonne > 0
                  ? 'Latest MRV report vs active ZCMA offsets'
                  : 'Generate an MRV report to see net position'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-secondary p-2.5">
                  <p className="text-xs text-muted-foreground">Gross Emissions</p>
                  <p className="text-base font-semibold tabular-nums">
                    {latestEmissionsTonne.toFixed(1)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">tCO₂e</span>
                  </p>
                </div>
                <div className="rounded-md bg-secondary p-2.5">
                  <p className="text-xs text-muted-foreground">ZCMA Offsets</p>
                  <p className="text-base font-semibold tabular-nums text-green-600 dark:text-green-400">
                    {activeProjectOffsets.toFixed(1)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">tCO₂e</span>
                  </p>
                </div>
              </div>

              {latestEmissionsTonne > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Coverage</span>
                    <span>{offsetCoverage.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all"
                      style={{ width: `${offsetCoverage}%` }}
                    />
                  </div>
                </div>
              )}

              <div className={`flex items-center justify-between rounded-md p-2.5 ${
                netCarbon <= 0
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : 'bg-destructive/10 text-destructive'
              }`}>
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {netCarbon <= 0
                    ? <TrendingDown className="h-3.5 w-3.5" />
                    : <TrendingUp className="h-3.5 w-3.5" />}
                  Net position
                </div>
                <p className="text-sm font-bold tabular-nums">
                  {netCarbon <= 0 ? '' : '+'}{netCarbon.toFixed(1)} tCO₂e
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MRV Report + Alerts */}
        <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
          <div className="md:col-span-2 space-y-4">
            {facilities.length > 1 && (
              <Combobox
                options={facilityOptions}
                value={reportFacilityId}
                onValueChange={setReportFacilityId}
                placeholder="Select facility…"
                searchPlaceholder="Search facilities…"
              />
            )}
            <MRVReportCard
              report={mrvReport}
              onGenerate={handleGenerateReport}
              onDownload={() => alert('Downloading PDF...')}
              isGenerating={isGeneratingReport}
              isAdmin={appUser?.role === 'admin'}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Active Alerts
                {unacknowledgedAlerts.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {unacknowledgedAlerts.length} unacknowledged
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AlertList
                alerts={alerts}
                onAcknowledge={handleAcknowledgeAlert}
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
    </AppShell>
  )
}
