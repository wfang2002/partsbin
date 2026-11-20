import type { ParsedLabel } from '../scan/types'

/** A label photo saved in a box, waiting to be confirmed as a part. */
export interface InboxItem {
  id: string
  locationId: string
  createdAt: number
  photoHash: string
  ocrText: string
  warnings: string[]
  mpn?: string
  manufacturer?: string
  description?: string
  category?: string
  specs: Record<string, string>
  mpnCandidates: string[]
  source: ParsedLabel['source']
  confidence: ParsedLabel['confidence']
  qty?: number
  /** Reading while the label is being recognized. */
  state: 'reading' | 'ready'
}

export function newInboxItem(
  id: string,
  locationId: string,
  photoHash: string,
  createdAt = Date.now(),
): InboxItem {
  return {
    id,
    locationId,
    createdAt,
    photoHash,
    ocrText: '',
    warnings: [],
    specs: {},
    mpnCandidates: [],
    source: 'none',
    confidence: 'low',
    state: 'reading',
  }
}

/** Fill a waiting label with what was read from its photo. */
export function applyReading(
  item: InboxItem,
  reading: { ocrText: string; warnings: string[]; label: ParsedLabel },
): InboxItem {
  const { label } = reading
  return {
    ...item,
    ocrText: reading.ocrText,
    warnings: reading.warnings,
    mpn: label.mpn,
    manufacturer: label.manufacturer,
    description: label.description,
    category: label.category,
    specs: label.specs,
    mpnCandidates: label.mpnCandidates.filter((candidate) => candidate !== label.mpn),
    source: label.source,
    confidence: label.confidence,
    qty: label.qty,
    state: 'ready',
  }
}
