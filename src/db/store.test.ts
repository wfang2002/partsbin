import { describe, expect, it } from 'vitest'
import { Hlc } from '../sync/hlc'
import { applyFields, mergeRow, type Op } from './merge'
import { Store } from './store'

let counter = 0
const freshStore = (now?: () => number) => Store.open(`test-${counter++}`, now)

describe('Hlc', () => {
  it('is monotonic even when the wall clock stands still or goes back', () => {
    let wall = 1000
    const hlc = new Hlc('aa', undefined, () => wall)
    const a = hlc.tick()
    const b = hlc.tick()
    wall = 500
    const c = hlc.tick()
    expect(a < b && b < c).toBe(true)
  })

  it('moves past timestamps seen from other devices', () => {
    const hlc = new Hlc('aa', undefined, () => 1000)
    const remote = new Hlc('bb', undefined, () => 9000).tick()
    hlc.observe(remote)
    expect(hlc.tick() > remote).toBe(true)
  })

  it('rolls the counter into the next millisecond', () => {
    const hlc = new Hlc('aa', undefined, () => 1)
    let prev = hlc.tick()
    for (let i = 0; i < 70_000; i++) {
      const next = hlc.tick()
      if (next <= prev) throw new Error(`not monotonic at ${i}`)
      prev = next
    }
  })
})

describe('merge', () => {
  it('keeps the newest write per field, in any order', () => {
    const ops: [Record<string, unknown>, string][] = [
      [{ name: 'Box 1', kind: 'box' }, '000000000000001-0000-aa'],
      [{ name: 'Box one' }, '000000000000003-0000-bb'],
      [{ kind: 'compartment' }, '000000000000002-0000-aa'],
    ]
    const run = (order: number[]) => {
      let row
      for (const i of order) row = applyFields(row, 'x', ops[i][0], ops[i][1]).row
      return row
    }
    const expected = run([0, 1, 2])
    expect(expected).toMatchObject({ name: 'Box one', kind: 'compartment' })
    expect(run([2, 1, 0])).toEqual(expected)
    expect(run([1, 0, 2])).toEqual(expected)
  })

  it('clears a field with null but keeps a null parentId', () => {
    const base = applyFields(
      undefined,
      'x',
      { note: 'hi', parentId: 'p' },
      '000000000000001-0000-aa',
    ).row
    const { row } = applyFields(
      base,
      'x',
      { note: null, parentId: null },
      '000000000000002-0000-aa',
    )
    expect('note' in row).toBe(false)
    expect(row.parentId).toBeNull()
  })

  it('merges full rows the same way as individual changes', () => {
    const a = applyFields(
      undefined,
      'x',
      { name: 'A', note: 'old' },
      '000000000000001-0000-aa',
    ).row
    const b = applyFields(a, 'x', { note: null }, '000000000000005-0000-bb').row
    const local = applyFields(a, 'x', { name: 'Local' }, '000000000000009-0000-cc').row
    const { row } = mergeRow(local, b)
    expect(row.name).toBe('Local')
    expect('note' in row).toBe(false)
    expect(mergeRow(row, b).changed).toBe(false)
  })
})

describe('Store', () => {
  it('records every local change as a pending operation', async () => {
    const store = await freshStore()
    await store.put('locations', 'l1', { name: 'Garage', kind: 'room', parentId: null })
    await store.put('locations', 'l1', { name: 'Garage 2' })
    await store.remove('locations', 'l1')
    const ops = await store.db.ops.toArray()
    expect(ops.map((o) => o.f)).toEqual([
      { name: 'Garage', kind: 'room', parentId: null },
      { name: 'Garage 2' },
      { deleted: true },
    ])
    expect(ops[0].h < ops[1].h && ops[1].h < ops[2].h).toBe(true)
    const row = await store.db.locations.get('l1')
    expect(row).toMatchObject({ name: 'Garage 2', deleted: true })
  })

  it('applies remote changes without queueing them for upload', async () => {
    const store = await freshStore()
    const remote: Op[] = [
      { t: 'parts', id: 'p1', h: '000000000000005-0000-zz', f: { mpn: 'NE555' } },
    ]
    expect(await store.applyOps(remote)).toBe(1)
    expect(await store.applyOps(remote)).toBe(0)
    expect(await store.db.ops.count()).toBe(0)
    expect((await store.db.parts.get('p1'))?.mpn).toBe('NE555')
  })

  it('lets a later local edit win over an earlier remote one', async () => {
    const store = await freshStore()
    const future = String(Date.now() + 60_000).padStart(15, '0')
    await store.applyOps([
      { t: 'parts', id: 'p1', h: `${future}-0000-zz`, f: { mpn: 'OLD' } },
    ])
    await store.put('parts', 'p1', { mpn: 'NEW' })
    expect((await store.db.parts.get('p1'))?.mpn).toBe('NEW')
  })

  it('stores blobs by content hash and finds referenced ones', async () => {
    const store = await freshStore()
    const hash = await store.putBlob(new Uint8Array([1, 2, 3]))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await store.getBlob(hash)).toEqual(new Uint8Array([1, 2, 3]))
    await store.put('locations', 'l1', { name: 'A', photoBlob: hash })
    await store.put('locations', 'l2', { name: 'B', photoBlob: 'gone' })
    await store.remove('locations', 'l2')
    expect([...(await store.referencedBlobs())]).toEqual([hash])
  })

  it('keeps its device ID and clock across reopen', async () => {
    const name = `test-${counter++}`
    const first = await Store.open(name)
    await first.put('parts', 'p1', { mpn: 'A' })
    const written = (await first.db.ops.toArray())[0].h
    first.db.close()
    // Even if the wall clock has gone backwards since.
    const second = await Store.open(name, () => 0)
    expect(second.deviceId).toBe(first.deviceId)
    expect(second.timestamp() > written).toBe(true)
  })
})
