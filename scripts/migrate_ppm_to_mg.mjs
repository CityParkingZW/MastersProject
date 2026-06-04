/**
 * Firestore Migration: ppm → mg/m³
 * ==================================
 * Converts existing sensor_readings and daily_summaries documents from
 * ppm fields to mg/m³ fields.
 *
 * Collections touched:
 *   sensor_readings  — co2_ppm → co2_mg_m3 | ch4_ppm → ch4_mg_m3
 *                      air_quality_index recalculated
 *   daily_summaries  — avg_co2_ppm → avg_co2_mg_m3 | max_co2_ppm → max_co2_mg_m3
 *
 * Old ppm fields are DELETED after conversion (not kept as duplicates).
 * Run with --dry-run to preview changes without writing.
 *
 * Usage:
 *   node scripts/migrate_ppm_to_mg.mjs             # live migration
 *   node scripts/migrate_ppm_to_mg.mjs --dry-run   # preview only
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname     = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── Conversion factors ────────────────────────────────────────────────────────
const CO2_PPM_TO_MG = 44.01 / 24.45   // ≈ 1.8004
const CH4_PPM_TO_MG = 16.04 / 24.45   // ≈ 0.6561
const BATCH_SIZE    = 400              // Firestore batch limit is 500; stay safe

const DRY_RUN = process.argv.includes('--dry-run')

function round2(n) { return Math.round(n * 100) / 100 }
function round1(n) { return Math.round(n * 10)  / 10  }

// ── Migrate sensor_readings ───────────────────────────────────────────────────
async function migrateSensorReadings() {
  console.log('\n── sensor_readings ──────────────────────────────────────')

  // Only fetch docs that still have the old co2_ppm field
  const snap = await db.collection('sensor_readings')
    .where('co2_ppm', '>=', 0)
    .get()

  if (snap.empty) {
    console.log('  Nothing to migrate — no co2_ppm fields found.')
    return 0
  }

  console.log(`  Found ${snap.size} documents to migrate.`)
  if (DRY_RUN) {
    const sample = snap.docs[0].data()
    console.log(`  Sample doc (id=${snap.docs[0].id}):`)
    console.log(`    co2_ppm=${sample.co2_ppm}  →  co2_mg_m3=${round2(sample.co2_ppm * CO2_PPM_TO_MG)}`)
    console.log(`    ch4_ppm=${sample.ch4_ppm}  →  ch4_mg_m3=${round2(sample.ch4_ppm * CH4_PPM_TO_MG)}`)
    console.log('  [DRY RUN] No writes performed.')
    return snap.size
  }

  let migrated = 0
  let batch = db.batch()
  let ops   = 0

  for (const doc of snap.docs) {
    const d = doc.data()

    const co2_mg_m3 = round2(d.co2_ppm * CO2_PPM_TO_MG)
    const ch4_mg_m3 = round2(d.ch4_ppm * CH4_PPM_TO_MG)
    const aqi       = Math.round(Math.max(0, Math.min(100, (co2_mg_m3 - 720) / 7.2)))

    batch.update(doc.ref, {
      co2_mg_m3,
      ch4_mg_m3,
      air_quality_index: aqi,
      co2_ppm:           FieldValue.delete(),
      ch4_ppm:           FieldValue.delete(),
    })
    ops++
    migrated++

    if (ops >= BATCH_SIZE) {
      await batch.commit()
      console.log(`  Committed ${migrated} / ${snap.size} …`)
      batch = db.batch()
      ops   = 0
    }
  }

  if (ops > 0) await batch.commit()
  console.log(`  ✓ Migrated ${migrated} sensor_readings documents.`)
  return migrated
}

// ── Migrate daily_summaries ───────────────────────────────────────────────────
async function migrateDailySummaries() {
  console.log('\n── daily_summaries ──────────────────────────────────────')

  const snap = await db.collection('daily_summaries')
    .where('avg_co2_ppm', '>=', 0)
    .get()

  if (snap.empty) {
    console.log('  Nothing to migrate — no avg_co2_ppm fields found.')
    return 0
  }

  console.log(`  Found ${snap.size} documents to migrate.`)
  if (DRY_RUN) {
    const sample = snap.docs[0].data()
    console.log(`  Sample doc (id=${snap.docs[0].id}):`)
    console.log(`    avg_co2_ppm=${sample.avg_co2_ppm}  →  avg_co2_mg_m3=${round1(sample.avg_co2_ppm * CO2_PPM_TO_MG)}`)
    console.log(`    max_co2_ppm=${sample.max_co2_ppm}  →  max_co2_mg_m3=${round1(sample.max_co2_ppm * CO2_PPM_TO_MG)}`)
    console.log('  [DRY RUN] No writes performed.')
    return snap.size
  }

  let migrated = 0
  let batch = db.batch()
  let ops   = 0

  for (const doc of snap.docs) {
    const d = doc.data()

    batch.update(doc.ref, {
      avg_co2_mg_m3: round1(d.avg_co2_ppm * CO2_PPM_TO_MG),
      max_co2_mg_m3: round1(d.max_co2_ppm * CO2_PPM_TO_MG),
      avg_co2_ppm:   FieldValue.delete(),
      max_co2_ppm:   FieldValue.delete(),
    })
    ops++
    migrated++

    if (ops >= BATCH_SIZE) {
      await batch.commit()
      console.log(`  Committed ${migrated} / ${snap.size} …`)
      batch = db.batch()
      ops   = 0
    }
  }

  if (ops > 0) await batch.commit()
  console.log(`  ✓ Migrated ${migrated} daily_summaries documents.`)
  return migrated
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Firestore Migration: ppm → mg/m³')
  if (DRY_RUN) console.log('  MODE: DRY RUN (no writes)')
  console.log('═══════════════════════════════════════════════════════')

  const t0 = Date.now()
  const r1  = await migrateSensorReadings()
  const r2  = await migrateDailySummaries()
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  console.log('\n═══════════════════════════════════════════════════════')
  if (DRY_RUN) {
    console.log(`  DRY RUN complete in ${elapsed}s`)
    console.log(`  Would migrate: ${r1} sensor_readings, ${r2} daily_summaries`)
    console.log('  Run without --dry-run to apply.')
  } else {
    console.log(`  Migration complete in ${elapsed}s`)
    console.log(`  Migrated: ${r1} sensor_readings, ${r2} daily_summaries`)
  }
  console.log('═══════════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
