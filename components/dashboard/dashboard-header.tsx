'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LiveIndicator } from './live-indicator'
import { Settings, RefreshCw, Bell, Sun, Moon } from 'lucide-react'

interface DashboardHeaderProps {
  facilityName: string
  connectionStatus: 'connected' | 'disconnected' | 'connecting'
  lastUpdate: string
  timeRange: string
  onTimeRangeChange: (value: string) => void
  onRefresh: () => void
  alertCount?: number
}

export function DashboardHeader({
  facilityName,
  connectionStatus,
  lastUpdate,
  timeRange,
  onTimeRangeChange,
  onRefresh,
  alertCount = 0,
}: DashboardHeaderProps) {
  const [isDark, setIsDark] = useState(true)

  const applyTheme = (dark: boolean) => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    if (dark) {
      root.style.setProperty('--background', 'oklch(0.12 0.01 260)')
      root.style.setProperty('--foreground', 'oklch(0.95 0 0)')
      root.style.setProperty('--card', 'oklch(0.16 0.01 260)')
      root.style.setProperty('--card-foreground', 'oklch(0.95 0 0)')
      root.style.setProperty('--popover', 'oklch(0.14 0.01 260)')
      root.style.setProperty('--popover-foreground', 'oklch(0.95 0 0)')
      root.style.setProperty('--primary', 'oklch(0.72 0.15 180)')
      root.style.setProperty('--primary-foreground', 'oklch(0.12 0.01 260)')
      root.style.setProperty('--secondary', 'oklch(0.22 0.01 260)')
      root.style.setProperty('--secondary-foreground', 'oklch(0.85 0 0)')
      root.style.setProperty('--muted', 'oklch(0.20 0.01 260)')
      root.style.setProperty('--muted-foreground', 'oklch(0.60 0 0)')
      root.style.setProperty('--border', 'oklch(0.28 0.01 260)')
      root.style.setProperty('--input', 'oklch(0.20 0.01 260)')
    } else {
      root.style.setProperty('--background', 'oklch(0.98 0 0)')
      root.style.setProperty('--foreground', 'oklch(0.13 0.01 260)')
      root.style.setProperty('--card', 'oklch(1 0 0)')
      root.style.setProperty('--card-foreground', 'oklch(0.13 0.01 260)')
      root.style.setProperty('--popover', 'oklch(1 0 0)')
      root.style.setProperty('--popover-foreground', 'oklch(0.13 0.01 260)')
      root.style.setProperty('--primary', 'oklch(0.55 0.15 180)')
      root.style.setProperty('--primary-foreground', 'oklch(0.98 0 0)')
      root.style.setProperty('--secondary', 'oklch(0.94 0.01 260)')
      root.style.setProperty('--secondary-foreground', 'oklch(0.20 0.01 260)')
      root.style.setProperty('--muted', 'oklch(0.94 0.005 260)')
      root.style.setProperty('--muted-foreground', 'oklch(0.45 0 0)')
      root.style.setProperty('--border', 'oklch(0.88 0.005 260)')
      root.style.setProperty('--input', 'oklch(0.92 0.005 260)')
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    const dark = stored !== 'light'
    applyTheme(dark)
    setIsDark(dark)
  }, [])

  const toggleTheme = () => {
    const next = !isDark
    applyTheme(next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setIsDark(next)
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 flex-wrap">
        {/* Left section */}
        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-semibold tracking-tight truncate">Carbon Monitor</h1>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">{facilityName}</p>
          </div>
          <LiveIndicator status={connectionStatus} lastUpdate={lastUpdate} />
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <Select value={timeRange} onValueChange={onTimeRangeChange}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last 1 hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="icon" onClick={onRefresh} className="h-8 w-8 sm:h-9 sm:w-9">
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={toggleTheme}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 relative">
            <Bell className="h-4 w-4" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </Button>

          <Button variant="ghost" size="icon" className="hidden sm:flex h-9 w-9">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
