'use client'

import { Area, AreaChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Prediction } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PredictionChartProps {
  predictions: Prediction[]
  className?: string
}

export function PredictionChart({ predictions, className }: PredictionChartProps) {
  const chartData = predictions.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    predicted: p.predicted_co2e_kg,
    lower: p.confidence_lower,
    upper: p.confidence_upper,
    range: [p.confidence_lower, p.confidence_upper],
  }))

  // Calculate summary stats
  const totalPredicted = predictions.reduce((sum, p) => sum + p.predicted_co2e_kg, 0)
  const avgPredicted = totalPredicted / predictions.length
  const modelVersion = predictions[0]?.model_version || 'N/A'

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              AI Emission Predictions
              <Badge variant="secondary" className="font-mono text-xs">
                {modelVersion}
              </Badge>
            </CardTitle>
            <CardDescription>24-hour forecast with confidence intervals</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold font-mono text-primary">
              {totalPredicted.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">kg CO2e</span>
            </p>
            <p className="text-xs text-muted-foreground">predicted total</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                interval={3}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    predicted: 'Predicted',
                    lower: 'Lower Bound',
                    upper: 'Upper Bound',
                  }
                  return [`${value.toFixed(2)} kg`, labels[name] || name]
                }}
              />
              {/* Confidence interval area */}
              <Area
                type="monotone"
                dataKey="upper"
                stroke="transparent"
                fill="url(#confidenceGradient)"
                fillOpacity={1}
              />
              <Area
                type="monotone"
                dataKey="lower"
                stroke="transparent"
                fill="hsl(var(--background))"
                fillOpacity={1}
              />
              {/* Main prediction line */}
              <Line
                type="monotone"
                dataKey="predicted"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
              />
              {/* Reference line for average */}
              <ReferenceLine
                y={avgPredicted}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4 bg-primary" />
            <span>Predicted</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-4 bg-primary/20 rounded-sm" />
            <span>95% Confidence</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4 border-t border-dashed border-muted-foreground" />
            <span>Average</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
