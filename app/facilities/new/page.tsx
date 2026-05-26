'use client'

import { AppShell } from '@/components/layout/app-shell'
import { FacilityForm } from '@/components/facilities/facility-form'
import { Building2 } from 'lucide-react'

export default function NewFacilityPage() {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> New Facility
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register a new facility with full MRV compliance information
          </p>
        </div>
        <FacilityForm />
      </div>
    </AppShell>
  )
}
