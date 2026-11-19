import {
  findPartByMpn,
  totalQty,
  type Inventory,
} from './inventory'
import type { BomLine, Part, Stock } from './types'

export type PickStatus =
  /** Enough counted stock. */
  | 'have'
  /** Some stock, but the bags are not counted. */
  | 'uncounted'
  /** Counted stock, but fewer than needed. */
  | 'short'
  /** The part is known but there is no stock, or the part is not known. */
  | 'missing'

export interface PickLine {
  line: BomLine
  part?: Part
  /** A similar part found by search, offered when there is no exact match. */
  suggestion?: Part
  stock: Stock[]
  counted: number
  uncounted: number
  status: PickStatus
}

/**
 * Work out, for each BOM line, which part it is, how many there are and
 * where they are. `suggest` finds a similar part for unmatched lines.
 */
export function buildPickList(
  inv: Inventory,
  bom: BomLine[],
  suggest: (text: string) => Part | undefined = () => undefined,
): PickLine[] {
  return bom.map((line) => {
    const part =
      (line.partId ? inv.partById.get(line.partId) : undefined) ??
      findPartByMpn(inv, line.mpn) ??
      // "ATmega328P-AU TQFP-32": the value may be the part number.
      findPartByMpn(inv, line.mpn.split(/\s+/)[0])
    if (!part) {
      return {
        line,
        suggestion: suggest(line.mpn),
        stock: [],
        counted: 0,
        uncounted: 0,
        status: 'missing',
      }
    }
    const stock = inv.stockByPart.get(part.id) ?? []
    const { counted, uncounted } = totalQty(inv, part.id)
    const status: PickStatus =
      stock.length === 0
        ? 'missing'
        : counted >= line.qty
          ? 'have'
          : uncounted > 0
            ? 'uncounted'
            : 'short'
    return { line, part, stock, counted, uncounted, status }
  })
}
