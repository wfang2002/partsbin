/**
 * Component values written in different ways ("10k", "10kΩ", "10000",
 * "4k7", "100n", "0.1uF") are reduced to one canonical token so that they
 * match each other in search.
 */

const UNIT_RE = '(Ω|ohms?|R|F|H|Hz|V|A|W)'
const VALUE_RE = new RegExp(
  `^(\\d+(?:\\.\\d+)?|\\.\\d+)([pnuµμmkg]?)${UNIT_RE}?$`,
  'i',
)
/** Resistor-style notation with the multiplier as decimal point: 4k7, 4R7. */
const RKM_RE = /^(\d+)([RrpnuµμmkKMG])(\d+)$/
/** "100 nF", "10 kΩ", "3.3 V": a number and its unit separated by a space. */
const SPLIT_VALUE_RE = new RegExp(
  `(?<![\\w.])(\\d+(?:\\.\\d+)?)[ \\t]+([pnuµμmkMG]?${UNIT_RE})(?![\\w.])`,
  'gi',
)

/** Units where an upper-case "M" in ALL-CAPS text means milli, not mega. */
const MILLI_WHEN_UPPER = new Set(['a', 'h', 'v', 'w', 'f'])

function multiplier(prefix: string, unit: string, allUpper: boolean) {
  switch (prefix) {
    case '':
    case 'R':
    case 'r':
      return 1
    case 'p':
    case 'P':
      return 1e-12
    case 'n':
    case 'N':
      return 1e-9
    case 'u':
    case 'U':
    case 'µ':
    case 'μ':
      return 1e-6
    case 'm':
      return 1e-3
    case 'k':
    case 'K':
      return 1e3
    case 'M':
      // Distributor descriptions are upper case: "800MA" is milliamps.
      return allUpper && MILLI_WHEN_UPPER.has(unit) ? 1e-3 : 1e6
    case 'G':
      return 1e9
    default:
      return null
  }
}

/** The numeric value of a token such as "10k" or "0.1uF", or null. */
export function parseValue(token: string): number | null {
  const rkm = RKM_RE.exec(token)
  if (rkm) {
    const mult = multiplier(rkm[2], '', false)
    return mult === null ? null : Number(`${rkm[1]}.${rkm[3]}`) * mult
  }
  const match = VALUE_RE.exec(token)
  if (!match) return null
  const [, digits, prefix, rawUnit = ''] = match
  const unit = rawUnit.toLowerCase()
  const letters = token.replace(/[^A-Za-zµμΩ]/g, '')
  const allUpper = letters.length >= 2 && letters === letters.toUpperCase()
  const mult = multiplier(prefix, unit, allUpper)
  if (mult === null) return null
  const value = Number(digits) * mult
  return Number.isFinite(value) ? value : null
}

/** Canonical search token for a value, e.g. "=1e4" for 10 kΩ. */
export function canonicalValue(token: string): string | null {
  const value = parseValue(token)
  if (value === null) return null
  const text = Number(value.toPrecision(6)).toExponential().replace('+', '')
  return `=${text}`
}

/** Join "100 nF" into "100nF" so it is treated as one value. */
export function joinSplitValues(text: string): string {
  return text.replace(SPLIT_VALUE_RE, '$1$2')
}
