import { emptyLabel, type Barcode, type ParsedLabel } from '../types'
import { parseAnsiLabel, parseLinearField } from './ansi'
import { parseGenericText } from './generic'
import { parseLcscLabel, parseLcscPrinted } from './lcsc'

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
 * printed text, except a label that says LCSC.COM: that is looked up at LCSC
 * from its C-code. OCR fills in what the barcodes do not say.
 */
function lcscLabel(fromCode: ParsedLabel | null, printed: ParsedLabel): ParsedLabel {
  const fromQr = fromCode?.source === 'lcsc' ? fromCode : null
  const distributorPn = fromQr?.distributorPn ?? printed.distributorPn
  const partNumber = [fromQr?.mpn, printed.mpn].find(
    (value) => value && value.toUpperCase() !== distributorPn,
  )
  return {
    ...printed,
    ...fromQr,
    source: 'lcsc',
    confidence: 'high',
    distributorPn,
    mpn: partNumber ?? distributorPn ?? printed.mpn,
    qty: fromQr?.qty ?? printed.qty ?? fromCode?.qty,
    manufacturer: fromQr?.manufacturer ?? printed.manufacturer ?? fromCode?.manufacturer,
    description: fromQr?.description ?? printed.description ?? fromCode?.description,
    specs: { ...printed.specs, ...fromQr?.specs },
    mpnCandidates: [printed.mpn, ...printed.mpnCandidates, ...fromCode?.mpnCandidates ?? []]
      .filter((candidate): candidate is string => Boolean(candidate) && candidate !== partNumber && candidate !== distributorPn)
      .slice(0, 6),
  }
}
export function parseLabel(barcodes: Barcode[], ocrText: string): ParsedLabel {
  const fromText = parseGenericText(ocrText)
  const printedLcsc = parseLcscPrinted(ocrText)

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

  if (printedLcsc) return lcscLabel(fromCode, printedLcsc)

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
