import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function initAdmin() {
  if (getApps().length > 0) return getApps()[0]

  const keyPath = join(process.cwd(), 'serviceAccountKey.json')
  if (existsSync(keyPath)) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
    return initializeApp({ credential: cert(serviceAccount) })
  }

  // Fall back to Application Default Credentials (Cloud Run / App Engine)
  return initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  })
}

initAdmin()
export const adminDb = getFirestore()
