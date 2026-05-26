'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { FacilityForm } from '@/components/facilities/facility-form'
import { Loader2, Building2 } from 'lucide-react'
import type { Facility } from '@/lib/types'

export default function EditFacilityPage() {
  const { id } = useParams<{ id: string }>()
  const [facility, setFacility] = useState<Facility | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDoc(doc(db, 'facilities', id)).then(snap => {
      if (snap.exists()) setFacility({ id: snap.id, ...snap.data() } as Facility)
      setLoading(false)
    })
  }, [id])

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            {loading ? 'Loading…' : `Edit — ${facility?.facility_name}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Update facility profile and MRV compliance details</p>
        </div>
        {loading
          ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          : facility
            ? <FacilityForm facility={facility} />
            : <p className="text-muted-foreground">Facility not found.</p>
        }
      </div>
    </AppShell>
  )
}
