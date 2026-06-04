'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Sidebar } from './sidebar'
import { Loader2, Menu, Leaf } from 'lucide-react'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading && !firebaseUser) router.replace('/login')
  }, [firebaseUser, loading, router])

  // Close sidebar whenever route changes (navigation happened)
  useEffect(() => {
    setSidebarOpen(false)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!firebaseUser) return null

  return (
    <div className="flex min-h-screen bg-background">

      {/* ── Desktop sidebar — permanent, hidden below lg ── */}
      <div className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col sticky top-0 h-screen">
        <Sidebar />
      </div>

      {/* ── Mobile: dim backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile: slide-in drawer ── */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-50 w-64 lg:hidden',
          'transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* ── Content column ── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-border bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-primary/10">
              <Leaf className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold text-sm">Kgotso ClimateHealth</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
