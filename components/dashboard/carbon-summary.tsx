'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Leaf, Target, TrendingDown, AlertTriangle } from 'lucide-react'

interface CarbonSummaryProps {
  currentEmissions: number // kg CO2e
  targetEmissions: number // kg CO2e
  previousPeriodEmissions: number // kg CO2e
  period: string
  className?: string
}

export function CarbonSummary({
  currentEmissions,
  targetEmissions,
  previousPeriodEmissions,
  period,
  className,
}: CarbonSummaryProps) {
  const progressPercent = Math.min(100, (currentEmissions / targetEmissions) * 100)
  const changePercent = ((currentEmissions - previousPeriodEmissions) / previousPeriodEmissions) * 100
  const isOnTrack = currentEmissions < targetEmissions * 0.9
  const isWarning = currentEmissions >= targetEmissions * 0.9 && currentEmissions < targetEmissions
  const isOverTarget = currentEmissions >= targetEmissions

  const getStatusConfig = () => {
    if (isOnTrack) return { color: 'text-accent', bg: 'bg-accent/10', label: 'On Track', icon: Leaf }
    if (isWarning) return { color: 'text-warning', bg: 'bg-warning/10', label: 'Approaching Target', icon: AlertTriangle }
    return { color: 'text-destructive', bg: 'bg-destructive/10', label: 'Over Target', icon: AlertTriangle }
  }

  const status = getStatusConfig()
  const StatusIcon = status.icon

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Carbon Footprint
              <Badge variant="outline" className={cn('font-normal', status.bg, status.color)}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {status.label}
              </Badge>
            </CardTitle>
            <CardDescription>{period} emissions vs target</CardDescription>
          </div>
          <Target className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main metric */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-4xl font-bold font-mono tracking-tight">
              {(currentEmissions / 1000).toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">tonnes CO2e</p>
          </div>
          <div className="text-right">
            <div className={cn('flex items-center gap-1 text-sm', changePercent < 0 ? 'text-accent' : 'text-destructive')}>
              <TrendingDown className={cn('h-4 w-4', changePercent > 0 && 'rotate-180')} />
              <span>{Math.abs(changePercent).toFixed(1)}%</span>
            </div>
            <p className="text-xs text-muted-foreground">vs previous {period.toLowerCase()}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress to target</span>
            <span className={cn('font-mono', isOverTarget ? 'text-destructive' : 'text-foreground')}>
              {progressPercent.toFixed(1)}%
            </span>
          </div>
          <div className="relative">
            <Progress 
              value={progressPercent} 
              className={cn(
                'h-3',
                isOverTarget && '[&>div]:bg-destructive',
                isWarning && '[&>div]:bg-warning',
                isOnTrack && '[&>div]:bg-accent'
              )}
            />
            {/* Target marker at 100% */}
            <div 
              className="absolute top-0 h-full w-0.5 bg-foreground/50"
              style={{ left: '100%', transform: 'translateX(-50%)' }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>Target: {(targetEmissions / 1000).toFixed(1)}t</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Scope 1</p>
            <p className="font-mono text-sm">{((currentEmissions * 0.35) / 1000).toFixed(2)}t</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Scope 2</p>
            <p className="font-mono text-sm">{((currentEmissions * 0.65) / 1000).toFixed(2)}t</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Remaining</p>
            <p className={cn('font-mono text-sm', isOverTarget ? 'text-destructive' : 'text-accent')}>
              {((targetEmissions - currentEmissions) / 1000).toFixed(2)}t
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
