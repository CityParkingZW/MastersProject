'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { doc, setDoc, updateDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Loader2, AlertCircle, Save } from 'lucide-react'
import {
  ZIMBABWE_PROVINCES, INDUSTRY_SECTORS, OPERATIONAL_STATUSES,
  VERIFICATION_BODIES, PRIMARY_FUEL_TYPES,
  type Facility, type ZimbabweProvince,
} from '@/lib/types'

const PROVINCE_OPTIONS: ComboboxOption[] = ZIMBABWE_PROVINCES.map(p => ({ value: p, label: p }))
const SECTOR_OPTIONS: ComboboxOption[]   = INDUSTRY_SECTORS.map(s => ({
  value: s.code, label: `${s.code} — ${s.label}`, keywords: s.code,
}))
const STATUS_OPTIONS: ComboboxOption[]   = OPERATIONAL_STATUSES.map(s => ({ value: s, label: s }))
const FUEL_OPTIONS: ComboboxOption[]     = PRIMARY_FUEL_TYPES.map(f => ({ value: f, label: f }))
const BODY_OPTIONS: ComboboxOption[]     = VERIFICATION_BODIES.map(b => ({ value: b, label: b }))

type FormData = Omit<Facility, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'emission_sources'>

const defaults: FormData = {
  facility_name: '',
  legal_entity_name: '',
  trading_name: '',
  zcma_registry_id: '',
  cipa_reg_number: '',
  zimra_bp_number: '',
  province: 'Harare',
  district: '',
  city_town: '',
  physical_address: '',
  postal_address: '',
  gps_latitude: undefined,
  gps_longitude: undefined,
  land_area_hectares: undefined,
  industry_sector_code: '',
  industry_sector_label: '',
  sub_sector: '',
  operational_status: 'Operational',
  operation_start_date: '',
  reporting_year: new Date().getFullYear(),
  base_year: new Date().getFullYear() - 1,
  number_of_employees: undefined,
  installed_capacity: undefined,
  capacity_unit: '',
  annual_production: undefined,
  production_unit: '',
  primary_fuel_type: 'Electricity Only',
  secondary_fuel_type: '',
  scope1_applicable: true,
  scope2_applicable: true,
  scope3_applicable: false,
  monthly_emission_target_kg: 150000,
  facility_manager: { name: '', email: '', phone: '', title: 'Facility Manager' },
  environmental_officer: { name: '', email: '', phone: '', title: 'Environmental Officer' },
  verification_body: undefined,
  last_verification_date: '',
  next_verification_date: '',
  iso_14064_certified: false,
  zcma_compliant: false,
  active: true,
}

interface Props {
  facility?: Facility
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}{required && <span className="text-destructive ml-1">*</span>}</Label>
      {children}
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="pt-2">
      <p className="text-sm font-semibold text-primary uppercase tracking-wide">{title}</p>
      <Separator className="mt-2" />
    </div>
  )
}

