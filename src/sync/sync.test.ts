import { describe, expect, it } from 'vitest'
import { Store } from '../db/store'
import { TABLE_NAMES } from '../domain/types'
import { utf8 } from '../util/crypto'
import { blobPath, syncOnce } from './engine'
import { migrate } from './migrate'
import { MemoryProvider, NotFoundError, type StorageProvider } from './provider'
import { exportZip, fromZip, importZip } from './zip'

let counter = 0
// One shared clock that advances on every reading, so "later" in a test
// always means a later timestamp, whichever device makes the change.
let clock = 1_800_000_000_000
const device = () => Store.open(`sync-test-${counter++}`, () => clock++)

/** Live rows of every table, without merge metadata, in a stable order. */
async function state(store: Store) {
  const out: Record<string, unknown[]> = {}
  for (const table of TABLE_NAMES) {
    const rows = await store.db.rows(table).toArray()
    out[table] = rows
      .filter((r) => !r.deleted)
      .map(({ _clocks, deleted: _deleted, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  return out
}

const paths = (cloud: MemoryProvider, prefix = '') =>
  [...cloud.files.keys()].filter((p) => p.startsWith(prefix)).sort()

async function seed(store: Store) {
  await store.write([
    { table: 'locations', id: 'garage', fields: { name: 'Garage', kind: 'room', parentId: null } },
    { table: 'locations', id: 'box1', fields: { name: 'Box 1', kind: 'box', parentId: 'garage' } },
    { table: 'parts', id: 'ne555', fields: { mpn: 'NE555P', specs: {}, tags: ['timer'] } },
    { table: 'stock', id: 's1', fields: { partId: 'ne555', locationId: 'box1', qty: 10, lastSeenAt: 1 } },
  ])
}

describe('syncOnce', () => {
  it('carries changes between two devices in both directions', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()

    await seed(phone)
    const first = await syncOnce(phone, cloud)
    expect(first.opsPushed).toBe(4)
    expect(await phone.db.ops.count()).toBe(0)

    const pulled = await syncOnce(desktop, cloud)
    expect(pulled.rowsChanged).toBe(4)
    expect(await state(desktop)).toEqual(await state(phone))

    await desktop.put('stock', 's1', { qty: 7 })
    await desktop.put('locations', 'box2', { name: 'Box 2', kind: 'box', parentId: 'garage' })
    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)
    expect(await state(phone)).toEqual(await state(desktop))
    expect((await phone.db.stock.get('s1'))?.qty).toBe(7)
  })

  it('merges edits to different fields of the same record', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud)

    // Both edit the same part while offline.
    await phone.put('parts', 'ne555', { description: 'Timer IC' })
    await desktop.put('parts', 'ne555', { manufacturer: 'Texas Instruments' })
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)

    const expected = {
      mpn: 'NE555P',
      description: 'Timer IC',
      manufacturer: 'Texas Instruments',
    }
    expect(await phone.db.parts.get('ne555')).toMatchObject(expected)
    expect(await desktop.db.parts.get('ne555')).toMatchObject(expected)
  })

  it('lets the later edit of the same field win on both devices', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud)

    await phone.put('stock', 's1', { qty: 5 })
    await desktop.put('stock', 's1', { qty: 3 })
    // Sync in the "wrong" order: the earlier edit arrives last.
    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud)
    expect((await phone.db.stock.get('s1'))?.qty).toBe(3)
    expect((await desktop.db.stock.get('s1'))?.qty).toBe(3)
  })

  it('propagates deletes', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud)
    await desktop.remove('stock', 's1')
    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)
    expect((await state(phone)).stock).toEqual([])
  })

  it('writes nothing when there is nothing to do', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    const before = paths(cloud)
    const report = await syncOnce(phone, cloud)
    expect(paths(cloud)).toEqual(before)
    expect(report).toMatchObject({ opsPushed: 0, rowsChanged: 0, snapshotWritten: false })
  })

  it('exchanges photos and reports ones that cannot be found', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    const photo = new Uint8Array([9, 8, 7, 6])
    const hash = await phone.putBlob(photo)
    await phone.putBlob(new Uint8Array([1])) // not referenced: stays local
    await phone.put('locations', 'box1', { name: 'Box 1', kind: 'box', parentId: null, photoBlob: hash })
    await phone.put('locations', 'box2', { name: 'Box 2', kind: 'box', parentId: null, photoBlob: 'f'.repeat(64) })

    const up = await syncOnce(phone, cloud)
    expect(up.blobsUploaded).toBe(1)
    expect(up.blobsMissing).toBe(1)
    expect(paths(cloud, 'blobs/')).toEqual([blobPath(hash)])

    const down = await syncOnce(desktop, cloud)
    expect(down.blobsDownloaded).toBe(1)
    expect(await desktop.getBlob(hash)).toEqual(photo)
  })

  it('rejects a photo that was damaged in the cloud', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    const hash = await phone.putBlob(new Uint8Array([1, 2, 3]))
    await phone.put('locations', 'box1', { name: 'Box 1', kind: 'box', parentId: null, photoBlob: hash })
    await syncOnce(phone, cloud)
    cloud.files.set(blobPath(hash), new Uint8Array([6, 6, 6]))
    const report = await syncOnce(desktop, cloud)
    expect(report.blobsDownloaded).toBe(0)
    expect(report.blobsMissing).toBe(1)
    expect(await desktop.getBlob(hash)).toBeUndefined()
  })

  it('compacts logs into a snapshot that new and stale devices both use', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    await syncOnce(desktop, cloud) // desktop is now up to date, then goes offline

    for (let i = 0; i < 5; i++) {
      await phone.put('stock', 's1', { qty: 100 + i })
      await syncOnce(phone, cloud)
    }
    expect(paths(cloud, 'logs/')).toHaveLength(5)
    await phone.remove('locations', 'box1')
    const report = await syncOnce(phone, cloud, { compactAfter: 3 })
    expect(report.snapshotWritten).toBe(true)
    expect(paths(cloud, 'snapshots/')).toHaveLength(1)
    // Every log file is covered by the snapshot and has been removed.
    expect(paths(cloud, 'logs/')).toEqual([])

    // A brand-new device starts from the snapshot alone.
    const tablet = await device()
    await syncOnce(tablet, cloud)
    expect(await state(tablet)).toEqual(await state(phone))
    // Deletes are in the snapshot too.
    expect((await tablet.db.locations.get('box1'))?.deleted).toBe(true)

    // The device that missed the removed log files catches up as well.
    await desktop.put('parts', 'ne555', { description: 'offline edit' })
    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)
    expect(await state(desktop)).toEqual(await state(phone))
    expect((await phone.db.parts.get('ne555'))?.description).toBe('offline edit')
    expect((await desktop.db.stock.get('s1'))?.qty).toBe(104)
  })

  it('never reuses a log file number after compaction', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    for (let i = 0; i < 4; i++) {
      await phone.put('parts', `p${i}`, { mpn: `P${i}`, specs: {}, tags: [] })
      await syncOnce(phone, cloud, { compactAfter: 2 })
    }
    await syncOnce(desktop, cloud)
    await phone.put('parts', 'late', { mpn: 'LATE', specs: {}, tags: [] })
    await syncOnce(phone, cloud, { compactAfter: 100 })
    await syncOnce(desktop, cloud)
    expect((await desktop.db.parts.get('late'))?.mpn).toBe('LATE')
  })

  it('uploads existing local data when joining a library', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)

    // The desktop had its own inventory and had synced it elsewhere before.
    const elsewhere = new MemoryProvider()
    await desktop.put('parts', 'lm358', { mpn: 'LM358', specs: {}, tags: [] })
    await syncOnce(desktop, elsewhere)
    expect(await desktop.db.ops.count()).toBe(0)

    await syncOnce(desktop, cloud)
    await syncOnce(phone, cloud)
    expect((await phone.db.parts.get('lm358'))?.mpn).toBe('LM358')
    expect(await state(phone)).toEqual(await state(desktop))
  })

  it('skips files that disappear between listing and reading', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    await syncOnce(phone, cloud)
    const flaky: StorageProvider = {
      list: (p) => cloud.list(p),
      read: async (path) => {
        if (/^(logs|snapshots)\//.test(path)) throw new NotFoundError(path)
        return cloud.read(path)
      },
      write: (p, d) => cloud.write(p, d),
      remove: (p) => cloud.remove(p),
    }
    const report = await syncOnce(desktop, flaky)
    expect(report.rowsChanged).toBe(0)
    // Nothing was marked as read, so the next sync picks it up.
    expect((await syncOnce(desktop, cloud)).rowsChanged).toBe(4)
  })

  it('refuses a folder written by a newer app version', async () => {
    const cloud = new MemoryProvider()
    cloud.files.set(
      'manifest.json',
      utf8.encode(JSON.stringify({ app: 'partsbin', format: 99, folderId: 'x' })),
    )
    await expect(syncOnce(await device(), cloud)).rejects.toThrow(/newer version/)
  })
})

