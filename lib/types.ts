// ─── Auth & User Types ──────────────────────────────────────────────────────

export type UserRole = 'admin' | 'operator' | 'viewer'

export interface AppUser {
  uid: string
  email: string
  displayName: string
  role: UserRole
  facilityIds: string[]   // facility IDs this user can access; ['*'] = all (admin)
  createdAt: string
  updatedAt: string
  active: boolean
}

// ─── Zimbabwe Reference Data ─────────────────────────────────────────────────

export const ZIMBABWE_PROVINCES = [
  'Harare',
  'Bulawayo',
  'Manicaland',
  'Mashonaland Central',
  'Mashonaland East',
  'Mashonaland West',
  'Masvingo',
  'Matabeleland North',
  'Matabeleland South',
  'Midlands',
] as const

export type ZimbabweProvince = typeof ZIMBABWE_PROVINCES[number]

export const INDUSTRY_SECTORS = [
  { code: 'B05', label: 'Coal Mining' },
  { code: 'B06', label: 'Crude Petroleum & Natural Gas' },
  { code: 'B07', label: 'Metal Ore Mining' },
  { code: 'C10', label: 'Food Products Manufacturing' },
  { code: 'C13', label: 'Textiles Manufacturing' },
  { code: 'C17', label: 'Paper & Pulp Manufacturing' },
  { code: 'C19', label: 'Coke & Refined Petroleum Products' },
  { code: 'C20', label: 'Chemical & Chemical Products' },
  { code: 'C24', label: 'Basic Metals (Steel/Aluminium)' },
  { code: 'C25', label: 'Fabricated Metal Products' },
  { code: 'C26', label: 'Electronics & Equipment' },
  { code: 'D35', label: 'Electricity, Gas & Steam Supply' },
  { code: 'E36', label: 'Water Collection & Supply' },
  { code: 'F41', label: 'Construction of Buildings' },
  { code: 'G46', label: 'Wholesale Trade' },
  { code: 'H49', label: 'Land Transport' },
  { code: 'I55', label: 'Accommodation & Food Services' },
] as const

export const OPERATIONAL_STATUSES = [
  'Operational',
  'Temporarily Shutdown',
  'Under Maintenance',
  'Decommissioned',
  'Under Construction',
] as const

export const VERIFICATION_BODIES = [
  'Bureau Veritas',
  'SGS',
  'TÜV Rheinland',
  "Lloyd's Register",
  'DNV',
  'KPMG Climate Change',
  'Deloitte Sustainability',
  'EY Climate Change',
  'Zimbabwe Environmental Management Agency (EMA)',
  'Other',
] as const

export const PRIMARY_FUEL_TYPES = [
  'Coal',
  'Diesel',
  'Petrol',
  'Natural Gas',
  'LPG',
  'Heavy Fuel Oil',
  'Biomass / Wood',
  'Electricity Only',
  'None',
] as const

// ─── Shared Primitives ───────────────────────────────────────────────────────

export type GHGScope = 1 | 2 | 3
export type TrendDirection = 'up' | 'down' | 'stable'

// ─── Facility Types (MRV Standard) ───────────────────────────────────────────

export interface FacilityContact {
  name: string
  email: string
  phone: string
  title: string
}

export interface EmissionSource {
  source_type:
    | 'stationary_combustion'
    | 'process_emissions'
    | 'fugitive_emissions'
    | 'purchased_electricity'
    | 'mobile_combustion'
    | 'waste'
  description: string
  fuel_type?: string
  scope: GHGScope
  applicable: boolean
}

export interface Facility {
  // ── Identification ───────────────────────────────
  id: string                          // Firestore document ID (e.g. 'fac-hps')
  facility_name: string
  legal_entity_name: string
  trading_name?: string
  zcma_registry_id: string            // Zimbabwe Carbon Market Authority ID
  cipa_reg_number: string             // Companies & Intellectual Property Auth
  zimra_bp_number?: string            // Zimbabwe Revenue Authority BP number

