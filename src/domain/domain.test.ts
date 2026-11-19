import { beforeEach, describe, expect, it } from 'vitest'
import type { Row } from '../db/merge'
import { Store } from '../db/store'
import {
  addStock,
  createLocation,
  createPart,
  createProject,
  deleteLocation,
  deletePart,
  locationContents,
  moveAllStock,
  moveLocation,
  recordBag,
  updateStock,
} from './actions'
import { buildInventory, pathLabel, totalQty, type Inventory } from './inventory'
import { buildPickList } from './picklist'
import type { Location, Part, Project, Stock } from './types'

let dbCount = 0
let store: Store

async function inventory(): Promise<Inventory> {
  const live = <T>(rows: Row<T>[]) => rows.filter((r) => !r.deleted) as T[]
  return buildInventory(
    live<Location>(await store.db.locations.toArray()),
    live<Part>(await store.db.parts.toArray()),
    live<Stock>(await store.db.stock.toArray()),
    live<Project>(await store.db.projects.toArray()),
  )
}

beforeEach(async () => {
  store = await Store.open(`domain-test-${dbCount++}`)
})

describe('locations', () => {
  it('shows the full path of a nested place', async () => {
    const garage = await createLocation(store, { name: 'Garage', kind: 'room', parentId: null })
    const rack = await createLocation(store, { name: 'Rack B', kind: 'rack', parentId: garage })
    const box = await createLocation(store, { name: 'Box 12', kind: 'box', parentId: rack })
    expect(pathLabel(await inventory(), box)).toBe('Garage > Rack B > Box 12')
  })

  it('refuses to move a place into itself or into something inside it', async () => {
    const rack = await createLocation(store, { name: 'Rack', kind: 'rack', parentId: null })
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: rack })
    const inv = await inventory()
    await expect(moveLocation(store, inv, rack, box)).rejects.toThrow(/into itself/)
    await expect(moveLocation(store, inv, rack, rack)).rejects.toThrow(/into itself/)
  })

  it('moves a place together with its contents', async () => {
    const garage = await createLocation(store, { name: 'Garage', kind: 'room', parentId: null })
    const office = await createLocation(store, { name: 'Office', kind: 'room', parentId: null })
    const box = await createLocation(store, { name: 'Box 1', kind: 'box', parentId: garage })
    await moveLocation(store, await inventory(), box, office)
    expect(pathLabel(await inventory(), box)).toBe('Office > Box 1')
  })

  it('deletes a place with everything inside, but keeps the parts', async () => {
    const rack = await createLocation(store, { name: 'Rack', kind: 'rack', parentId: null })
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: rack })
    const other = await createLocation(store, { name: 'Other', kind: 'box', parentId: null })
    const part = await createPart(store, { mpn: 'NE555P' })
    await addStock(store, { partId: part, locationId: box, qty: 5 })
    await addStock(store, { partId: part, locationId: other, qty: 2 })

    let inv = await inventory()
    expect(locationContents(inv, rack)).toEqual({ locations: 1, stock: 1 })
    await deleteLocation(store, inv, rack)

    inv = await inventory()
    expect(inv.locations.map((l) => l.name)).toEqual(['Other'])
    expect(inv.parts).toHaveLength(1)
    expect(inv.stock.map((s) => s.locationId)).toEqual([other])
  })
})

