import type { Location, Part, Project, Stock } from './types'

/** In-memory view of everything that is not deleted, with lookup tables. */
export interface Inventory {
  locations: Location[]
  parts: Part[]
  stock: Stock[]
  projects: Project[]
  locById: Map<string, Location>
  /** Children by parent ID; top-level locations are under null. */
  childrenOf: Map<string | null, Location[]>
  partById: Map<string, Part>
  stockByPart: Map<string, Stock[]>
  stockByLocation: Map<string, Stock[]>
}

export const EMPTY_INVENTORY: Inventory = buildInventory([], [], [], [])

export function buildInventory(
  rawLocations: Location[],
  rawParts: Part[],
  rawStock: Stock[],
  rawProjects: Project[],
): Inventory {
  // Rows can arrive half-filled when a sync is interrupted; skip those.
  const locations = rawLocations
    .filter((l) => typeof l.name === 'string')
    .map((l) => ({ ...l, kind: l.kind ?? 'box', parentId: l.parentId ?? null }))
  const parts = rawParts.map((p) => ({
    ...p,
    specs: p.specs ?? {},
    tags: p.tags ?? [],
  }))
  const stock = rawStock.filter((s) => s.partId && s.locationId)
  const projects = rawProjects
    .filter((p) => typeof p.name === 'string')
    .map((p) => ({ ...p, locationIds: p.locationIds ?? [], bom: p.bom ?? [] }))

  const locById = new Map(locations.map((l) => [l.id, l]))

  // Two devices can move A under B and B under A at the same time. Anything
  // that no longer reaches the top level is shown at the top level instead.
  for (const location of locations) {
    const seen = new Set<string>([location.id])
    let parentId = location.parentId
    while (parentId !== null) {
      const parent = locById.get(parentId)
      if (!parent || seen.has(parentId)) {
        location.parentId = null
        break
      }
      seen.add(parentId)
      parentId = parent.parentId
    }
  }

  const childrenOf = new Map<string | null, Location[]>()
  for (const location of locations) {
    const siblings = childrenOf.get(location.parentId)
    if (siblings) siblings.push(location)
    else childrenOf.set(location.parentId, [location])
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
  }

  const partById = new Map(parts.map((p) => [p.id, p]))
  const stockByPart = groupBy(stock, (s) => s.partId)
  const stockByLocation = groupBy(stock, (s) => s.locationId)

  return {
    locations,
    parts,
    stock,
    projects,
    locById,
    childrenOf,
    partById,
    stockByPart,
    stockByLocation,
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = map.get(k)
    if (group) group.push(item)
    else map.set(k, [item])
  }
  return map
}

/** Locations from the top level down to the given one. */
export function locationPath(inv: Inventory, id: string): Location[] {
  const path: Location[] = []
  let current = inv.locById.get(id)
  while (current && !path.includes(current)) {
    path.unshift(current)
    current = current.parentId ? inv.locById.get(current.parentId) : undefined
  }
  return path
}

/** "Garage > Rack B > Shelf 3 > Box 12" */
export function pathLabel(inv: Inventory, id: string): string {
  const path = locationPath(inv, id)
  if (path.length === 0) return 'Unknown location'
  return path.map((l) => l.name).join(' > ')
}

/** The location itself and everything inside it. */
export function withDescendants(inv: Inventory, id: string): string[] {
  const ids: string[] = []
  const visit = (current: string) => {
    ids.push(current)
    for (const child of inv.childrenOf.get(current) ?? []) visit(child.id)
  }
  visit(id)
  return ids
}

/** Key used to decide whether two part numbers are the same part. */
export function mpnKey(mpn: string | undefined): string {
  return (mpn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function findPartByMpn(inv: Inventory, mpn: string | undefined) {
  const key = mpnKey(mpn)
  if (!key) return undefined
  return inv.parts.find((p) => mpnKey(p.mpn) === key)
}

/** Short human label for a part. */
export function partTitle(part: Part): string {
  return part.mpn || part.description || 'Unnamed part'
}

/** Manufacturer and description shown under the part number. */
export function partSubtitle(part: Part): string {
  return [part.manufacturer, part.mpn ? part.description : undefined].filter(Boolean).join(' · ')
}

/** Part picture, or a bag photo when the part has none. */
export function partPhotoHash(
  part: Pick<Part, 'imageBlob'> | undefined,
  bags: Pick<Stock, 'labelPhotoBlob'>[],
): string | undefined {
  return part?.imageBlob ?? bags.find((bag) => bag.labelPhotoBlob)?.labelPhotoBlob
}

export function formatQty(stock: Stock): string {
  if (typeof stock.qty === 'number') return String(stock.qty)
  if (stock.qtyApprox) return stock.qtyApprox
  return ''
}

/** Total counted quantity of a part, and whether some bags are uncounted. */
export function totalQty(inv: Inventory, partId: string) {
  let counted = 0
  let uncounted = 0
  for (const s of inv.stockByPart.get(partId) ?? []) {
    if (typeof s.qty === 'number') counted += s.qty
    else uncounted += 1
  }
  return { counted, uncounted }
}
