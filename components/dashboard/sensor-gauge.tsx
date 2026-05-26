'use client'

import { cn } from '@/lib/utils'

interface SensorGaugeProps {
  label: string
  value: number
  min: number
  max: number
  unit: string
  warningThreshold?: number
  criticalThreshold?: number
  className?: string
}

export function SensorGauge({
  label,
  value,
  min,
  max,
  unit,
  warningThreshold,
  criticalThreshold,
  className,
}: SensorGaugeProps) {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  
  const getStatus = () => {
    if (criticalThreshold && value >= criticalThreshold) return 'critical'
    if (warningThreshold && value >= warningThreshold) return 'warning'
    return 'normal'
  }
  
  const status = getStatus()
  
  const statusColors = {
    normal: {
      bar: 'bg-primary',
      text: 'text-primary',
      glow: 'shadow-primary/30',
    },
    warning: {
      bar: 'bg-warning',
      text: 'text-warning',
      glow: 'shadow-warning/30',
    },
    critical: {
      bar: 'bg-destructive',
      text: 'text-destructive',
      glow: 'shadow-destructive/30',
    },
  }

  // Calculate warning and critical positions on the gauge
  const warningPosition = warningThreshold 
    ? ((warningThreshold - min) / (max - min)) * 100 
    : null
  const criticalPosition = criticalThreshold 
    ? ((criticalThreshold - min) / (max - min)) * 100 
    : null

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className={cn('text-2xl font-mono font-bold', statusColors[status].text)}>
            {value.toFixed(1)}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
      </div>
      
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
        {/* Warning zone indicator */}
        {warningPosition && (
          <div 
            className="absolute top-0 h-full bg-warning/20"
            style={{ 
              left: `${warningPosition}%`, 
              width: `${(criticalPosition || 100) - warningPosition}%` 
            }}
          />
        )}
        {/* Critical zone indicator */}
        {criticalPosition && (
          <div 
            className="absolute top-0 h-full bg-destructive/20"
            style={{ left: `${criticalPosition}%`, right: 0 }}
          />
        )}
        {/* Value bar */}
        <div
          className={cn(
            'absolute left-0 top-0 h-full rounded-full transition-all duration-500',
            statusColors[status].bar,
            status !== 'normal' && 'shadow-lg',
            status !== 'normal' && statusColors[status].glow
          )}
          style={{ width: `${percentage}%` }}
        />
        {/* Threshold markers */}
        {warningPosition && (
          <div 
            className="absolute top-0 h-full w-0.5 bg-warning"
            style={{ left: `${warningPosition}%` }}
          />
        )}
        {criticalPosition && (
          <div 
            className="absolute top-0 h-full w-0.5 bg-destructive"
            style={{ left: `${criticalPosition}%` }}
          />
        )}
      </div>
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
