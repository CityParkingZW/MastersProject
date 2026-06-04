'use client'

import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SensorReading } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface SensorTimeSeriesProps {
  data: SensorReading[]
  className?: string
}

type MetricKey = 'co2_mg_m3' | 'ch4_mg_m3' | 'temperature' | 'humidity' | 'energy_kwh'

const metricConfig: Record<MetricKey, { label: string; color: string; unit: string }> = {
  co2_mg_m3:   { label: 'CO₂',      color: 'hsl(var(--chart-1))', unit: 'mg/m³' },
  ch4_mg_m3:   { label: 'CH₄',      color: 'hsl(var(--chart-2))', unit: 'mg/m³' },
  temperature: { label: 'Temp',     color: 'hsl(var(--chart-3))', unit: '°C' },
  humidity:    { label: 'Humidity', color: 'hsl(var(--chart-4))', unit: '%' },
  energy_kwh:  { label: 'Energy',   color: 'hsl(var(--chart-5))', unit: 'kWh' },
}

export function SensorTimeSeries({ data, className }: SensorTimeSeriesProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['co2_mg_m3', 'ch4_mg_m3'])

  const chartData = data.map((d) => ({
    time:        new Date(d.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    co2_mg_m3:   d.co2_mg_m3,
    ch4_mg_m3:   d.ch4_mg_m3 * 100, // Scale up for visibility on shared axis
    temperature: d.temperature,
    humidity:    d.humidity,
    energy_kwh:  d.energy_kwh,
  }))

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric)
        ? prev.filter((m) => m !== metric)
        : [...prev, metric]
    )
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sensor Readings</CardTitle>
            <CardDescription>Real-time sensor data over the last 24 hours</CardDescription>
          </div>
          <Tabs defaultValue="co2_mg_m3" className="w-auto">
            <TabsList className="h-8">
              {(Object.keys(metricConfig) as MetricKey[]).map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  onClick={() => toggleMetric(key)}
                  className={cn(
                    'text-xs px-2 py-1',
                    selectedMetrics.includes(key) && 'bg-primary/20'
                  )}
                  style={{
                    borderBottom: selectedMetrics.includes(key)
                      ? `2px solid ${metricConfig[key].color}`
                      : 'none',
                  }}
                >
                  {metricConfig[key].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                formatter={(value) => {
                  const metric = value as MetricKey
                  return (
                    <span className="text-muted-foreground">
                      {metricConfig[metric]?.label || value} ({metricConfig[metric]?.unit || ''})
                    </span>
                  )
                }}
              />
              {selectedMetrics.map((metric) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  name={metric}
                  stroke={metricConfig[metric].color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
