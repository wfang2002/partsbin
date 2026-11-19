import { parseValue } from '../../search/values'
import { emptyLabel, type ParsedLabel } from '../types'

/**
 * Best-effort reading of printed label text (from OCR): labelled fields such
 * as "MPN:" or "QTY:", then component values, packages and anything that
 * looks like a part number.
 */

const PN_CHARS = 'A-Z0-9\\-+./#_()'

const PN_VALUE = `\\s*[:#.]?\\s*([A-Z0-9][${PN_CHARS}]{2,})`
/** Labels that can only mean the manufacturer's part number. */
const MFR_PN_LABEL_RE = new RegExp(
  '(?:MFG\\.?\\s*P\\/?N|MFR\\.?\\s*(?:P\\/?N|PART\\s*(?:NO\\.?|NUMBER|#)?|#|NO\\.?)|MPN|' +
    'MANUFACTURER\\s*PART\\s*(?:NO\\.?|NUMBER|#)|MFG\\.?\\s*PART\\s*(?:NO\\.?|NUMBER|#)?)' +
    PN_VALUE,
  'gi',
)
/** Labels that might also introduce a distributor or customer number. */
const ANY_PN_LABEL_RE = new RegExp(
  `(?:PART\\s*(?:NO\\.?|NUMBER|#)|P\\/N|MODEL)${PN_VALUE}`,
  'gi',
)
const NOT_MFR_PREFIX_RE =
  /(?:MOUSER|DIGI-?KEY|LCSC|CUST(?:OMER)?\.?|ORDER|SUPPLIER|PO)\s*$/i

