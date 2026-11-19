import { emptyLabel, type ParsedLabel } from '../types'

const GS = '\x1d'
const RS = '\x1e'
const EOT = '\x04'

/**
 * Digi-Key and Mouser bags carry a DataMatrix code in the ANSI MH10.8.2
 * format: "[)>" RS "06" GS field GS field ... RS EOT, where each field
 * starts with a data identifier such as "1P" (manufacturer part number)
 * or "Q" (quantity).
 */
export function parseAnsiFields(text: string): Map<string, string> | null {
  if (!text.startsWith('[)>')) return null
  let body = text.slice(3)
  if (body.startsWith(RS)) body = body.slice(1)
  if (!body.startsWith('06')) return null
  body = body.slice(2)
  const fields = new Map<string, string>()
  for (const raw of body.split(new RegExp(`[${GS}${RS}${EOT}]`))) {
    const match = /^(\d{0,2}[A-Z])(.*)$/s.exec(raw.trim())
    if (!match || !match[2]) continue
    // Keep the first occurrence of each identifier.
    if (!fields.has(match[1])) fields.set(match[1], match[2].trim())
  }
  return fields.size > 0 ? fields : null
}

function parseQty(text: string | undefined): number | undefined {
  if (!text) return undefined
  const qty = Number(text.replace(/,/g, ''))
  return Number.isFinite(qty) && qty > 0 ? qty : undefined
}

export function parseAnsiLabel(text: string): ParsedLabel | null {
  const fields = parseAnsiFields(text)
  if (!fields) return null
  const mpn = fields.get('1P')
  if (!mpn) return null

  // Digi-Key adds its own part number (30P) and internal IDs (12Z, 13Z);
  // Mouser adds the manufacturer name (1V) and an order line number (14K).
  const isDigiKey = ['30P', '10K', '12Z', '13Z', '11Z'].some((k) => fields.has(k))
  const isMouser = !isDigiKey && (fields.has('1V') || fields.has('14K'))

  const label = emptyLabel(isDigiKey ? 'digikey' : isMouser ? 'mouser' : 'barcode')
  label.mpn = mpn
  label.confidence = 'high'
  label.qty = parseQty(fields.get('Q'))
  if (isDigiKey) label.distributorPn = fields.get('30P') ?? fields.get('P')
  if (isMouser) label.manufacturer = fields.get('1V')
  return label
}

/**
 * The linear barcodes on a Mouser bag each hold one field with the same
 * identifiers: "1P<part number>", "Q<quantity>".
 */
export function parseLinearField(
  text: string,
): { mpn?: string; qty?: number } | null {
  const trimmed = text.trim()
  const mpn = /^1P([A-Z0-9][A-Z0-9\-+./#_ ]{2,})$/i.exec(trimmed)
  if (mpn) return { mpn: mpn[1].trim() }
  const qty = /^Q(\d{1,7})$/.exec(trimmed)
  if (qty) return { qty: Number(qty[1]) }
  return null
}