  // ── Location ─────────────────────────────────────
  province: ZimbabweProvince
  district: string
  city_town: string
  physical_address: string
  postal_address?: string
  gps_latitude?: number
  gps_longitude?: number
  land_area_hectares?: number

  // ── Operations ───────────────────────────────────
  industry_sector_code: string
  industry_sector_label: string
  sub_sector?: string
  operational_status: typeof OPERATIONAL_STATUSES[number]
  operation_start_date: string        // ISO date
  reporting_year: number
  base_year: number                   // GHG baseline year (GHG Protocol)
  number_of_employees?: number

  // ── Production Capacity ──────────────────────────
  installed_capacity?: number
  capacity_unit?: string
  annual_production?: number
  production_unit?: string

  // ── Emission Profile ─────────────────────────────
  primary_fuel_type: typeof PRIMARY_FUEL_TYPES[number]
  secondary_fuel_type?: string
  emission_sources: EmissionSource[]
  scope1_applicable: boolean
  scope2_applicable: boolean
  scope3_applicable: boolean
  monthly_emission_target_kg: number

  // ── Contacts ─────────────────────────────────────
  facility_manager: FacilityContact
  environmental_officer: FacilityContact

  // ── Verification (ISO 14064 / GHG Protocol) ──────
  verification_body?: typeof VERIFICATION_BODIES[number]
  last_verification_date?: string
  next_verification_date?: string
  iso_14064_certified: boolean
  zcma_compliant: boolean

  // ── Meta ─────────────────────────────────────────
  createdAt: string
  updatedAt: string
  createdBy: string                   // uid of creator
  active: boolean
}

// ─── Device Types ─────────────────────────────────────────────────────────────

export interface Device {
  id: string                          // Firestore document ID = device_id (e.g. 'dev-hps-001')
  device_id: string                   // same as id, for query convenience
  facility_id: string                 // FK → facilities/{id}
  device_name: string
  location: string                    // where in the facility this device is installed
  sensors: string[]                   // ['co2', 'ch4', 'temperature', 'humidity', 'energy']
  status: 'online' | 'offline' | 'maintenance'
  firmware_version: string
  last_seen: string                   // ISO timestamp of last successful POST
  createdAt: string
  updatedAt: string
}

// ─── Sensor Data Types ───────────────────────────────────────────────────────

export interface SensorReading {
  id?: string                         // Firestore document ID (auto-generated)
  device_id: string                   // FK → devices/{id}
  facility_id: string                 // FK → facilities/{id}
  timestamp: string                   // ISO timestamp
  co2_mg_m3: number
  ch4_mg_m3: number
  temperature: number
  humidity: number
  energy_kwh: number
  air_quality_index: number
  data_source: 'esp32' | 'simulator'
}

export interface SensorStats {
  current: SensorReading
  averages: {
    co2_mg_m3: number
    ch4_mg_m3: number
    temperature: number
    humidity: number
    energy_kwh: number
  }
  trends: {
    co2_trend: TrendDirection
    ch4_trend: TrendDirection
    energy_trend: TrendDirection
  }
}

// ─── Emission Types ──────────────────────────────────────────────────────────

export interface CarbonEmission {
  timestamp: string
  facility_id: string                 // FK → facilities/{id}
  co2_direct_kg: number               // Scope 1 — direct CO2
  ch4_co2e_kg: number                 // Scope 1 — methane in CO2 equivalent
  energy_co2e_kg: number              // Scope 2 — purchased electricity
  total_co2e_kg: number
  scope: GHGScope
}

export interface DailyEmissionSummary {
  id: string                          // '{facilityId}_{YYYY-MM-DD}' — deterministic
  facility_id: string                 // FK → facilities/{id}
  date: string                        // YYYY-MM-DD
  total_co2e_kg: number
  scope1_kg: number
  scope2_kg: number
  breakdown: {
    stationary_combustion: number
    process_emissions: number
    fugitive_emissions: number
    purchased_electricity: number
  }
  avg_co2_mg_m3: number
  max_co2_mg_m3: number
  reading_count: number
  createdAt: string
  updatedAt: string
}

