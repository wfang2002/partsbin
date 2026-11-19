import type { Change, Store } from '../db/store'
import { newId } from '../util/crypto'
import {
  findPartByMpn,
  withDescendants,
  type Inventory,
} from './inventory'
import type {
  BomLine,
  Location,
  LocationKind,
  Part,
  Project,
  QtyApprox,
  Stock,
} from './types'

/*
 * Every change the UI can make to the inventory. Cascading deletes are
 * written as one batch so they reach other devices together.
 */

export async function createLocation(
  store: Store,
  fields: { name: string; kind: LocationKind; parentId: string | null },
): Promise<string> {
  const id = newId()
  await store.put('locations', id, fields)
  return id
}

export function updateLocation(
  store: Store,
  id: string,
  fields: Partial<Omit<Location, 'id'>>,
) {
  return store.put('locations', id, fields)
}

/** True if `targetId` is the location itself or inside it. */
export function isInside(inv: Inventory, targetId: string | null, id: string) {
  return targetId !== null && withDescendants(inv, id).includes(targetId)
}

export async function moveLocation(
  store: Store,
  inv: Inventory,
  id: string,
  parentId: string | null,
) {
  if (isInside(inv, parentId, id)) {
    throw new Error('A location cannot be moved into itself.')
  }
  await store.put('locations', id, { parentId })
}

/** What deleting a location would remove, for the confirmation message. */
export function locationContents(inv: Inventory, id: string) {
  const ids = withDescendants(inv, id)
  const stock = ids.flatMap((l) => inv.stockByLocation.get(l) ?? [])
  return { locations: ids.length - 1, stock: stock.length }
}

/** Delete a location, everything inside it, and the stock stored there. */
export async function deleteLocation(store: Store, inv: Inventory, id: string) {
  const changes: Change[] = []
  for (const locationId of withDescendants(inv, id)) {
    for (const stock of inv.stockByLocation.get(locationId) ?? []) {
      changes.push({ table: 'stock', id: stock.id, fields: { deleted: true } })
    }
    changes.push({ table: 'locations', id: locationId, fields: { deleted: true } })
  }
  await store.write(changes)
}

export type PartFields = Partial<Omit<Part, 'id'>>

export async function createPart(store: Store, fields: PartFields): Promise<string> {
  const id = newId()
  await store.put('parts', id, { specs: {}, tags: [], ...fields })
  return id
}

export function updatePart(store: Store, id: string, fields: PartFields) {
  return store.put('parts', id, fields)
}

/** Delete a part and every bag of it. */
export async function deletePart(store: Store, inv: Inventory, id: string) {
  const changes: Change[] = (inv.stockByPart.get(id) ?? []).map((s) => ({
    table: 'stock',
    id: s.id,
    fields: { deleted: true },
  }))
  changes.push({ table: 'parts', id, fields: { deleted: true } })
  await store.write(changes)
}

export interface StockFields {
  partId: string
  locationId: string
  qty?: number
  qtyApprox?: QtyApprox
  labelPhotoBlob?: string
}

export async function addStock(store: Store, fields: StockFields): Promise<string> {
  const id = newId()
  await store.put('stock', id, { ...fields, lastSeenAt: Date.now() })
  return id
}

export function updateStock(
  store: Store,
  id: string,
  fields: Partial<Omit<Stock, 'id'>>,
) {
  return store.put('stock', id, { ...fields, lastSeenAt: Date.now() })
}

export function deleteStock(store: Store, id: string) {
  return store.remove('stock', id)
}

/** Move every bag in one location to another (e.g. emptying a box). */
export async function moveAllStock(
  store: Store,
  inv: Inventory,
  fromLocationId: string,
  toLocationId: string,
) {
  await store.write(
    (inv.stockByLocation.get(fromLocationId) ?? []).map((s) => ({
      table: 'stock' as const,
      id: s.id,
      fields: { locationId: toLocationId },
    })),
  )
}

export interface NewBag {
  /** Existing part to add stock to; otherwise a part is found or created. */
  partId?: string
  part: PartFields
  locationId: string
  qty?: number
  qtyApprox?: QtyApprox
  labelPhotoBlob?: string
}

/**
 * Record one bag: reuse the part if this part number is already known
 * (filling in fields it lacks), otherwise create it, then add the stock.
 */
export async function recordBag(
  store: Store,
  inv: Inventory,
  bag: NewBag,
): Promise<{ partId: string; stockId: string; isNewPart: boolean }> {
  const existing = bag.partId
    ? inv.partById.get(bag.partId)
    : findPartByMpn(inv, bag.part.mpn)
  const changes: Change[] = []
  let partId: string
  if (existing) {
    partId = existing.id
    const updates = fillMissing(existing, bag.part)
    if (Object.keys(updates).length > 0) {
      changes.push({ table: 'parts', id: partId, fields: updates })
    }
  } else {
    partId = newId()
    changes.push({
      table: 'parts',
      id: partId,
      fields: { specs: {}, tags: [], ...bag.part },
    })
  }
  const stockId = newId()
  changes.push({
    table: 'stock',
    id: stockId,
    fields: {
      partId,
      locationId: bag.locationId,
      qty: bag.qty,
      qtyApprox: bag.qtyApprox,
      labelPhotoBlob: bag.labelPhotoBlob,
      lastSeenAt: Date.now(),
    },
  })
  await store.write(changes)
  return { partId, stockId, isNewPart: !existing }
}

/** Fields of `incoming` that the existing part does not have yet. */
export function fillMissing(existing: Part, incoming: PartFields): PartFields {
  const updates: PartFields = {}
  const scalar = [
    'mpn',
    'manufacturer',
    'category',
    'description',
    'datasheetUrl',
    'imageBlob',
    'ocrText',
    'source',
  ] as const
  for (const key of scalar) {
    const value = incoming[key]
    if (value && !existing[key]) (updates as Record<string, unknown>)[key] = value
  }
  const newSpecs = Object.entries(incoming.specs ?? {}).filter(
    ([name]) => !(name in existing.specs),
  )
  if (newSpecs.length > 0) {
    updates.specs = { ...existing.specs, ...Object.fromEntries(newSpecs) }
  }
  const newTags = (incoming.tags ?? []).filter((t) => !existing.tags.includes(t))
  if (newTags.length > 0) updates.tags = [...existing.tags, ...newTags]
  return updates
}

export async function createProject(store: Store, name: string): Promise<string> {
  const id = newId()
  await store.put('projects', id, { name, locationIds: [], bom: [] })
  return id
}

export function updateProject(
  store: Store,
  id: string,
  fields: Partial<Omit<Project, 'id'>>,
) {
  return store.put('projects', id, fields)
}

export function deleteProject(store: Store, id: string) {
  return store.remove('projects', id)
}

export type { BomLine }
