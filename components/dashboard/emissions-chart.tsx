'use client'

import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { DailyEmissionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

interface EmissionsChartProps {
  data: DailyEmissionSummary[]
  className?: string
}

export function EmissionsChart({ data, className }: EmissionsChartProps) {
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    scope1: d.scope1_kg / 1000,
    scope2: d.scope2_kg / 1000,
    total: d.total_co2e_kg / 1000,
  }))

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle>Carbon Emissions Trend</CardTitle>
        <CardDescription>Daily CO2e emissions by scope (tonnes)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="scope1Gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="scope2Gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}t`}
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
                wrapperStyle={{ fontSize: '12px' }}
                formatter={(value) => <span className="text-muted-foreground">{value}</span>}
              />
              <Area
                type="monotone"
                dataKey="scope1"
                name="Scope 1 (Direct)"
                stackId="1"
                stroke="hsl(var(--chart-2))"
                fill="url(#scope1Gradient)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="scope2"
                name="Scope 2 (Indirect)"
                stackId="1"
                stroke="hsl(var(--chart-1))"
                fill="url(#scope2Gradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
