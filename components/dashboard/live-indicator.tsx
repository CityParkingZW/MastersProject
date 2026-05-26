'use client'

import { cn } from '@/lib/utils'

interface LiveIndicatorProps {
  status: 'connected' | 'disconnected' | 'connecting'
  lastUpdate?: string
  className?: string
}

export function LiveIndicator({ status, lastUpdate, className }: LiveIndicatorProps) {
  const statusConfig = {
    connected: {
      color: 'bg-accent',
      text: 'Live',
      ping: true,
    },
    disconnected: {
      color: 'bg-destructive',
      text: 'Disconnected',
      ping: false,
    },
    connecting: {
      color: 'bg-warning',
      text: 'Connecting...',
      ping: true,
    },
  }

  const config = statusConfig[status]

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex items-center gap-2">
        <div className="relative">
          {config.ping && (
            <span
              className={cn(
                'absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-75',
                config.color
              )}
            />
          )}
          <span className={cn('relative inline-flex h-3 w-3 rounded-full', config.color)} />
        </div>
        <span className="text-sm font-medium">{config.text}</span>
      </div>
      {lastUpdate && status === 'connected' && (
        <span className="hidden sm:inline text-xs text-muted-foreground">
          Updated {new Date(lastUpdate).toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}