describe('stock', () => {
  it('records a new part with its first bag', async () => {
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: null })
    const result = await recordBag(store, await inventory(), {
      part: { mpn: 'LM358DR', description: 'Dual op amp' },
      locationId: box,
      qty: 25,
    })
    expect(result.isNewPart).toBe(true)
    const inv = await inventory()
    expect(inv.partById.get(result.partId)).toMatchObject({
      mpn: 'LM358DR',
      specs: {},
      tags: [],
    })
    expect(totalQty(inv, result.partId)).toEqual({ counted: 25, uncounted: 0 })
  })

  it('adds a second bag to the same part when the part number matches', async () => {
    const a = await createLocation(store, { name: 'A', kind: 'box', parentId: null })
    const b = await createLocation(store, { name: 'B', kind: 'box', parentId: null })
    const first = await recordBag(store, await inventory(), {
      part: { mpn: 'LM358DR', description: 'My own note', specs: { Package: 'SOIC-8' } },
      locationId: a,
      qty: 10,
    })
    // The same part number written differently, with more details.
    const second = await recordBag(store, await inventory(), {
      part: {
        mpn: 'lm358-dr',
        description: 'Distributor text',
        manufacturer: 'Texas Instruments',
        specs: { Package: 'ignored', Channels: '2' },
      },
      locationId: b,
      qtyApprox: 'few',
    })

    expect(second).toMatchObject({ partId: first.partId, isNewPart: false })
    const inv = await inventory()
    expect(inv.parts).toHaveLength(1)
    // Details the part lacked are filled in; existing ones are kept.
    expect(inv.parts[0]).toMatchObject({
      mpn: 'LM358DR',
      description: 'My own note',
      manufacturer: 'Texas Instruments',
      specs: { Package: 'SOIC-8', Channels: '2' },
    })
    expect(totalQty(inv, first.partId)).toEqual({ counted: 10, uncounted: 1 })
  })

  it('clears the count when a bag is changed to a rough amount', async () => {
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: null })
    const part = await createPart(store, { mpn: 'X' })
    const stock = await addStock(store, { partId: part, locationId: box, qty: 5 })
    await updateStock(store, stock, { qty: undefined, qtyApprox: 'many' })
    const [bag] = (await inventory()).stock
    expect(bag.qty ?? undefined).toBeUndefined()
    expect(bag.qtyApprox).toBe('many')
  })

  it('moves every bag from one box to another', async () => {
    const a = await createLocation(store, { name: 'A', kind: 'box', parentId: null })
    const b = await createLocation(store, { name: 'B', kind: 'box', parentId: null })
    const part = await createPart(store, { mpn: 'X' })
    await addStock(store, { partId: part, locationId: a, qty: 1 })
    await addStock(store, { partId: part, locationId: a, qty: 2 })
    await moveAllStock(store, await inventory(), a, b)
    const inv = await inventory()
    expect(inv.stockByLocation.get(a)).toBeUndefined()
    expect(inv.stockByLocation.get(b)).toHaveLength(2)
  })

  it('deletes a part together with its bags', async () => {
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: null })
    const part = await createPart(store, { mpn: 'X' })
    await addStock(store, { partId: part, locationId: box, qty: 1 })
    await deletePart(store, await inventory(), part)
    const inv = await inventory()
    expect(inv.parts).toHaveLength(0)
    expect(inv.stock).toHaveLength(0)
  })
})

describe('pick list', () => {
  it('reports what is in stock, short, uncounted and missing', async () => {
    const box = await createLocation(store, { name: 'Box', kind: 'box', parentId: null })
    const inv0 = await inventory()
    await recordBag(store, inv0, { part: { mpn: 'ATMEGA328P-AU' }, locationId: box, qty: 3 })
    await recordBag(store, inv0, { part: { mpn: 'LM358DR' }, locationId: box, qty: 1 })
    await recordBag(store, inv0, { part: { mpn: 'BSS138' }, locationId: box, qtyApprox: 'many' })
    await createPart(store, { mpn: 'NE555P' })
    const loose = await createPart(store, { description: '10k 0603' })
    await addStock(store, { partId: loose, locationId: box, qty: 100 })
    await createProject(store, 'Clock')

    const inv = await inventory()
    const similar = inv.partById.get(loose)
    const picks = buildPickList(
      inv,
      [
        { mpn: 'ATmega328P-AU TQFP-32', qty: 1 },
        { mpn: 'LM358DR', qty: 4 },
        { mpn: 'BSS138', qty: 2 },
        { mpn: 'NE555P', qty: 1 },
        { mpn: '10k 0603', qty: 10 },
        { mpn: 'whatever', qty: 1, partId: loose },
      ],
      (text) => (text === '10k 0603' ? similar : undefined),
    )

    expect(picks.map((p) => p.status)).toEqual([
      'have',
      'short',
      'uncounted',
      'missing',
      'missing',
      'have',
    ])
    expect(picks[0].part?.mpn).toBe('ATMEGA328P-AU')
    expect(picks[1].counted).toBe(1)
    expect(picks[3].part?.mpn).toBe('NE555P')
    // An unknown line gets the similar part as a suggestion, not as a match.
    expect(picks[4].part).toBeUndefined()
    expect(picks[4].suggestion?.id).toBe(loose)
    expect(picks[5].part?.id).toBe(loose)
  })
})
