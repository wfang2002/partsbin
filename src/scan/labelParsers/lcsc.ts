import { emptyLabel, type ParsedLabel } from '../types'
import { parseGenericText } from './generic'

/** "LCSC.COM" or "www.lcsc.com", including a space where OCR dropped the dot. */
const LCSC_SITE_RE = /lcsc\s*\.?\s*com/i
const LCSC_CODE_RE = /\bC\s?\d{3,8}\b/i

/**
 * LCSC bags carry a QR code such as
 *   {pbn:PICK2009291337,on:SO2009291337,pc:C1525,pm:CL05B104KO5NNNC,qty:500,mc:,cc:1,pdi:34421807}
 * pc is the LCSC order code, pm the manufacturer part number.
 */
export function parseLcscLabel(text: string): ParsedLabel | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  const fields = new Map<string, string>()
  for (const pair of trimmed.slice(1, -1).split(',')) {
    const colon = pair.indexOf(':')
    if (colon <= 0) continue
    fields.set(pair.slice(0, colon).trim().toLowerCase(), pair.slice(colon + 1).trim())
  }
  const pc = fields.get('pc')
  const pm = fields.get('pm')
  if (!pm && !(pc && /^C\d+$/i.test(pc))) return null

  const label = emptyLabel('lcsc')
  if (pc) {
    label.distributorPn = pc.toUpperCase()
    label.specs.LCSC = label.distributorPn
  }
  if (pm) label.mpn = pm
  else if (label.distributorPn) label.mpn = label.distributorPn
  if (label.mpn || label.distributorPn) label.confidence = 'high'
  const qty = Number(fields.get('qty'))
  if (Number.isFinite(qty) && qty > 0) label.qty = qty
  return label
}

/**
 * A printed LCSC bag. The site name is what makes it LCSC; the C-code and the
 * manufacturer part number are read from the rest of the text.
 */
export function parseLcscPrinted(text: string): ParsedLabel | null {
  if (!LCSC_SITE_RE.test(text)) return null
  const printed = parseGenericText(text)
  const code = text.match(LCSC_CODE_RE)?.[0].replace(/\s+/g, '').toUpperCase()
  const isCode = (value?: string) => Boolean(code) && value?.replace(/\s+/g, '').toUpperCase() === code
  const pn = [printed.mpn, ...printed.mpnCandidates].find((candidate) => !isCode(candidate))

  const label = emptyLabel('lcsc')
  label.confidence = code || pn ? 'high' : 'low'
  if (code) {
    label.distributorPn = code
    label.specs.LCSC = code
  }
  label.mpn = pn ?? code
  label.qty = printed.qty
  label.manufacturer = printed.manufacturer
  label.description = printed.description
  label.specs = { ...printed.specs, ...label.specs }
  label.mpnCandidates = [printed.mpn, ...printed.mpnCandidates]
    .filter((candidate): candidate is string => Boolean(candidate) && candidate !== label.mpn && !isCode(candidate))
    .slice(0, 6)
  return label
}
