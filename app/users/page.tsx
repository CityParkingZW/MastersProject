'use client'

import { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { db, auth } from '@/lib/firebase'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'
import { UserPlus, Pencil, Trash2, Loader2, Users, AlertCircle, ShieldCheck } from 'lucide-react'
import type { AppUser, UserRole } from '@/lib/types'
import { cn } from '@/lib/utils'

const ROLE_LABELS: Record<UserRole, string> = {
  admin:    'Admin',
  operator: 'Operator',
  viewer:   'Viewer',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:    'bg-primary/20 text-primary border-primary/30',
  operator: 'bg-warning/20 text-warning border-warning/30',
  viewer:   'bg-muted text-muted-foreground',
}

const emptyForm = { displayName: '', email: '', password: '', role: 'viewer' as UserRole }

export default function UsersPage() {
  const { appUser } = useAuth()
  const [users,       setUsers]       = useState<AppUser[]>([])
  const [loading,     setLoading]     = useState(true)
  const [dialogOpen,  setDialogOpen]  = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null)
  const [editTarget,  setEditTarget]  = useState<AppUser | null>(null)
  const [form,        setForm]        = useState(emptyForm)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const fetchUsers = async () => {
    setLoading(true)
    const snap = await getDocs(collection(db, 'users'))
    setUsers(snap.docs.map(d => d.data() as AppUser))
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const openCreate = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setError('')
    setDialogOpen(true)
  }

  const openEdit = (user: AppUser) => {
    setEditTarget(user)
    setForm({ displayName: user.displayName, email: user.email, password: '', role: user.role })
    setError('')
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.displayName.trim() || !form.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!editTarget && !form.password) {
      setError('Password is required for new users.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editTarget) {
        await updateDoc(doc(db, 'users', editTarget.uid), {
          displayName: form.displayName,
          role:        form.role,
          updatedAt:   new Date().toISOString(),
        })
      } else {
        const cred    = await createUserWithEmailAndPassword(auth, form.email, form.password)
        const newUser: AppUser = {
          uid:         cred.user.uid,
          email:       form.email,
          displayName: form.displayName,
          role:        form.role,
          facilityIds: [],
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
          active:      true,
        }
        await setDoc(doc(db, 'users', cred.user.uid), newUser)
      }
      setDialogOpen(false)
      await fetchUsers()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'An error occurred'
      setError(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)\.?/, ''))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'users', deleteTarget.uid))
      setDeleteTarget(null)
      await fetchUsers()
    } finally {
      setSaving(false)
    }
  }

  if (appUser?.role !== 'admin') {
    return (
      <AppShell>
        <div className="p-6 flex items-center gap-3 text-muted-foreground">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          <p className="text-sm">You don&apos;t have permission to view this page.</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              User Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create and manage platform users and their roles
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <UserPlus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </div>

        {/* Users card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Users ({users.length})</CardTitle>
            <CardDescription>All registered platform users</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground px-6">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">No users yet</p>
                <p className="text-xs mt-1">Add a user to get started.</p>
              </div>
            ) : (
              <>
                {/* Desktop table — hidden on small screens */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left font-semibold py-3 px-4">Name</th>
                        <th className="text-left font-semibold py-3 px-4">Email</th>
                        <th className="text-left font-semibold py-3 px-4">Role</th>
                        <th className="text-left font-semibold py-3 px-4">Status</th>
                        <th className="text-left font-semibold py-3 px-4">Created</th>
                        <th className="text-right font-semibold py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {users.map(u => (
                        <tr key={u.uid} className="hover:bg-secondary/30 transition-colors">
                          <td className="py-3 px-4 font-medium">{u.displayName}</td>
                          <td className="py-3 px-4 text-muted-foreground">{u.email}</td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className={ROLE_COLORS[u.role]}>
                              {ROLE_LABELS[u.role]}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className={u.active
                              ? 'bg-accent/10 text-accent border-accent/30'
                              : 'bg-muted text-muted-foreground'}>
                              {u.active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-xs">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget(u)}
                                disabled={u.uid === appUser?.uid}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card list — hidden on sm+ */}
                <div className="sm:hidden divide-y divide-border">
                  {users.map(u => (
                    <div key={u.uid} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="space-y-1.5 min-w-0">
                        <p className="font-medium text-sm truncate">{u.displayName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={cn('text-xs', ROLE_COLORS[u.role])}>
                            {ROLE_LABELS[u.role]}
                          </Badge>
                          <Badge variant="outline" className={cn('text-xs', u.active
                            ? 'bg-accent/10 text-accent border-accent/30'
                            : 'bg-muted text-muted-foreground')}>
                            {u.active ? 'Active' : 'Inactive'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(u)}
                          disabled={u.uid === appUser?.uid}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit User' : 'Add New User'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && (
              <Alert variant="destructive" className="flex items-center gap-2 py-2 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                placeholder="John Doe"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="john@company.co.zw"
                value={form.email}
                disabled={!!editTarget}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            {!editTarget && (
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="Min. 6 characters"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v as UserRole }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                  <SelectItem value="operator">Operator — can input data</SelectItem>
                  <SelectItem value="viewer">Viewer — read only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editTarget ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.displayName}</strong>?
            This cannot be undone.
          </p>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
