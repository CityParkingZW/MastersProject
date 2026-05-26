'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertCircle, AlertTriangle, Info, Check } from 'lucide-react'
import type { Alert as AlertType } from '@/lib/types'
import { cn } from '@/lib/utils'

interface AlertListProps {
  alerts: AlertType[]
  onAcknowledge?: (id: string) => void
  className?: string
}

export function AlertList({ alerts, onAcknowledge, className }: AlertListProps) {
  const alertConfig = {
    critical: {
      icon: AlertCircle,
      variant: 'destructive' as const,
      bgColor: 'bg-destructive/10 border-destructive/30',
    },
    warning: {
      icon: AlertTriangle,
      variant: 'default' as const,
      bgColor: 'bg-warning/10 border-warning/30',
    },
    info: {
      icon: Info,
      variant: 'default' as const,
      bgColor: 'bg-primary/10 border-primary/30',
    },
  }

  if (alerts.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <Check className="h-12 w-12 text-accent mb-3" />
        <p className="text-sm text-muted-foreground">No active alerts</p>
        <p className="text-xs text-muted-foreground mt-1">All systems operating normally</p>
      </div>
    )
  }

  return (
    <ScrollArea className={cn('h-[300px]', className)}>
      <div className="space-y-3 pr-4">
        {alerts.map((alert) => {
          const config = alertConfig[alert.type]
          const Icon = config.icon
          
          return (
            <Alert
              key={alert.id}
              className={cn(
                'relative',
                config.bgColor,
                alert.acknowledged && 'opacity-50'
              )}
            >
              <Icon className="h-4 w-4" />
              <AlertTitle className="flex items-center justify-between">
                <span>{alert.message}</span>
                {!alert.acknowledged && onAcknowledge && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAcknowledge(alert.id)}
                    className="h-6 px-2 text-xs"
                  >
                    Acknowledge
                  </Button>
                )}
              </AlertTitle>
              <AlertDescription className="mt-1">
                <div className="flex items-center gap-4 text-xs">
                  <span>Sensor: {alert.sensor}</span>
                  <span>
                    Value: <span className="font-mono">{alert.value.toFixed(2)}</span> (threshold: {alert.threshold})
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )
        })}
      </div>
    </ScrollArea>
  )
}
