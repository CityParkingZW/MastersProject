/**
 * Firestore Seed Script — Zimbabwe Carbon Monitor (Multi-Province)
 *
 * Collections written:
 *   users            4 docs  (Firebase Auth + Firestore, real UIDs)
 *   facilities       5 docs  (deterministic IDs, one per province)
 *   devices          5 docs  (one ESP32 per facility, FK → facility)
 *   daily_summaries  450 docs  (90 days × 5, Dec 2025 – Feb 2026, FK → facility)
 *   sensor_readings  840 docs  (168 h × 5, Feb 22–28 2026, FK → facility + device)
 *
 * Date range:
 *   Daily summaries : 2025-12-01 → 2026-02-28  (90 days, Zimbabwe rainy season)
 *   Hourly readings : 2026-02-22 → 2026-02-28  (last 7 days of the period)
 *
 * Run:
 *   node scripts/seed.mjs
 * Requires: serviceAccountKey.json in the project root.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore }        from 'firebase-admin/firestore'
import { getAuth }             from 'firebase-admin/auth'
import { readFileSync }        from 'node:fs'
import { fileURLToPath }       from 'node:url'
import { dirname, join }       from 'node:path'

const __dirname     = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8'))

initializeApp({ credential: cert(serviceAccount) })
const db        = getFirestore()
const authAdmin = getAuth()

// ─── Date Anchors ─────────────────────────────────────────────────────────────
// All dates fixed to the Dec 2025 – Feb 2026 reporting period.

const SUMMARY_START  = new Date('2025-12-01T00:00:00.000Z')  // 90-day window starts
const READINGS_START = new Date('2026-02-22T00:00:00.000Z')  // last 7 days of period

function summaryDate(dayIndex) {
  const d = new Date(SUMMARY_START)
  d.setUTCDate(d.getUTCDate() + dayIndex)
  return d.toISOString().split('T')[0]
}

function readingTimestamp(hourIndex) {
  const d = new Date(READINGS_START)
  d.setUTCHours(d.getUTCHours() + hourIndex)
  return d.toISOString()
}

// ─── Zimbabwe Seasonal Context (Dec–Feb = Rainy Season) ───────────────────────
//
// December–February is Zimbabwe's hot wet season:
//  • Temps: 25–38 °C (industrial sites run hotter)
//  • Humidity: 65–85 %
//  • ZESA grid: Kariba hydro higher → slightly cleaner electricity (~0.58 kg CO2e/kWh)
//  • ZESA load shedding: 12–16 h/day in this period → energy drops to near zero during cuts
//  • Manicaland: elevated cyclone / storm risk Jan–Feb

const ZESA_GRID_EF_RAINY = 0.582   // kg CO2e/kWh (ZESA, wet season — more hydro)
const COAL_EF            = 0.82    // kg CO2e/kWh (GHG Protocol, bituminous coal)
const DIESEL_EF          = 0.668   // kg CO2e/kWh (GHG Protocol, diesel)
const BIOMASS_EF         = 0.015   // kg CO2e/kWh (residual biogenic, ZCMA treatment)
const CH4_GWP            = 28      // IPCC AR5 GWP-100

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rand   = (min, max) => Math.random() * (max - min) + min
const noise  = (val, pct = 0.08) => val + (Math.random() - 0.5) * 2 * pct * val
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const CO2_PPM_TO_MG = 44.01 / 24.45   // ≈ 1.8004
const CH4_PPM_TO_MG = 16.04 / 24.45   // ≈ 0.6561

const round1 = v => Number.parseFloat(v.toFixed(1))
const round2 = v => Number.parseFloat(v.toFixed(2))

// Simulate ZESA load-shedding: return 0 energy during shed windows (rough 40% chance per hour)
function loadshedEnergy(baseEnergy, hourOfDay) {
  // Peak shedding: 06-09, 12-15, 18-21
  const shedWindows = [6,7,8,12,13,14,18,19,20]
  if (shedWindows.includes(hourOfDay) && Math.random() < 0.45) return 0
  return baseEnergy
}

// Seasonal temperature at a given day index in the 90-day window
// Dec peaks ~32°C, Feb tapers to ~29°C
function seasonalTemp(dayIndex, baseTemp) {
  const peak  = baseTemp + 4        // hottest in late Dec / early Jan
  const decay = dayIndex / 90       // gradual tapering through Feb
  return peak - decay * 5 + noise(0, 0.04)
}

// ─── Facility / Device ID Scheme ──────────────────────────────────────────────
//
//  fac-zpc    → Harare         → Harare Power Station        (coal, D35)
//  fac-zisco  → Midlands       → ZISCO Steel Redcliff        (coal/coke, C24)
//  fac-nrz    → Bulawayo       → NRZ Locomotive Works        (diesel, H49)
//  fac-mbpm   → Manicaland     → Mutare Board & Paper Mills  (biomass, C17)
//  fac-cottco → Mashonaland W  → COTTCO Kadoma Cotton Gin   (electricity, C13)

const FACILITY_IDS = ['fac-zpc', 'fac-zisco', 'fac-nrz', 'fac-mbpm', 'fac-cottco']

// ─── Users ───────────────────────────────────────────────────────────────────

const userDefs = [
  {
    email:       'admin@carbonmonitor.co.zw',
    initialPwd:  'Admin@1234',
    displayName: 'Takudzwa Nhema',
    role:        'admin',
    facilityIds: ['*'],    // wildcard — access all facilities
    active:      true,
  },
  {
    email:       'operator1@carbonmonitor.co.zw',
    initialPwd:  'Operator@1234',
    displayName: 'Mavis Chigwedere',
    role:        'operator',
    facilityIds: ['fac-zpc', 'fac-zisco'],    // Harare + Midlands
    active:      true,
  },
  {
    email:       'operator2@carbonmonitor.co.zw',
    initialPwd:  'Operator@1234',
    displayName: 'Kudakwashe Banda',
    role:        'operator',
    facilityIds: ['fac-nrz', 'fac-mbpm', 'fac-cottco'],   // Byo + Manicaland + Mash W
    active:      true,
  },
  {
    email:       'viewer@carbonmonitor.co.zw',
    initialPwd:  'Viewer@1234',
    displayName: 'Prisca Svosve',
    role:        'viewer',
    facilityIds: FACILITY_IDS,    // read-only view of all
    active:      true,
  },
]

// ─── Facilities ───────────────────────────────────────────────────────────────

const facilities = [
  {
    // ── Harare: Coal-fired thermal power ────────────────────────────────────
    id:                    'fac-zpc',
    facility_name:         'Harare Thermal Power Station',
    legal_entity_name:     'Zimbabwe Power Company (Pvt) Ltd',
    trading_name:          'ZPC Harare',
    zcma_registry_id:      'ZCMA-2025-HAR-001',
    cipa_reg_number:       '1987/003421',
    zimra_bp_number:       '2000001234',
    province:              'Harare',
    district:              'Harare South',
    city_town:             'Harare',
    physical_address:      '14 Power Station Road, Southerton, Harare',
    postal_address:        'P.O. Box 2468, Harare',
    gps_latitude:          -17.8731,
    gps_longitude:         31.0147,
    land_area_hectares:    42.5,
    industry_sector_code:  'D35',
    industry_sector_label: 'Electricity, Gas & Steam Supply',
    sub_sector:            'Thermal Power Generation',
    operational_status:    'Operational',
    operation_start_date:  '1987-06-01',
    reporting_year:        2026,
    base_year:             2019,
    number_of_employees:   312,
    installed_capacity:    135,
    capacity_unit:         'MW',
    annual_production:     890000,
    production_unit:       'MWh',
    primary_fuel_type:     'Coal',
    secondary_fuel_type:   'Diesel',
    scope1_applicable:     true,
    scope2_applicable:     false,
    scope3_applicable:     true,
    monthly_emission_target_kg: 280000,
    emission_sources: [
      { source_type: 'stationary_combustion', description: 'Coal-fired boilers (Units 1–4)', fuel_type: 'Coal', scope: 1, applicable: true },
      { source_type: 'fugitive_emissions',    description: 'Coal stockpile & handling dust', scope: 1, applicable: true },
      { source_type: 'mobile_combustion',     description: 'On-site diesel fleet', fuel_type: 'Diesel', scope: 1, applicable: true },
    ],
    facility_manager:      { name: 'Tendai Moyo',     email: 'tmoyo@zpc.co.zw',      phone: '+263 77 123 4567', title: 'Station Manager' },
    environmental_officer: { name: 'Rudo Chikwanda',  email: 'rchikwanda@zpc.co.zw', phone: '+263 71 234 5678', title: 'Environmental Compliance Officer' },
    verification_body:        'Bureau Veritas',
    last_verification_date:   '2025-03-15',
    next_verification_date:   '2026-03-15',
    iso_14064_certified:      true,
    zcma_compliant:           true,
    active:                   true,
  },
  {
    // ── Midlands: Ferrochrome / steel smelting (Redcliff, near Kwekwe) ──────
    id:                    'fac-zisco',
    facility_name:         'ZISCO Steel — Redcliff Works',
    legal_entity_name:     'Zimbabwe Iron & Steel Company (Pvt) Ltd',
    trading_name:          'ZISCO',
    zcma_registry_id:      'ZCMA-2025-MID-001',
    cipa_reg_number:       '1942/000187',
    zimra_bp_number:       '2000005678',
    province:              'Midlands',
    district:              'Kwekwe',
    city_town:             'Redcliff',
    physical_address:      'New Steelworks Road, Redcliff, Kwekwe',
    postal_address:        'P.O. Box 81, Redcliff',
    gps_latitude:          -19.033,
    gps_longitude:         29.7832,
    land_area_hectares:    118.7,
    industry_sector_code:  'C24',
    industry_sector_label: 'Basic Metals (Steel/Aluminium)',
    sub_sector:            'Integrated Steel Plant — Blast Furnace & Rolling',
    operational_status:    'Operational',
    operation_start_date:  '1942-11-12',
    reporting_year:        2026,
    base_year:             2018,
    number_of_employees:   524,
    installed_capacity:    280000,
    capacity_unit:         'tonnes/year',
    annual_production:     195000,
    production_unit:       'tonnes steel',
    primary_fuel_type:     'Coal',
    secondary_fuel_type:   'Heavy Fuel Oil',
    scope1_applicable:     true,
    scope2_applicable:     true,
    scope3_applicable:     true,
    monthly_emission_target_kg: 420000,
    emission_sources: [
      { source_type: 'stationary_combustion', description: 'Blast furnace — metallurgical coke', fuel_type: 'Coal', scope: 1, applicable: true },
      { source_type: 'process_emissions',     description: 'Iron ore reduction (CO₂ off-gas)', scope: 1, applicable: true },
      { source_type: 'fugitive_emissions',    description: 'Slag pit & coal yard dust', scope: 1, applicable: true },
      { source_type: 'purchased_electricity', description: 'ZESA grid — arc furnaces & rolling', scope: 2, applicable: true },
    ],
    facility_manager:      { name: 'Farai Dzapasi',   email: 'fdzapasi@zisco.co.zw', phone: '+263 77 345 6789', title: 'Works Manager' },
    environmental_officer: { name: 'Chipo Mutasa',    email: 'cmutasa@zisco.co.zw',  phone: '+263 71 456 7890', title: 'HSE Manager' },
    verification_body:        'SGS',
    last_verification_date:   '2025-06-01',
    next_verification_date:   '2026-06-01',
    iso_14064_certified:      true,
    zcma_compliant:           true,
    active:                   true,
  },
  {
    // ── Bulawayo: Diesel locomotive maintenance ───────────────────────────────
    id:                    'fac-nrz',
    facility_name:         'NRZ Bulawayo Locomotive Works',
    legal_entity_name:     'National Railways of Zimbabwe',
    trading_name:          'NRZ',
    zcma_registry_id:      'ZCMA-2025-BYO-001',
    cipa_reg_number:       '1947/000012',
    zimra_bp_number:       '2000002345',
    province:              'Bulawayo',
    district:              'Bulawayo',
    city_town:             'Bulawayo',
    physical_address:      '1 Railway Ave, Raylton, Bulawayo',
    postal_address:        'P.O. Box 596, Bulawayo',
    gps_latitude:          -20.1503,
    gps_longitude:         28.5774,
    land_area_hectares:    34.2,
    industry_sector_code:  'H49',
    industry_sector_label: 'Land Transport',
    sub_sector:            'Railway Locomotive Overhaul & Maintenance',
    operational_status:    'Operational',
    operation_start_date:  '1947-09-12',
    reporting_year:        2026,
    base_year:             2019,
    number_of_employees:   287,
    installed_capacity:    48,
    capacity_unit:         'locomotives/year',
    annual_production:     32,
    production_unit:       'locomotives overhauled',
    primary_fuel_type:     'Diesel',
    secondary_fuel_type:   'Petrol',
    scope1_applicable:     true,
    scope2_applicable:     true,
    scope3_applicable:     false,
    monthly_emission_target_kg: 165000,
    emission_sources: [
      { source_type: 'stationary_combustion', description: 'Diesel testing & generator sets', fuel_type: 'Diesel', scope: 1, applicable: true },
      { source_type: 'mobile_combustion',     description: 'Locomotive road tests & yard shunters', fuel_type: 'Diesel', scope: 1, applicable: true },
      { source_type: 'fugitive_emissions',    description: 'Refrigerant leaks (HVAC)', scope: 1, applicable: true },
      { source_type: 'purchased_electricity', description: 'ZESA grid — workshop machinery', scope: 2, applicable: true },
    ],
    facility_manager:      { name: 'Ngoni Dube',      email: 'ndube@nrz.co.zw',      phone: '+263 29 267 8901', title: 'Works Superintendent' },
    environmental_officer: { name: 'Tariro Gumbo',    email: 'tgumbo@nrz.co.zw',     phone: '+263 71 678 9012', title: 'Environment & Safety Officer' },
    verification_body:        'Lloyd\'s Register',
    last_verification_date:   '2025-01-20',
    next_verification_date:   '2026-01-20',
    iso_14064_certified:      false,
    zcma_compliant:           true,
    active:                   true,
  },
  {
    // ── Manicaland: Biomass-powered paper & board mill (Mutare) ─────────────
    id:                    'fac-mbpm',
    facility_name:         'Mutare Board & Paper Mills',
    legal_entity_name:     'Mutare Board & Paper Mills (Pvt) Ltd',
    trading_name:          'MBPM',
    zcma_registry_id:      'ZCMA-2025-MAN-001',
    cipa_reg_number:       '1964/004512',
    zimra_bp_number:       '2000008765',
    province:              'Manicaland',
    district:              'Mutare',
    city_town:             'Mutare',
    physical_address:      'Timber Road, Paulington Industrial, Mutare',
    postal_address:        'P.O. Box 1509, Mutare',
    gps_latitude:          -18.9707,
    gps_longitude:         32.6573,
    land_area_hectares:    21.8,
    industry_sector_code:  'C17',
    industry_sector_label: 'Paper & Pulp Manufacturing',
    sub_sector:            'Corrugated Board & Kraft Paper',
    operational_status:    'Operational',
    operation_start_date:  '1964-07-15',
    reporting_year:        2026,
    base_year:             2020,
    number_of_employees:   156,
    installed_capacity:    45000,
    capacity_unit:         'tonnes/year',
    annual_production:     31000,
    production_unit:       'tonnes board/paper',
    primary_fuel_type:     'Biomass / Wood',
    secondary_fuel_type:   'Diesel',
    scope1_applicable:     true,
    scope2_applicable:     true,
    scope3_applicable:     false,
    monthly_emission_target_kg: 88000,
    emission_sources: [
      { source_type: 'stationary_combustion', description: 'Wood chip boilers — steam generation', fuel_type: 'Biomass / Wood', scope: 1, applicable: true },
      { source_type: 'process_emissions',     description: 'Pulping chemical recovery', scope: 1, applicable: true },
      { source_type: 'mobile_combustion',     description: 'Timber yard loaders & trucks', fuel_type: 'Diesel', scope: 1, applicable: true },
      { source_type: 'purchased_electricity', description: 'ZESA grid — paper machines', scope: 2, applicable: true },
    ],
    facility_manager:      { name: 'Blessed Mapfumo', email: 'bmapfumo@mbpm.co.zw', phone: '+263 20 265 4321', title: 'Mill Manager' },
    environmental_officer: { name: 'Sekai Nyoni',     email: 'snyoni@mbpm.co.zw',   phone: '+263 71 890 1234', title: 'Environmental Officer' },
    verification_body:        'TÜV Rheinland',
    last_verification_date:   '2025-04-10',
    next_verification_date:   '2026-04-10',
    iso_14064_certified:      false,
    zcma_compliant:           true,
    active:                   true,
  },
  {
    // ── Mashonaland West: Cotton ginning & processing (Kadoma) ───────────────
    id:                    'fac-cottco',
    facility_name:         'COTTCO Kadoma Cotton Gin',
    legal_entity_name:     'Cotton Company of Zimbabwe (COTTCO) Ltd',
    trading_name:          'COTTCO',
    zcma_registry_id:      'ZCMA-2025-MSW-001',
    cipa_reg_number:       '1970/006780',
    zimra_bp_number:       '2000004321',
    province:              'Mashonaland West',
    district:              'Kadoma',
    city_town:             'Kadoma',
    physical_address:      '5 Gadzema Road, Kadoma Industrial, Kadoma',
    postal_address:        'P.O. Box 2761, Kadoma',
    gps_latitude:          -18.3411,
    gps_longitude:         29.9105,
    land_area_hectares:    12.3,
    industry_sector_code:  'C13',
    industry_sector_label: 'Textiles Manufacturing',
    sub_sector:            'Cotton Ginning & Lint Processing',
    operational_status:    'Operational',
    operation_start_date:  '1970-03-22',
    reporting_year:        2026,
    base_year:             2021,
    number_of_employees:   89,
    installed_capacity:    30000,
    capacity_unit:         'tonnes seed cotton/season',
    annual_production:     18500,
    production_unit:       'tonnes lint',
    primary_fuel_type:     'Electricity Only',
    secondary_fuel_type:   'Diesel',
    scope1_applicable:     false,
    scope2_applicable:     true,
    scope3_applicable:     false,
    monthly_emission_target_kg: 52000,
    emission_sources: [
      { source_type: 'purchased_electricity', description: 'ZESA grid — gins & lint cleaners', scope: 2, applicable: true },
      { source_type: 'mobile_combustion',     description: 'Cotton transport tractors & trucks', fuel_type: 'Diesel', scope: 1, applicable: true },
    ],
    facility_manager:      { name: 'Munyaradzi Hove', email: 'mhove@cottco.co.zw',  phone: '+263 68 222 5678', title: 'Gin Manager' },
    environmental_officer: { name: 'Fungai Chirwa',   email: 'fchirwa@cottco.co.zw', phone: '+263 71 012 3456', title: 'Quality & Environment Officer' },
    verification_body:        'Zimbabwe Environmental Management Agency (EMA)',
    last_verification_date:   '2025-09-30',
    next_verification_date:   '2026-09-30',
    iso_14064_certified:      false,
    zcma_compliant:           true,
    active:                   true,
  },
]

// ─── Devices (one ESP32 per facility) ────────────────────────────────────────

const devices = [
  {
    id: 'dev-zpc-001', device_id: 'dev-zpc-001', facility_id: 'fac-zpc',
    device_name: 'ESP32 Monitor — Boiler Hall',
    location:    'Boiler Room, Unit 2 (coal feed side)',
    sensors:     ['co2', 'ch4', 'temperature', 'humidity', 'energy'],
    status: 'online', firmware_version: '1.4.2',
    last_seen: new Date('2026-02-28T23:00:00Z').toISOString(),
  },
  {
    id: 'dev-zisco-001', device_id: 'dev-zisco-001', facility_id: 'fac-zisco',
    device_name: 'ESP32 Monitor — Blast Furnace',
    location:    'Blast Furnace Tap Floor, Bay 1',
    sensors:     ['co2', 'ch4', 'temperature', 'humidity', 'energy'],
    status: 'online', firmware_version: '1.4.2',
    last_seen: new Date('2026-02-28T23:00:00Z').toISOString(),
  },
  {
    id: 'dev-nrz-001', device_id: 'dev-nrz-001', facility_id: 'fac-nrz',
    device_name: 'ESP32 Monitor — Test Cell',
    location:    'Diesel Engine Test Cell, Workshop A',
    sensors:     ['co2', 'ch4', 'temperature', 'humidity', 'energy'],
    status: 'online', firmware_version: '1.3.9',
    last_seen: new Date('2026-02-28T23:00:00Z').toISOString(),
  },
  {
    id: 'dev-mbpm-001', device_id: 'dev-mbpm-001', facility_id: 'fac-mbpm',
    device_name: 'ESP32 Monitor — Boiler House',
    location:    'Wood Chip Boiler Room, Stack Base',
    sensors:     ['co2', 'temperature', 'humidity', 'energy'],
    status: 'online', firmware_version: '1.4.0',
    last_seen: new Date('2026-02-28T23:00:00Z').toISOString(),
  },
  {
    id: 'dev-cottco-001', device_id: 'dev-cottco-001', facility_id: 'fac-cottco',
    device_name: 'ESP32 Monitor — Gin Floor',
    location:    'Main Gin Floor, Lint Room 3',
    sensors:     ['co2', 'temperature', 'humidity', 'energy'],
    status: 'online', firmware_version: '1.4.0',
    last_seen: new Date('2026-02-28T23:00:00Z').toISOString(),
  },
]

// ─── Emission factors & base sensor values per facility ───────────────────────
//
// Base values reflect Dec–Feb rainy season (high temp, high humidity)
// and the specific industrial process at each site.

const facilityConfig = {
  'fac-zpc': {
    // Coal thermal — highest CO2/CH4, hottest site (boiler proximity)
    base: { co2: 685, ch4: 6.4, temp: 38, hum: 52, energy: 490 },
    ef:   COAL_EF,
    scope1Ratio: 0.62,   // mostly scope 1 (coal combustion)
  },
  'fac-zisco': {
    // Steel/coke — very high CO2, process emissions, high heat
    base: { co2: 610, ch4: 5.1, temp: 44, hum: 40, energy: 430 },
    ef:   COAL_EF,
    scope1Ratio: 0.55,
  },
  'fac-nrz': {
    // Diesel test cell — moderate CO2, diesel combustion odour
    base: { co2: 540, ch4: 3.6, temp: 31, hum: 68, energy: 220 },
    ef:   DIESEL_EF,
    scope1Ratio: 0.7,
  },
  'fac-mbpm': {
    // Biomass boiler — moderate CO2 (biogenic), high humidity (steam plant)
    base: { co2: 495, ch4: 2.2, temp: 30, hum: 76, energy: 185 },
    ef:   BIOMASS_EF,
    scope1Ratio: 0.25,   // biogenic CO2 is low-impact; grid is bigger source
  },
  'fac-cottco': {
    // Electric gin — low CO2, warm & dusty (cotton lint)
    base: { co2: 445, ch4: 1.8, temp: 28, hum: 65, energy: 145 },
    ef:   ZESA_GRID_EF_RAINY,
    scope1Ratio: 0.08,   // almost all scope 2
  },
}

// ─── Sensor reading generator (168 hourly readings per facility) ──────────────

function generateSensorReadings(facilityId, deviceId) {
  const cfg  = facilityConfig[facilityId]
  const base = cfg.base
  const readings = []

  for (let h = 0; h < 168; h++) {
    const ts      = readingTimestamp(h)
    const hourUTC = new Date(ts).getUTCHours()
    // Zimbabwe is UTC+2, so local hour = UTC+2
    const hourLocal = (hourUTC + 2) % 24

    // Diurnal pattern: industry runs 06:00–22:00 local
    const workFactor = (hourLocal >= 6 && hourLocal <= 22) ? 1 : 0.55

    // ZESA load shedding — energy drops to ~5% during shed window
    const energyRaw = clamp(noise(base.energy * workFactor, 0.1), 10, 700)
    const energy_kwh = round2(loadshedEnergy(energyRaw, hourLocal))

    // Rainy season: afternoon thunderstorms cool things slightly (14:00–17:00)
    const stormCool = (hourLocal >= 14 && hourLocal <= 17 && Math.random() < 0.35) ? -3 : 0

    const co2_raw     = round1(clamp(noise(base.co2 * workFactor, 0.07),  380, 1400))
    const ch4_raw     = round2(clamp(noise(base.ch4 * workFactor, 0.09),  1, 15))
    const co2_mg_m3   = round2(co2_raw * CO2_PPM_TO_MG)
    const ch4_mg_m3   = round2(ch4_raw * CH4_PPM_TO_MG)
    const temperature = round1(clamp(noise(base.temp, 0.05) + stormCool,  18, 58))
    const humidity    = round1(clamp(noise(base.hum, 0.06),               25, 95))

    readings.push({
      device_id:         deviceId,
      facility_id:       facilityId,
      timestamp:         ts,
      co2_mg_m3,
      ch4_mg_m3,
      temperature,
      humidity,
      energy_kwh,
      air_quality_index: Math.round(Math.max(0, Math.min(100, (co2_mg_m3 - 720) / 7.2))),
      data_source:       'simulator',
    })
  }
  return readings
}

// ─── Daily summary generator (90 days per facility) ──────────────────────────
//
// Emission trend: slightly above target in Dec, dips in Jan (wet, some shutdowns),
// then picks up again in Feb. This tells a realistic story for MRV reporting.

function generateDailySummaries(facilityId, monthlyTargetKg) {
  const cfg        = facilityConfig[facilityId]
  const base       = cfg.base
  const dailyTarget = monthlyTargetKg / 30
  const summaries   = []

  for (let d = 0; d < 90; d++) {
    const date = summaryDate(d)
    const id   = `${facilityId}_${date}`

    // Month-based trend: Dec over-target, Jan dip (planned shutdown + rains),
    // Feb partial recovery
    let monthFactor
    if (d < 31)       monthFactor = 1.1    // December — above target (year-end production push)
    else if (d < 62)  monthFactor = 0.88   // January  — below target (planned maintenance + wet)
    else              monthFactor = 0.97   // February — near target (recovery)

    // Day-of-week: Sundays reduced production (~30% reduction)
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay()
    const weekFactor = dayOfWeek === 0 ? 0.72 : 1

    // Seasonal temperature at this day in the window
    const avg_temp   = seasonalTemp(d, base.temp)
    const avg_co2_raw  = round1(clamp(noise(base.co2 * monthFactor * weekFactor, 0.06), 380, 1400))
    const max_co2_raw  = round1(clamp(avg_co2_raw * rand(1.06, 1.22), 380, 1400))
    const avg_co2_mg_m3 = round1(avg_co2_raw * CO2_PPM_TO_MG)
    const max_co2_mg_m3 = round1(max_co2_raw * CO2_PPM_TO_MG)

    // Total daily CO2e
    const dayNoise   = 1 + (Math.random() - 0.5) * 0.12
    const total      = round2(clamp(dailyTarget * monthFactor * weekFactor * dayNoise, 100, dailyTarget * 2.5))
    const scope1     = round2(total * cfg.scope1Ratio)
    const scope2     = round2(total - scope1)

    // Breakdown within scope 1
    const sc1_stationary = round2(scope1 * 0.74)
    const sc1_process    = round2(scope1 * 0.16)
    const sc1_fugitive   = round2(scope1 - sc1_stationary - sc1_process)

    summaries.push({
      id,
      facility_id:    facilityId,
      date,
      total_co2e_kg:  total,
      scope1_kg:      scope1,
      scope2_kg:      scope2,
      breakdown: {
        stationary_combustion: sc1_stationary,
        process_emissions:     sc1_process,
        fugitive_emissions:    sc1_fugitive,
        purchased_electricity: scope2,
      },
      avg_co2_mg_m3,
      max_co2_mg_m3,
      avg_temperature:  round1(avg_temp),
      reading_count:    24,
      createdAt: new Date('2026-03-01T06:00:00Z').toISOString(),
      updatedAt: new Date('2026-03-01T06:00:00Z').toISOString(),
    })
  }
  return summaries
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedUsers(now) {
  console.log('👤 Creating Auth accounts & user docs...')
  const seeded = []
  for (const u of userDefs) {
    let uid
    try {
      uid = (await authAdmin.getUserByEmail(u.email)).uid
      console.log(`   ~ ${u.email} already exists (${uid})`)
    } catch {
      uid = (await authAdmin.createUser({
        email: u.email, password: u.initialPwd, displayName: u.displayName,
      })).uid
      console.log(`   ✓ ${u.email} created (${uid})`)
    }
    const { initialPwd, ...userData } = u
    await db.collection('users').doc(uid).set({ ...userData, uid, createdAt: now, updatedAt: now })
    seeded.push({ ...userData, uid })
  }
  return seeded
}

async function seedFacilities(now, adminUid) {
  console.log('\n🏭 Writing facilities...')
  for (const f of facilities) {
    await db.collection('facilities').doc(f.id).set({
      ...f, createdAt: now, updatedAt: now, createdBy: adminUid,
    })
    console.log(`   ✓ ${f.id.padEnd(14)} ${f.province.padEnd(22)} ${f.facility_name}`)
  }
}

async function seedDevices(now) {
  console.log('\n📡 Writing devices...')
  for (const d of devices) {
    await db.collection('devices').doc(d.id).set({ ...d, createdAt: now, updatedAt: now })
    console.log(`   ✓ ${d.id.padEnd(16)} → ${d.facility_id}  (${d.location})`)
  }
}

async function seedReadings(batchSize) {
  console.log('\n📊 Writing sensor readings...')
  let batch = db.batch()
  let ops = 0, count = 0
  for (const fac of facilities) {
    const dev = devices.find(d => d.facility_id === fac.id)
    for (const r of generateSensorReadings(fac.id, dev.id)) {
      batch.set(db.collection('sensor_readings').doc(), r)
      count++; ops++
      if (ops % batchSize === 0) { await batch.commit(); batch = db.batch(); process.stdout.write('.') }
    }
  }
  await batch.commit()
  console.log(`\n   ✓ ${count} sensor readings  (Feb 22–28 2026, device_id + facility_id on each)`)
  return count
}

async function seedSummaries(batchSize) {
  console.log('\n📈 Writing daily summaries...')
  let batch = db.batch()
  let ops = 0, count = 0
  for (const fac of facilities) {
    for (const s of generateDailySummaries(fac.id, fac.monthly_emission_target_kg)) {
      batch.set(db.collection('daily_summaries').doc(s.id), s)
      count++; ops++
      if (ops % batchSize === 0) { await batch.commit(); batch = db.batch(); process.stdout.write('.') }
    }
  }
  await batch.commit()
  console.log(`\n   ✓ ${count} daily summaries  (Dec 1 2025 – Feb 28 2026, ID = facilityId_date)`)
  return count
}

function printReport(seededUsers, rCount, sCount) {
  console.log('\n' + '─'.repeat(70))
  console.log('✅  Seed complete!\n')
  console.log(`  users            ${seededUsers.length}   docs`)
  console.log(`  facilities       ${facilities.length}   docs`)
  console.log(`  devices          ${devices.length}   docs`)
  console.log(`  sensor_readings  ${rCount}  docs`)
  console.log(`  daily_summaries  ${sCount}  docs`)
  console.log('\n  ID             Province           City        Industry')
  console.log('  ' + '─'.repeat(66))
  for (const f of facilities) {
    console.log(`  ${f.id.padEnd(14)} ${f.province.padEnd(20)} ${f.city_town.padEnd(12)} ${f.industry_sector_label}`)
  }
  console.log('\nRelationships:')
  console.log('  devices.facility_id          →  facilities/{id}')
  console.log('  sensor_readings.facility_id  →  facilities/{id}')
  console.log('  sensor_readings.device_id    →  devices/{id}')
  console.log('  daily_summaries.facility_id  →  facilities/{id}')
  console.log('  daily_summaries.id           =  "{facilityId}_{YYYY-MM-DD}"')
  console.log('  users.facilityIds[]          →  facilities/{id}  (["*"] = admin)\n')
  for (const u of seededUsers) {
    const access = u.facilityIds[0] === '*' ? 'all facilities' : u.facilityIds.join(', ')
    console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(44)} → ${access}`)
  }
  console.log('\n📧 Login credentials:')
  console.log('  admin@carbonmonitor.co.zw         Admin@1234')
  console.log('  operator1@carbonmonitor.co.zw     Operator@1234')
  console.log('  operator2@carbonmonitor.co.zw     Operator@1234')
  console.log('  viewer@carbonmonitor.co.zw        Viewer@1234')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

console.log('🌱 Seeding Firestore — Zimbabwe Carbon Monitor (Multi-Province)\n')
console.log('   Daily summaries : 2025-12-01 → 2026-02-28  (90 days, rainy season)')
console.log('   Hourly readings : 2026-02-22 → 2026-02-28  (168 h × 5 facilities)\n')

const BATCH_SIZE = 400
const now = new Date().toISOString()

try {
  const seededUsers = await seedUsers(now)
  const adminUid    = seededUsers.find(u => u.role === 'admin')?.uid ?? 'seed'
  await seedFacilities(now, adminUid)
  await seedDevices(now)
  const rCount = await seedReadings(BATCH_SIZE)
  const sCount = await seedSummaries(BATCH_SIZE)
  printReport(seededUsers, rCount, sCount)
} catch (err) {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
}
