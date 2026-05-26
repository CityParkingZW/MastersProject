'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: string | number
  unit: string
  trend?: 'up' | 'down' | 'stable'
  trendValue?: string
  icon?: React.ReactNode
  status?: 'normal' | 'warning' | 'critical'
  className?: string
}

export function MetricCard({
  title,
  value,
  unit,
  trend,
  trendValue,
  icon,
  status = 'normal',
  className,
}: MetricCardProps) {
  const statusColors = {
    normal: 'border-border',
    warning: 'border-warning/50 bg-warning/5',
    critical: 'border-destructive/50 bg-destructive/5',
  }

  const trendIcons = {
    up: <TrendingUp className="h-4 w-4" />,
    down: <TrendingDown className="h-4 w-4" />,
    stable: <Minus className="h-4 w-4" />,
  }

  const trendColors = {
    up: 'text-destructive',
    down: 'text-accent',
    stable: 'text-muted-foreground',
  }

  return (
    <Card className={cn('relative overflow-hidden', statusColors[status], className)}>
      {status === 'critical' && (
        <div className="absolute top-0 right-0 h-2 w-2 m-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </div>
      )}
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold font-mono tracking-tight">
            {typeof value === 'number' ? value.toFixed(1) : value}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        {trend && trendValue && (
          <div className={cn('mt-2 flex items-center gap-1 text-sm', trendColors[trend])}>
            {trendIcons[trend]}
            <span>{trendValue}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
