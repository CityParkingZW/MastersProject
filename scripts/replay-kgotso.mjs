/**
 * Live-replay: drip-feeds Kgotso records into Firestore with current timestamps,
 * making the dashboard look like data is arriving from a real sensor right now.
 *
 * Usage:
 *   node scripts/replay-kgotso.mjs [path/to/dataset.csv]
 *
 * Environment variables:
 *   INTERVAL_MS   — milliseconds between writes (default: 10000 = 10 s per record)
 *
 * The script cycles through all records and loops indefinitely.
 * Each new record is written to kgotso_readings with timestamp = now,
 * so the dashboard's "latest 168 records" window fills up with live-looking data.
 *
 * Stop with Ctrl+C.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS ?? '10000', 10)
const COLLECTION   = 'kgotso_readings'

// ── Firebase Admin ────────────────────────────────────────────────────────────
const saPath = join(ROOT, 'serviceAccount.json')
if (!existsSync(saPath)) { console.error('❌  serviceAccount.json not found'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) })
const db = getFirestore()

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvPath = process.argv[2] ?? join(ROOT, 'scripts', 'kgotso-dataset.csv')
if (!existsSync(csvPath)) {
  console.error(`❌  CSV not found: ${csvPath}`)
  process.exit(1)
}

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
  return [{ co2_ppm: co2, temperature_celsius: temp, humidity_percent: hum, original_ts: cols[2].trim() }]
})

records.sort((a, b) => parseHarareDateTime(a.original_ts) - parseHarareDateTime(b.original_ts))

const totalHours = (records.length * INTERVAL_MS) / 3_600_000
console.log(`⏱   Replay interval : ${INTERVAL_MS} ms / record`)
console.log(`📊  Records loaded  : ${records.length}`)
console.log(`🔄  Full cycle time : ${totalHours.toFixed(1)} h (loops continuously)`)
console.log(`📍  Collection      : ${COLLECTION}`)
console.log(`\nStarting replay — press Ctrl+C to stop.\n`)

function aqLabel(co2) {
  if (co2 < 600) return '🟢 Good'
  if (co2 < 800) return '🟡 Moderate'
  if (co2 < 1000) return '🟠 Poor'
  return '🔴 Very Poor'
}

let index = 0

async function writeNext() {
  const r = records[index % records.length]
  index++

  const now = new Date()
  const docId = `replay_${now.getTime()}`

  await db.collection(COLLECTION).doc(docId).set({
    source_id:            'ixxkut7za9s',
    location:             'Africa/Harare',
    timestamp:            Timestamp.fromDate(now),
    co2_ppm:              r.co2_ppm,
    temperature_celsius:  r.temperature_celsius,
    humidity_percent:     r.humidity_percent,
    original_timestamp:   r.original_ts,
    data_source:          'replay',
  })

  const t = now.toISOString().slice(11, 19)
  console.log(
    `[${t}]  CO₂: ${String(r.co2_ppm).padStart(4)} ppm` +
    `  Temp: ${String(r.temperature_celsius).padStart(3)}°C` +
    `  Humidity: ${String(r.humidity_percent).padStart(3)}%` +
    `  ${aqLabel(r.co2_ppm)}`
  )

  setTimeout(writeNext, INTERVAL_MS)
}

writeNext().catch(err => { console.error('❌ ', err); process.exit(1) })