// ─── Prediction Types ────────────────────────────────────────────────────────

export interface Prediction {
  timestamp: string
  predicted_co2e_kg: number
  confidence_lower: number
  confidence_upper: number
  model_version: string
  factors: {
    energy_contribution: number
    ch4_contribution: number
    temperature_factor: number
  }
}

// ─── MRV Report Types ─────────────────────────────────────────────────────────

export interface MRVReport {
  report_id: string
  facility_id: string                 // FK → facilities/{id}
  reporting_period: {
    start: string
    end: string
  }

  // ── Calculated from sensor data — READ ONLY, never editable ─────────────
  total_emissions_tco2e: number
  emissions_by_scope: {
    scope1: number
    scope2: number
    scope3: number
  }
  emissions_by_source: {
    source_name: string
    emissions_tco2e: number
    methodology: string
    data_quality: 'measured' | 'calculated' | 'estimated'
  }[]

  // ── Admin-editable narrative fields ─────────────────────────────────────
  summary?: string                    // Executive summary for the reporting period
  admin_comments?: string             // Internal notes visible to admins
  methodology_notes?: string          // Clarification on calculation methods used
  data_quality_statement?: string     // Data completeness / quality assessment

  // ── Verification status (admin-editable) ────────────────────────────────
  verification_status: 'pending' | 'verified' | 'rejected'
  rejection_reason?: string           // Required when status = 'rejected'

  // ── Meta ────────────────────────────────────────────────────────────────
  generated_at: string
  generated_by?: string               // uid of user who generated
  last_edited_by?: string             // uid of last admin who edited
  last_edited_at?: string             // ISO timestamp of last edit
  zcma_compliant: boolean
}

// ─── ZCMA Carbon Projects ─────────────────────────────────────────────────────

export const ZCMA_PROJECT_TYPES = [
  { value: 'afforestation',    label: 'Afforestation' },
  { value: 'reforestation',    label: 'Reforestation' },
  { value: 'soil_carbon',      label: 'Soil Carbon' },
  { value: 'methane_capture',  label: 'Methane Capture' },
  { value: 'renewable_energy', label: 'Renewable Energy' },
  { value: 'cookstoves',       label: 'Improved Cookstoves' },
  { value: 'other',            label: 'Other' },
] as const

export type ZCMAProjectType = typeof ZCMA_PROJECT_TYPES[number]['value']

export const ZCMA_PROJECT_STATUSES = [
  { value: 'active',               label: 'Active' },
  { value: 'pending_verification', label: 'Pending Verification' },
  { value: 'verified',             label: 'Verified' },
  { value: 'suspended',            label: 'Suspended' },
  { value: 'completed',            label: 'Completed' },
] as const

export type ZCMAProjectStatus = typeof ZCMA_PROJECT_STATUSES[number]['value']

export interface ZCMAProject {
  id: string
  facility_id: string
  project_name: string
  project_type: ZCMAProjectType
  zcma_project_id?: string
  start_date: string                    // ISO date YYYY-MM-DD
  area_hectares?: number
  annual_sequestration_tco2e: number    // verified annual offset capacity
  credits_issued: number                // total VCUs issued to date
  credits_retired: number               // credits already used/retired
  status: ZCMAProjectStatus
  methodology?: string                  // e.g. VM0010, AR-ACM0003
  verifier?: string
  description?: string
  createdAt: string
  updatedAt: string
  createdBy: string
}

// ─── Dashboard & Alert Types ──────────────────────────────────────────────────

export interface DashboardState {
  isLive: boolean
  lastUpdate: string
  connectionStatus: 'connected' | 'disconnected' | 'connecting'
  selectedFacilityId: string
  timeRange: '1h' | '6h' | '24h' | '7d' | '30d'
}

export interface Alert {
  id: string
  type: 'warning' | 'critical' | 'info'
  message: string
  sensor: string
  value: number
  threshold: number
  facility_id: string                 // FK → facilities/{id}
  device_id: string                   // FK → devices/{id}
  timestamp: string
  acknowledged: boolean
}
