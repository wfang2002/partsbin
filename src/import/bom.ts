import type { BomLine } from '../domain/types'
import { findColumns, parseCount, parseCsv } from './csv'

type BomField = 'refs' | 'qty' | 'value' | 'footprint' | 'mpn' | 'dnp'

const ALIASES: Record<BomField, string[]> = {
  mpn: [
    'mpn',
    'manufacturerpartnumber',
    'mfrpartnumber',
    'mfrpart#',
    'mfrpart',
    'mfgpart#',
    'mfgpart',
    'mfrpn',
    'mfr#',
    'manf#',
    'partnumber',
    'partno',
    'pn',
  ],
  refs: ['reference', 'references', 'refs', 'ref', 'designator', 'designators'],
  qty: ['qty', 'quantity', 'quantityperpcb', 'count'],
  value: ['value', 'designation', 'comment'],
  footprint: ['footprint', 'package'],
  dnp: ['dnp', 'donotpopulate'],
}

const SIZE_RE = /(?<!\d)(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?!\d)/

/** "Resistor_SMD:R_0603_1608Metric" becomes "0603". */
function shortFootprint(footprint: string): string {
  const name = footprint.includes(':')
    ? footprint.slice(footprint.indexOf(':') + 1)
    : footprint
  return SIZE_RE.exec(name)?.[1] ?? name
}

/**
 * Read a bill of materials exported from KiCad as CSV. Handles one row per
 * group ("R1,R2" with a quantity) as well as one row per component, and
 * skips the preamble some exporters write before the header.
 */
export function parseBom(csv: string): BomLine[] {
  const rows = parseCsv(csv)
  const found = findColumns<BomField>(rows, ALIASES, [['refs', 'value', 'mpn'], ['refs', 'qty']])
  if (!found) {
    throw new Error(
      'Could not find the BOM columns. The file needs a header row with ' +
        'Reference and Value (or a part number) columns.',
    )
  }
  const { headerRow, columns } = found
  const cell = (row: string[], field: BomField) => {
    const index = columns[field]
    return index === undefined ? '' : (row[index] ?? '')
  }

  const grouped = new Map<string, BomLine & { refList: string[] }>()
  for (const row of rows.slice(headerRow + 1)) {
    const dnp = cell(row, 'dnp').toLowerCase()
    if (dnp && !['0', 'no', 'false'].includes(dnp)) continue
    const refs = cell(row, 'refs')
      .split(/[\s,;]+/)
      .filter(Boolean)
    const mpn = cell(row, 'mpn')
    const value = cell(row, 'value')
    const footprint = shortFootprint(cell(row, 'footprint'))
    const label = mpn || [value, footprint].filter(Boolean).join(' ')
    if (!label) continue
    const qty = parseCount(cell(row, 'qty')) ?? Math.max(refs.length, 1)
    const existing = grouped.get(label.toUpperCase())
    if (existing) {
      existing.qty += qty
      existing.refList.push(...refs)
    } else {
      grouped.set(label.toUpperCase(), { mpn: label, qty, refList: refs })
    }
  }
  if (grouped.size === 0) throw new Error('The BOM file has no component rows.')
  return [...grouped.values()].map(({ refList, ...line }) => ({
    ...line,
    ...(refList.length > 0 ? { refs: refList.join(', ') } : {}),
  }))
}
