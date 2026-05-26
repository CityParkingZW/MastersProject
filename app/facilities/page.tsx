'use client'

import { useState, useEffect } from 'react'
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Building2, Plus, Pencil, Trash2, Loader2, Search, MapPin, Factory } from 'lucide-react'
import type { Facility } from '@/lib/types'

export default function FacilitiesPage() {
  const { appUser } = useAuth()
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Facility | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchFacilities = async () => {
    setLoading(true)
    const snap = await getDocs(collection(db, 'facilities'))
    setFacilities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Facility))
    setLoading(false)
  }

  useEffect(() => { fetchFacilities() }, [])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deleteDoc(doc(db, 'facilities', deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
    await fetchFacilities()
  }

  const filtered = facilities.filter(f =>
    f.facility_name.toLowerCase().includes(search.toLowerCase()) ||
    f.province.toLowerCase().includes(search.toLowerCase()) ||
    f.zcma_registry_id.toLowerCase().includes(search.toLowerCase())
  )

  const canEdit = appUser?.role === 'admin' || appUser?.role === 'operator'

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> Facilities
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage facility profiles and MRV compliance information
            </p>
          </div>
          {canEdit && (
            <Link href="/facilities/new">
              <Button><Plus className="mr-2 h-4 w-4" /> Add Facility</Button>
            </Link>
          )}
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, province, ZCMA ID…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {search ? 'No facilities match your search.' : 'No facilities yet.'}
              </p>
              {canEdit && !search && (
                <Link href="/facilities/new" className="mt-4">
                  <Button variant="outline"><Plus className="mr-2 h-4 w-4" /> Add your first facility</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(f => (
              <Card key={f.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{f.facility_name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">{f.legal_entity_name}</CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={f.operational_status === 'Operational'
                        ? 'bg-accent/10 text-accent border-accent/30 shrink-0 text-xs'
                        : 'bg-muted text-muted-foreground shrink-0 text-xs'}
                    >
                      {f.operational_status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{f.city_town}, {f.province}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Factory className="h-3.5 w-3.5 shrink-0" />
                    <span>{f.industry_sector_label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-md bg-secondary px-3 py-2">
                      <p className="text-xs text-muted-foreground">ZCMA ID</p>
                      <p className="font-mono text-xs font-medium">{f.zcma_registry_id || '—'}</p>
                    </div>
                    <div className="rounded-md bg-secondary px-3 py-2">
                      <p className="text-xs text-muted-foreground">Base Year</p>
                      <p className="font-mono text-xs font-medium">{f.base_year}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    {f.iso_14064_certified && (
                      <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">ISO 14064</Badge>
                    )}
                    {f.zcma_compliant && (
                      <Badge variant="outline" className="text-xs bg-accent/10 text-accent border-accent/30">ZCMA ✓</Badge>
                    )}
                  </div>
                </CardContent>
                <div className="px-6 pb-4 flex gap-2 border-t border-border pt-4">
                  <Link href={`/facilities/${f.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">View Details</Button>
                  </Link>
                  {canEdit && (
                    <>
                      <Link href={`/facilities/${f.id}/edit`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {appUser?.role === 'admin' && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(f)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Facility</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.facility_name}</strong>?
            All associated data will be removed. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