export function FacilityForm({ facility }: Props) {
  const router = useRouter()
  const { appUser } = useAuth()
  const [form, setForm] = useState<FormData>(facility ? { ...defaults, ...facility } : defaults)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof FormData, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }))

  const setContact = (who: 'facility_manager' | 'environmental_officer', field: string, value: string) =>
    setForm(f => ({ ...f, [who]: { ...f[who], [field]: value } }))

  const handleSector = (code: string) => {
    const sector = INDUSTRY_SECTORS.find(s => s.code === code)
    setForm(f => ({ ...f, industry_sector_code: code, industry_sector_label: sector?.label ?? '' }))
  }

  const handleSave = async () => {
    if (!form.facility_name.trim() || !form.legal_entity_name.trim() || !form.province || !form.physical_address.trim()) {
      setError('Facility name, legal entity, province and address are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      if (facility) {
        await updateDoc(doc(db, 'facilities', facility.id), {
          ...form,
          emission_sources: facility.emission_sources ?? [],
          updatedAt: now,
        })
      } else {
        const ref = doc(collection(db, 'facilities'))
        await setDoc(ref, {
          ...form,
          id: ref.id,
          emission_sources: [],
          createdAt: now,
          updatedAt: now,
          createdBy: appUser?.uid ?? '',
        })
      }
      router.push('/facilities')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save facility.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl w-full">
      {error && (
        <Alert variant="destructive" className="flex items-center gap-2 py-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </Alert>
      )}

      {/* ── Identification ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Identification</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Facility Name" required>
            <Input value={form.facility_name} onChange={e => set('facility_name', e.target.value)} placeholder="Harare Industrial Plant A" />
          </Field>
          <Field label="Legal Entity Name" required>
            <Input value={form.legal_entity_name} onChange={e => set('legal_entity_name', e.target.value)} placeholder="Acme Zimbabwe (Pvt) Ltd" />
          </Field>
          <Field label="Trading Name">
            <Input value={form.trading_name ?? ''} onChange={e => set('trading_name', e.target.value)} placeholder="Acme Zim" />
          </Field>
          <Field label="ZCMA Registry ID">
            <Input value={form.zcma_registry_id} onChange={e => set('zcma_registry_id', e.target.value)} placeholder="ZCMA-2026-001" />
          </Field>
          <Field label="CIPA Registration Number">
            <Input value={form.cipa_reg_number} onChange={e => set('cipa_reg_number', e.target.value)} placeholder="1234/2020" />
          </Field>
          <Field label="ZIMRA BP Number">
            <Input value={form.zimra_bp_number ?? ''} onChange={e => set('zimra_bp_number', e.target.value)} placeholder="2000123456" />
          </Field>
        </CardContent>
      </Card>

      {/* ── Location ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Location (Zimbabwe)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Province" required>
            <Combobox
              options={PROVINCE_OPTIONS}
              value={form.province}
              onValueChange={v => set('province', v as ZimbabweProvince)}
              placeholder="Select province…"
              searchPlaceholder="Search provinces…"
            />
          </Field>
          <Field label="District">
            <Input value={form.district} onChange={e => set('district', e.target.value)} placeholder="e.g. Harare South" />
          </Field>
          <Field label="City / Town">
            <Input value={form.city_town} onChange={e => set('city_town', e.target.value)} placeholder="Harare" />
          </Field>
          <Field label="Physical Address" required>
            <Input value={form.physical_address} onChange={e => set('physical_address', e.target.value)} placeholder="15 Industrial Road, Southerton" />
          </Field>
          <Field label="Postal Address">
            <Input value={form.postal_address ?? ''} onChange={e => set('postal_address', e.target.value)} placeholder="P.O. Box 1234, Harare" />
          </Field>
          <Field label="Land Area (hectares)">
            <Input type="number" value={form.land_area_hectares ?? ''} onChange={e => set('land_area_hectares', parseFloat(e.target.value))} placeholder="5.2" />
          </Field>
          <Field label="GPS Latitude">
            <Input type="number" value={form.gps_latitude ?? ''} onChange={e => set('gps_latitude', parseFloat(e.target.value))} placeholder="-17.8292" />
          </Field>
          <Field label="GPS Longitude">
            <Input type="number" value={form.gps_longitude ?? ''} onChange={e => set('gps_longitude', parseFloat(e.target.value))} placeholder="31.0522" />
          </Field>
        </CardContent>
      </Card>

      {/* ── Operations ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Operations</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Industry Sector (ISIC Rev.4)">
            <Combobox
              options={SECTOR_OPTIONS}
              value={form.industry_sector_code}
              onValueChange={handleSector}
              placeholder="Select sector…"
              searchPlaceholder="Search by code or name…"
            />
          </Field>
          <Field label="Sub-sector">
            <Input value={form.sub_sector ?? ''} onChange={e => set('sub_sector', e.target.value)} placeholder="e.g. Iron & Steel Rolling" />
          </Field>
          <Field label="Operational Status">
            <Combobox
              options={STATUS_OPTIONS}
              value={form.operational_status}
              onValueChange={v => set('operational_status', v)}
              placeholder="Select status…"
              searchPlaceholder="Search status…"
            />
          </Field>
          <Field label="Operation Start Date">
            <Input type="date" value={form.operation_start_date} onChange={e => set('operation_start_date', e.target.value)} />
          </Field>
          <Field label="Reporting Year">
            <Input type="number" value={form.reporting_year} onChange={e => set('reporting_year', parseInt(e.target.value))} />
          </Field>
          <Field label="GHG Base Year">
            <Input type="number" value={form.base_year} onChange={e => set('base_year', parseInt(e.target.value))} />
          </Field>
          <Field label="Number of Employees">
            <Input type="number" value={form.number_of_employees ?? ''} onChange={e => set('number_of_employees', parseInt(e.target.value))} />
          </Field>
        </CardContent>
      </Card>

      {/* ── Production Capacity ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Production Capacity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Installed Capacity">
            <Input type="number" value={form.installed_capacity ?? ''} onChange={e => set('installed_capacity', parseFloat(e.target.value))} />
          </Field>
          <Field label="Capacity Unit">
            <Input value={form.capacity_unit ?? ''} onChange={e => set('capacity_unit', e.target.value)} placeholder="e.g. tonnes/year, MW, m³/day" />
          </Field>
          <Field label="Annual Production">
            <Input type="number" value={form.annual_production ?? ''} onChange={e => set('annual_production', parseFloat(e.target.value))} />
          </Field>
          <Field label="Production Unit">
            <Input value={form.production_unit ?? ''} onChange={e => set('production_unit', e.target.value)} placeholder="e.g. tonnes, kWh, units" />
          </Field>
        </CardContent>
      </Card>

      {/* ── Emission Profile ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Emission Profile (GHG Protocol)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Primary Fuel Type">
              <Combobox
                options={FUEL_OPTIONS}
                value={form.primary_fuel_type}
                onValueChange={v => set('primary_fuel_type', v)}
                placeholder="Select fuel type…"
                searchPlaceholder="Search fuel types…"
              />
            </Field>
            <Field label="Secondary Fuel Type">
              <Input value={form.secondary_fuel_type ?? ''} onChange={e => set('secondary_fuel_type', e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Monthly Emission Target (kg CO2e)">
              <Input type="number" value={form.monthly_emission_target_kg} onChange={e => set('monthly_emission_target_kg', parseFloat(e.target.value))} />
            </Field>
          </div>
          <SectionTitle title="Applicable Scopes" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(['scope1_applicable', 'scope2_applicable', 'scope3_applicable'] as const).map((s) => (
              <div key={s} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{s === 'scope1_applicable' ? 'Scope 1' : s === 'scope2_applicable' ? 'Scope 2' : 'Scope 3'}</p>
                  <p className="text-xs text-muted-foreground">{s === 'scope1_applicable' ? 'Direct emissions' : s === 'scope2_applicable' ? 'Purchased energy' : 'Value chain'}</p>
                </div>
                <Switch checked={form[s]} onCheckedChange={v => set(s, v)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Contacts ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Contacts</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {(['facility_manager', 'environmental_officer'] as const).map(who => (
            <div key={who}>
              <SectionTitle title={who === 'facility_manager' ? 'Facility Manager' : 'Environmental Officer'} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <Field label="Full Name">
                  <Input value={form[who].name} onChange={e => setContact(who, 'name', e.target.value)} />
                </Field>
                <Field label="Title / Position">
                  <Input value={form[who].title} onChange={e => setContact(who, 'title', e.target.value)} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form[who].email} onChange={e => setContact(who, 'email', e.target.value)} />
                </Field>
                <Field label="Phone">
                  <Input value={form[who].phone} onChange={e => setContact(who, 'phone', e.target.value)} placeholder="+263 7X XXX XXXX" />
                </Field>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Verification ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Verification & Compliance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Verification Body">
            <Combobox
              options={BODY_OPTIONS}
              value={form.verification_body ?? ''}
              onValueChange={v => set('verification_body', v)}
              placeholder="Select verification body…"
              searchPlaceholder="Search verification bodies…"
            />
          </Field>
          <Field label="Last Verification Date">
            <Input type="date" value={form.last_verification_date ?? ''} onChange={e => set('last_verification_date', e.target.value)} />
          </Field>
          <Field label="Next Verification Date">
            <Input type="date" value={form.next_verification_date ?? ''} onChange={e => set('next_verification_date', e.target.value)} />
          </Field>
          <div className="md:col-span-2 grid grid-cols-2 gap-4">
            {(['iso_14064_certified', 'zcma_compliant'] as const).map(f => (
              <div key={f} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{f === 'iso_14064_certified' ? 'ISO 14064 Certified' : 'ZCMA Compliant'}</p>
                  <p className="text-xs text-muted-foreground">{f === 'iso_14064_certified' ? 'GHG quantification standard' : 'Zimbabwe carbon registry'}</p>
                </div>
                <Switch checked={form[f]} onCheckedChange={v => set(f, v)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {facility ? 'Save Changes' : 'Create Facility'}
        </Button>
        <Button variant="outline" onClick={() => router.back()} className="w-full sm:w-auto">Cancel</Button>
      </div>
    </div>
  )
}
