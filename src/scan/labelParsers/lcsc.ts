import { emptyLabel, type ParsedLabel } from '../types'

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
  if (pm) {
    label.mpn = pm
    label.confidence = 'high'
  }
  if (pc) label.distributorPn = pc.toUpperCase()
  const qty = Number(fields.get('qty'))
  if (Number.isFinite(qty) && qty > 0) label.qty = qty
  return label
}
