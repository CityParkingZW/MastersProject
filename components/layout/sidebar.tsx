'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Leaf, FileText, Scale, TrendingUp,
  LogOut, ChevronRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface SidebarProps {
  onClose?: () => void
}

const navItems = [
  { href: '/',                  label: 'Dashboard',         icon: LayoutDashboard, roles: ['admin', 'operator', 'viewer'] },
  { href: '/forecast',          label: 'Forecast Report',   icon: TrendingUp,      roles: ['admin', 'operator', 'viewer'] },
  { href: '/carbon-accounting', label: 'Carbon Accounting', icon: Scale,           roles: ['admin', 'operator', 'viewer'] },
  { href: '/reports',           label: 'MRV Reports',       icon: FileText,        roles: ['admin', 'operator', 'viewer'] },
  { href: '/users',             label: 'Users',             icon: Users,           roles: ['admin'] },
] as const

const roleBadgeVariant: Record<string, string> = {
  admin:    'bg-primary/20 text-primary border-primary/30',
  operator: 'bg-warning/20 text-warning border-warning/30',
  viewer:   'bg-muted text-muted-foreground border-border',
}

export function Sidebar({ onClose }: SidebarProps = {}) {
  const pathname = usePathname()
  const { appUser, signOut } = useAuth()

  const visibleItems = navItems.filter(item =>
    appUser ? item.roles.includes(appUser.role as never) : false
  )

  return (
    <aside className="flex flex-col w-64 h-full min-h-screen border-r border-border bg-card">

      {/* Brand + optional mobile close button */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
          <Leaf className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-none truncate">Kgotso ClimateHealth</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">Air Quality Monitor</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground shrink-0"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link key={href} href={href} onClick={onClose}>
              <span className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
                {active && <ChevronRight className="ml-auto h-3 w-3 shrink-0" />}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-border space-y-2 shrink-0">
        <div className="px-3 py-2.5 rounded-md bg-secondary space-y-1">
          <p className="text-sm font-medium truncate">{appUser?.displayName || appUser?.email}</p>
          <p className="text-xs text-muted-foreground truncate">{appUser?.email}</p>
          {appUser?.role && (
            <Badge variant="outline" className={cn('text-xs capitalize mt-1', roleBadgeVariant[appUser.role])}>
              {appUser.role}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={signOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
