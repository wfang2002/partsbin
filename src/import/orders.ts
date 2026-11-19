import { findColumns, parseCount, parseCsv } from './csv'

export interface OrderLine {
  mpn?: string
  qty?: number
  description?: string
  manufacturer?: string
  /** The distributor's order code. */
  distributorPn?: string
  package?: string
}

type OrderField = 'mpn' | 'qty' | 'description' | 'manufacturer' | 'distributorPn' | 'package'

// Header names as exported by Digi-Key, Mouser and LCSC order history.
const ALIASES: Record<OrderField, string[]> = {
  mpn: [
    'manufacturerpartnumber',
    'manufacturepartnumber',
    'mfrpartnumber',
    'mfr#',
    'mfrno',
    'mfrpart#',
    'mpn',
  ],
  distributorPn: [
    'digikeypartnumber',
    'digikeypart#',
    'mouser#',
    'mouserno',
    'mouserpartnumber',
    'lcscpartnumber',
    'lcsc#',
    'lcscpart#',
    'partnumber',
  ],
  qty: ['quantity', 'orderqty', 'qty', 'quantityordered', 'orderedqty'],
  description: ['description', 'desc', 'productdescription'],
  manufacturer: ['manufacturer', 'manufacturername', 'mfr', 'brand'],
  package: ['package', 'packagecase'],
}

/** Read an order-history CSV exported from a distributor's website. */
export function parseOrderCsv(csv: string): OrderLine[] {
  const rows = parseCsv(csv)
  const found = findColumns<OrderField>(rows, ALIASES, [['mpn', 'distributorPn'], ['qty', 'description']])
  if (!found) {
    throw new Error(
      'Could not find the order columns. The file needs a header row with a ' +
        'part number column and a quantity or description column.',
    )
  }
  const { headerRow, columns } = found
  const lines: OrderLine[] = []
  for (const row of rows.slice(headerRow + 1)) {
    const get = (field: OrderField) => {
      const index = columns[field]
      const value = index === undefined ? '' : (row[index] ?? '')
      return value || undefined
    }
    const line: OrderLine = {
      mpn: get('mpn'),
      qty: parseCount(get('qty')),
      description: get('description'),
      manufacturer: get('manufacturer'),
      distributorPn: get('distributorPn'),
      package: get('package'),
    }
    // Skip totals and blank lines.
    if (!line.mpn && !line.distributorPn) continue
    if (!line.mpn && !line.description) continue
    lines.push(line)
  }
  if (lines.length === 0) throw new Error('The file has no order lines.')
  return lines
}
