import { emptyLabel, type Barcode, type ParsedLabel } from '../types'
import { parseAnsiLabel, parseLinearField } from './ansi'
import { parseGenericText } from './generic'
import { parseLcscLabel } from './lcsc'

/** Payload of the QR stickers PartsBin prints for boxes. */
const LOCATION_QR_RE = /^PB:L:([0-9a-f]{8,})$/

export function locationQrPayload(locationId: string): string {
  return `PB:L:${locationId}`
}

/** The location ID if this barcode is a PartsBin box sticker. */
export function parseLocationQr(text: string): string | null {
  return LOCATION_QR_RE.exec(text.trim())?.[1] ?? null
}

/**
 * Combine everything read from one label photo. Barcodes are trusted over
 * printed text; OCR fills in what the barcodes do not say.
 */
export function parseLabel(barcodes: Barcode[], ocrText: string): ParsedLabel {
  const fromText = parseGenericText(ocrText)

  let fromCode: ParsedLabel | null = null
  for (const { text } of barcodes) {
    fromCode = parseAnsiLabel(text) ?? parseLcscLabel(text)
    if (fromCode) break
  }

  if (!fromCode) {
    // Mouser prints one linear barcode per field.
    const linear = emptyLabel('barcode')
    for (const { text } of barcodes) {
      const field = parseLinearField(text)
      if (field?.mpn && !linear.mpn) linear.mpn = field.mpn
      if (field?.qty && !linear.qty) linear.qty = field.qty
    }
    if (linear.mpn) {
      linear.confidence = 'high'
      if (/mouser/i.test(ocrText)) linear.source = 'mouser'
      fromCode = linear
    } else if (linear.qty && !fromText.qty) {
      fromText.qty = linear.qty
    }
  }

  if (!fromCode) return fromText

  const sameMpn = (a?: string) => a?.toUpperCase() === fromCode.mpn?.toUpperCase()
  return {
    ...fromCode,
    qty: fromCode.qty ?? fromText.qty,
    manufacturer: fromCode.manufacturer ?? fromText.manufacturer,
    description: fromCode.description ?? fromText.description,
    specs: { ...fromText.specs, ...fromCode.specs },
    mpnCandidates: [fromText.mpn, ...fromText.mpnCandidates]
      .filter((c): c is string => Boolean(c) && !sameMpn(c))
      .slice(0, 6),
  }
}