function labelledPartNumber(text: string): string | undefined {
  for (const re of [MFR_PN_LABEL_RE, ANY_PN_LABEL_RE]) {
    for (const match of text.matchAll(re)) {
      const before = text.slice(Math.max(0, match.index - 24), match.index)
      if (re === ANY_PN_LABEL_RE && NOT_MFR_PREFIX_RE.test(before)) continue
      if (looksLikePartNumber(match[1])) return match[1]
    }
  }
  return undefined
}
const QTY_RES = [
  /(?:QTY|QUANTITY|Q'TY)\s*[:.=]?\s*(\d[\d,]*)/i,
  /(\d[\d,]*)\s*(?:PCS|PIECES|PC)\b/i,
  /\bX\s?(\d{1,6})\b/i,
]
const DESC_RE = /(?:DESC(?:RIPTION)?)\s*[:.]\s*(.{3,})/i
const MANUFACTURER_RE = /(?:MFR|MFG|MANUFACTURER|BRAND)\s*[:.]\s*([A-Z][A-Z0-9 &.-]{1,30})$/im

const PACKAGE_RE =
  /(?<![A-Z0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512|SOT-?23(?:-[3568])?|SOT-?223|SOT-?89|SOT-?363|SOT-?323|SOT-?523|SOIC-?\d{1,2}|SOP-?\d{1,2}|SSOP-?\d{1,2}|TSSOP-?\d{1,2}|MSOP-?\d{1,2}|QFN-?\d{1,3}|DFN-?\d{1,2}|TQFP-?\d{2,3}|LQFP-?\d{2,3}|DIP-?\d{1,2}|TO-?220|TO-?92|TO-?252|TO-?263|TO-?247|DPAK|D2PAK|SMA|SMB|SMC|SOD-?123|SOD-?323|SOD-?523|DO-?214[A-C]{0,2}|DO-?41|DO-?35)(?![A-Z0-9])/i
const TOLERANCE_RE = /(?:±|\+\/-)?\s*(\d+(?:\.\d+)?)\s*%/
const VOLTAGE_RE = /(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*V(?:DC|AC)?(?![A-Z0-9])/i
const RESISTANCE_RE =
  /(?<![A-Z0-9.])(\d+(?:\.\d+)?\s*[kKmM]?\s*(?:Ω|OHMS?)|\d+(?:\.\d+)?[kKM]|\d+[RkKM]\d+|\d+(?:\.\d+)?R)(?![A-Z0-9])/i
const CAPACITANCE_RE =
  /(?<![A-Z0-9.])(\d+(?:\.\d+)?\s*[pnuµμ]F|\d+[pnuµμ]\d+)(?![A-Z0-9])/i
const INDUCTANCE_RE = /(?<![A-Z0-9.])(\d+(?:\.\d+)?\s*[nuµμm]H)(?![A-Z0-9])/i

const WORDS_NOT_PARTS = new Set([
  'ROHS',
  'LEAD-FREE',
  'PB-FREE',
  'MADE',
  'CHINA',
  'QTY',
  'PCS',
])

function looksLikePartNumber(token: string): boolean {
  if (token.length < 5 || token.length > 40) return false
  if (!/^[A-Z0-9][A-Z0-9\-+./#_()]*[A-Z0-9)]$/i.test(token)) return false
  const letters = (token.match(/[A-Z]/gi) ?? []).length
  const digits = (token.match(/\d/g) ?? []).length
  if (letters < 1 || digits < 2) return false
  if (WORDS_NOT_PARTS.has(token.toUpperCase())) return false
  // Not a plain value ("100nF"), package ("SOT-23") or date ("2024/05/01").
  if (parseValue(token) !== null) return false
  if (new RegExp(`^${PACKAGE_RE.source}$`, 'i').test(token)) return false
  if (/^\d{2,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(token)) return false
  if (/^https?:|^www\./i.test(token)) return false
  return true
}

function score(token: string): number {
  const letters = (token.match(/[A-Z]/gi) ?? []).length
  const digits = (token.match(/\d/g) ?? []).length
  // Longer tokens with a healthy mix of letters and digits rank first.
  return Math.min(letters, digits) * 2 + token.length
}

export function parseGenericText(text: string): ParsedLabel {
  const label = emptyLabel(text.trim() ? 'ocr' : 'none')
  if (!text.trim()) return label

  const labelled = labelledPartNumber(text)
  if (labelled) {
    label.mpn = labelled
    label.confidence = 'high'
  }

  for (const re of QTY_RES) {
    const match = re.exec(text)
    if (!match) continue
    const qty = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(qty) && qty > 0) {
      label.qty = qty
      break
    }
  }

  const description = DESC_RE.exec(text)
  if (description) label.description = description[1].trim()
  const manufacturer = MANUFACTURER_RE.exec(text)
  if (manufacturer) label.manufacturer = manufacturer[1].trim()

  const spec = (name: string, re: RegExp, group = 1) => {
    const match = re.exec(text)
    if (match) label.specs[name] = match[group].replace(/\s+/g, '')
  }
  spec('Resistance', RESISTANCE_RE)
  spec('Capacitance', CAPACITANCE_RE)
  spec('Inductance', INDUCTANCE_RE)
  spec('Package', PACKAGE_RE)
  spec('Voltage', VOLTAGE_RE, 0)
  const tolerance = TOLERANCE_RE.exec(text)
  if (tolerance) label.specs.Tolerance = `${tolerance[1]}%`
  // A capacitor label's "50V" is a rating; a bare resistor value is not a cap.
  if (label.specs.Capacitance || label.specs.Inductance) {
    delete label.specs.Resistance
  }

  const seen = new Set<string>()
  const candidates: string[] = []
  for (const raw of text.split(/[\s,;:|]+/)) {
    const token = raw.replace(/^[^A-Z0-9]+|[^A-Z0-9)]+$/gi, '')
    const key = token.toUpperCase()
    if (seen.has(key) || !looksLikePartNumber(token)) continue
    seen.add(key)
    candidates.push(token)
  }
  candidates.sort((a, b) => score(b) - score(a))
  label.mpnCandidates = candidates
    .filter((c) => c.toUpperCase() !== label.mpn?.toUpperCase())
    .slice(0, 6)

  if (!label.mpn && candidates.length > 0 && !hasValue(label)) {
    // A guess: shown to the user for confirmation, never trusted silently.
    label.mpn = candidates[0]
    label.mpnCandidates = candidates.slice(1, 7)
  }

  if (!label.description) {
    const summary = describeSpecs(label.specs)
    if (summary) label.description = summary
  }
  return label
}

function hasValue(label: ParsedLabel): boolean {
  const { Resistance, Capacitance, Inductance } = label.specs
  return Boolean(Resistance || Capacitance || Inductance)
}

/** "Resistor 10k 1% 0603" from the specs that were read. */
function describeSpecs(specs: Record<string, string>): string | undefined {
  const kind = specs.Resistance
    ? 'Resistor'
    : specs.Capacitance
      ? 'Capacitor'
      : specs.Inductance
        ? 'Inductor'
        : undefined
  if (!kind) return undefined
  const value = specs.Resistance ?? specs.Capacitance ?? specs.Inductance
  return [kind, value, specs.Tolerance, specs.Voltage, specs.Package]
    .filter(Boolean)
    .join(' ')
}