describe('zip backup', () => {
  it('round-trips the whole library including photos and deletes', async () => {
    const phone = await device()
    await seed(phone)
    const hash = await phone.putBlob(new Uint8Array([4, 2]))
    await phone.put('locations', 'box1', { photoBlob: hash })
    await phone.remove('parts', 'ne555')

    const { zip, blobs, blobsMissing } = await exportZip(phone)
    expect({ blobs, blobsMissing }).toEqual({ blobs: 1, blobsMissing: 0 })
    expect([...fromZip(zip).files.keys()].some((p) => p === 'manifest.json')).toBe(true)
    // Exporting does not disturb pending uploads.
    expect(await phone.db.ops.count()).toBeGreaterThan(0)

    const restored = await device()
    const report = await importZip(restored, zip)
    expect(report.blobsDownloaded).toBe(1)
    expect(await state(restored)).toEqual(await state(phone))
    expect(await restored.getBlob(hash)).toEqual(new Uint8Array([4, 2]))
  })

  it('merges into existing data and re-uploads on the next sync', async () => {
    const cloud = new MemoryProvider()
    const phone = await device()
    const desktop = await device()
    await seed(phone)
    const { zip } = await exportZip(phone)

    await desktop.put('parts', 'lm358', { mpn: 'LM358', specs: {}, tags: [] })
    await syncOnce(desktop, cloud)
    await importZip(desktop, zip)
    expect((await state(desktop)).parts).toHaveLength(2)

    await syncOnce(desktop, cloud)
    const tablet = await device()
    await syncOnce(tablet, cloud)
    expect(await state(tablet)).toEqual(await state(desktop))
  })

  it('rejects files that are not backups', async () => {
    const store = await device()
    await expect(importZip(store, new Uint8Array([1, 2, 3]))).rejects.toThrow(/zip/)
    const other = new MemoryProvider()
    other.files.set('hello.txt', utf8.encode('hi'))
    const { toZip } = await import('./zip')
    await expect(importZip(store, toZip(other))).rejects.toThrow(/not a PartsBin backup/)
  })
})

