/**
 * Seeds Firestore with the Kgotso ClimateHealth indoor air quality dataset.
 *
 * Usage:
 *   node scripts/seed-kgotso.mjs [path/to/dataset.csv]
 *
 * If no path is given it looks for scripts/kgotso-dataset.csv in the project root.
 * Copy "Tsitsi Data Set.csv" to that location before running.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── Firebase Admin ────────────────────────────────────────────────────────────
const saPath = join(ROOT, 'serviceAccount.json')
if (!existsSync(saPath)) {
  console.error('❌  serviceAccount.json not found at project root')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) })
const db = getFirestore()

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvPath = process.argv[2] ?? join(ROOT, 'scripts', 'kgotso-dataset.csv')
if (!existsSync(csvPath)) {
  console.error(`❌  CSV not found: ${csvPath}`)
  console.error('   Copy "Tsitsi Data Set.csv" to scripts/kgotso-dataset.csv first,')
  console.error('   or pass the full path: node scripts/seed-kgotso.mjs <path>')
  process.exit(1)
}

// Parse "M/D/YYYY H:MM" in Africa/Harare (UTC+2) → UTC Date
function parseHarareDateTime(str) {
  const [datePart, timePart] = str.trim().split(' ')
  const [month, day, year] = datePart.split('/').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour - 2, minute))
}

const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
const records = lines.slice(1).flatMap(line => {
  const cols = line.split(',')
  if (cols.length < 7) return []
  const co2  = parseInt(cols[4].trim(), 10)
  const temp = parseInt(cols[5].trim(), 10)
  const hum  = parseInt(cols[6].trim(), 10)
  if (isNaN(co2) || isNaN(temp) || isNaN(hum)) return []
  return [{
    source_id:            cols[0].trim(),
    datetime_start_local: cols[2].trim(),
    datetime_end_local:   cols[3].trim(),
    co2_ppm:              co2,
    temperature_celsius:  temp,
    humidity_percent:     hum,
  }]
})

// Sort chronologically
records.sort((a, b) =>
  parseHarareDateTime(a.datetime_start_local) -
  parseHarareDateTime(b.datetime_start_local)
)

console.log(`📊  Parsed ${records.length} records`)
console.log(`    Range: ${records[0].datetime_start_local} → ${records.at(-1).datetime_start_local}`)

// ── Write in batches of 400 ───────────────────────────────────────────────────
const COLLECTION = 'kgotso_readings'
const BATCH_SIZE = 400

async function seed() {
  console.log(`\n📥  Writing to Firestore collection "${COLLECTION}"…`)
  let written = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const chunk = records.slice(i, i + BATCH_SIZE)

    for (const r of chunk) {
      const tsStart = parseHarareDateTime(r.datetime_start_local)
      const tsEnd   = parseHarareDateTime(r.datetime_end_local)
      const docId   = `${r.source_id}_${tsStart.toISOString().replace(/[:.]/g, '-')}`
      batch.set(db.collection(COLLECTION).doc(docId), {
        source_id:            r.source_id,
        location:             'Africa/Harare',
        timestamp:            Timestamp.fromDate(tsStart),
        timestamp_end:        Timestamp.fromDate(tsEnd),
        datetime_start_local: r.datetime_start_local,
        co2_ppm:              r.co2_ppm,
        temperature_celsius:  r.temperature_celsius,
        humidity_percent:     r.humidity_percent,
        data_source:          'seeded',
      })
    }

    await batch.commit()
    written += chunk.length
    process.stdout.write(`\r    Progress: ${written}/${records.length}`)
  }

  console.log(`\n✅  Done — ${written} records in "${COLLECTION}"`)
}

seed().catch(err => { console.error('❌ ', err); process.exit(1) })
