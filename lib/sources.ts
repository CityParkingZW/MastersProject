// Friendly display names for monitoring source IDs.
// The stored source_id in Firestore stays as-is; this only changes how it's shown.

export const SOURCE_LABELS: Record<string, string> = {
  ixxkut7za9s: 'Kgotso-Facility-3000m3',
}

export function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id
}