describe('migrate', () => {
  async function library() {
    const source = new MemoryProvider()
    const phone = await device()
    await seed(phone)
    const hash = await phone.putBlob(new Uint8Array([5, 5, 5]))
    await phone.put('locations', 'box1', { photoBlob: hash })
    await syncOnce(phone, source)
    return { source, phone }
  }

  it('copies every file, verifies it, and leaves the source alone', async () => {
    const { source, phone } = await library()
    const before = new Map(source.files)
    const target = new MemoryProvider()
    const phases = new Set<string>()
    const report = await migrate(source, target, (p) => phases.add(p.phase))

    expect(report.files).toBe(source.files.size)
    expect(target.files).toEqual(source.files)
    expect(source.files).toEqual(before)
    expect([...phases]).toEqual(['copying', 'verifying'])

    // The device carries on with the new storage without re-uploading.
    const after = await syncOnce(phone, target)
    expect(after).toMatchObject({ opsPushed: 0, rowsChanged: 0, snapshotWritten: false })
    await phone.put('stock', 's1', { qty: 1 })
    await syncOnce(phone, target)
    const desktop = await device()
    await syncOnce(desktop, target)
    expect(await state(desktop)).toEqual(await state(phone))
  })

  it('detects a copy that does not match and reports it', async () => {
    const { source } = await library()
    const inner = new MemoryProvider()
    const corrupting: StorageProvider = {
      list: (p) => inner.list(p),
      read: (p) => inner.read(p),
      // Flip the first byte of every photo on the way in.
      write: (p, d) =>
        inner.write(p, p.startsWith('blobs/') ? d.map((b, i) => (i ? b : b ^ 1)) : d),
      remove: (p) => inner.remove(p),
    }
    await expect(migrate(source, corrupting)).rejects.toThrow(/differ/)
  })

  it('detects files that never arrived', async () => {
    const { source } = await library()
    const inner = new MemoryProvider()
    const lossy: StorageProvider = {
      list: (p) => inner.list(p),
      read: (p) => inner.read(p),
      write: async (p, d) => {
        if (!p.startsWith('blobs/')) await inner.write(p, d)
      },
      remove: (p) => inner.remove(p),
    }
    await expect(migrate(source, lossy)).rejects.toThrow(/missing/)
  })

  it('resumes an interrupted copy and repairs stale leftovers', async () => {
    const { source } = await library()
    const target = new MemoryProvider()
    const [first, second] = paths(source).filter((p) => p !== 'manifest.json')
    target.files.set(first, source.files.get(first)!)
    // Same size, wrong content.
    target.files.set(second, source.files.get(second)!.map((b) => b ^ 0xff))
    const report = await migrate(source, target)
    expect(report.skipped).toBe(2)
    expect(target.files).toEqual(source.files)
  })

  it('refuses a target that holds a different library', async () => {
    const { source } = await library()
    const target = new MemoryProvider()
    const other = await device()
    await other.put('parts', 'x', { mpn: 'X', specs: {}, tags: [] })
    await syncOnce(other, target)
    await expect(migrate(source, target)).rejects.toThrow(/different PartsBin library/)
  })

  it('refuses to migrate from an empty source', async () => {
    await expect(migrate(new MemoryProvider(), new MemoryProvider())).rejects.toThrow(
      /does not contain/,
    )
  })
})
