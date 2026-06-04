'use client'

import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { TrendingDown, TrendingUp, Leaf, Scale, Activity, FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Carbon calculation constants (Harare, 1,483 m altitude) ──────────────────
const MONITORING_VOL_M3   = 3_000   // 1,000 m² × 3 m ceiling
const HARARE_AIR_DENSITY  = 1.09    // kg/m³
const CO2_MOL_MASS        = 44.01
const AIR_MOL_MASS        = 28.97
const AMBIENT_CO2_PPM     = 420
const CO2_SCALE           = (MONITORING_VOL_M3 * HARARE_AIR_DENSITY * (CO2_MOL_MASS / AIR_MOL_MASS)) / 1e6

function excessKgPerHour(ppm: number) {
  return Math.max(0, ppm - AMBIENT_CO2_PPM) * CO2_SCALE
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

interface MonthStat {
  key:         string   // 'YYYY-MM'
  label:       string   // 'Jun 2023'
  avg_ppm:     number
  max_ppm:     number
  min_ppm:     number
  readings:    number
  co2e_kg:     number   // total excess CO₂ kg for the month
  co2e_tonne:  number
  completeness: number  // % of expected 720 h (30 days × 24 h)
}

const PIE_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#f97316', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#ef4444', '#84cc16', '#a855f7']

export default function CarbonAccountingPage() {
  const [monthStats, setMonthStats] = useState<MonthStat[]>([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const snap = await getDocs(
        query(collection(db, 'kgotso_readings'), orderBy('timestamp', 'asc'))
      )

      // Group by YYYY-MM
      const groups: Record<string, { ppm: number[]; kgArr: number[] }> = {}
      snap.docs.forEach(d => {
        const data = d.data()
        const ts   = data.timestamp?.toDate?.() as Date | undefined
        if (!ts || typeof data.co2_ppm !== 'number') return
        const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2,'0')}`
        if (!groups[key]) groups[key] = { ppm: [], kgArr: [] }
        groups[key].ppm.push(data.co2_ppm)
        groups[key].kgArr.push(excessKgPerHour(data.co2_ppm))
      })

      const stats: MonthStat[] = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, { ppm, kgArr }]) => {
          const [year, month] = key.split('-').map(Number)
          const avg_ppm   = Math.round(ppm.reduce((s,v)=>s+v,0) / ppm.length)
          const max_ppm   = Math.max(...ppm)
          const min_ppm   = Math.min(...ppm)
          const co2e_kg   = kgArr.reduce((s,v)=>s+v,0)
          return {
            key,
            label:        `${MONTH_NAMES[month-1]} ${year}`,
            avg_ppm,
            max_ppm,
            min_ppm,
            readings:     ppm.length,
            co2e_kg:      Number(co2e_kg.toFixed(2)),
            co2e_tonne:   Number((co2e_kg / 1000).toFixed(4)),
            completeness: Math.min(100, Math.round((ppm.length / 720) * 100)),
          }
        })

      setMonthStats(stats)
      setLoading(false)
    }
    load()
  }, [])

  const totalCO2e = useMemo(() => monthStats.reduce((s,m)=>s+m.co2e_tonne,0), [monthStats])
  const avgMonthly = monthStats.length ? totalCO2e / monthStats.length : 0

  // Trend: compare last two full months
  const lastTwo = monthStats.slice(-2)
  const trend = lastTwo.length === 2
    ? ((lastTwo[1].co2e_tonne - lastTwo[0].co2e_tonne) / Math.max(lastTwo[0].co2e_tonne, 0.0001)) * 100
    : 0

  // Pie data: each month's share
  const pieData = monthStats.map(m => ({ name: m.label, value: Number(m.co2e_tonne.toFixed(4)) }))

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
      <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Carbon Accounting</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Scope 1 direct CO₂ — Harare monitoring station · {MONITORING_VOL_M3.toLocaleString()} m³ reference volume
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 print:hidden shrink-0">
            <FileDown className="h-3.5 w-3.5" /> Print / Save PDF
          </Button>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 px-5 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total (dataset)</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{totalCO2e.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground">tCO₂e</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 px-5 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg per month</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{avgMonthly.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground">tCO₂e / month</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 px-5 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Month-on-month</p>
              <div className={`flex items-center gap-2 mt-1 ${trend <= 0 ? 'text-green-600' : 'text-destructive'}`}>
                {trend <= 0
                  ? <TrendingDown className="h-5 w-5" />
                  : <TrendingUp   className="h-5 w-5" />}
                <span className="text-3xl font-bold tabular-nums">{Math.abs(trend).toFixed(1)}%</span>
              </div>
              <p className="text-xs text-muted-foreground">{trend <= 0 ? 'decrease' : 'increase'} vs prior month</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 px-5 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Months monitored</p>
              <p className="text-3xl font-bold tabular-nums mt-1">{monthStats.length}</p>
              <p className="text-xs text-muted-foreground">Jun 2023 – May 2024</p>
            </CardContent>
          </Card>
        </div>

        {/* Monthly CO₂e bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Monthly Carbon Footprint (tCO₂e)</CardTitle>
            <CardDescription>Excess CO₂ above 420 ppm ambient, converted to metric tonnes CO₂ equivalent</CardDescription>
          </CardHeader>
          <CardContent className="h-72 pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthStats} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={55} tickFormatter={v => `${v} t`} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v: number) => [`${v.toFixed(4)} tCO₂e`, 'Carbon footprint']}
                />
                <Bar dataKey="co2e_tonne" fill="#3b82f6" radius={[3,3,0,0]} name="tCO₂e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Monthly avg CO₂ ppm + distribution */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Monthly Average CO₂ (ppm)</CardTitle>
            </CardHeader>
            <CardContent className="h-64 pr-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthStats} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis domain={[350, 'auto']} tick={{ fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${v} ppm`, 'Avg CO₂']} />
                  <Bar dataKey="avg_ppm" fill="#06b6d4" radius={[3,3,0,0]} name="Avg CO₂ (ppm)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Carbon Share by Month</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%"
                    outerRadius={90}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={10}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toFixed(4)} tCO₂e`} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Monthly stats table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Summary Table</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="pb-2 pr-4">Month</th>
                  <th className="pb-2 pr-4">Avg CO₂</th>
                  <th className="pb-2 pr-4">Max CO₂</th>
                  <th className="pb-2 pr-4">Min CO₂</th>
                  <th className="pb-2 pr-4">Footprint</th>
                  <th className="pb-2 pr-4">Readings</th>
                  <th className="pb-2">Completeness</th>
                </tr>
              </thead>
              <tbody>
                {monthStats.map(m => (
                  <tr key={m.key} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{m.label}</td>
                    <td className="py-2 pr-4 tabular-nums">{m.avg_ppm} ppm</td>
                    <td className="py-2 pr-4 tabular-nums">{m.max_ppm} ppm</td>
                    <td className="py-2 pr-4 tabular-nums">{m.min_ppm} ppm</td>
                    <td className="py-2 pr-4 tabular-nums">{m.co2e_tonne.toFixed(4)} tCO₂e</td>
                    <td className="py-2 pr-4 tabular-nums">{m.readings}</td>
                    <td className="py-2">
                      <Badge variant="outline" className={cn(
                        m.completeness >= 80 ? 'text-green-700 border-green-500/40' :
                        m.completeness >= 50 ? 'text-yellow-700 border-yellow-500/40' :
                                               'text-red-700 border-red-500/40'
                      )}>
                        {m.completeness}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Methodology note */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Leaf className="h-4 w-4 text-green-600" /> Methodology</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>Excess CO₂ mass per hour = max(0, CO₂_ppm − 420) × {MONITORING_VOL_M3.toLocaleString()} m³ × 1.09 kg/m³ × (44.01/28.97) / 10⁶</p>
            <p>≈ excess_ppm × 0.004968 kg/h · Monthly totals summed from hourly readings.</p>
            <p>Reference: IPCC AR6 · Harare altitude 1,483 m · Air density 1.09 kg/m³ · Ambient CO₂ 420 ppm baseline</p>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  )
}
