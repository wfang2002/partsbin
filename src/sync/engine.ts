import type { Op } from '../db/merge'
import type { Snapshot, Store } from '../db/store'
import { TABLE_NAMES } from '../domain/types'
import { randomHex, sha256Hex, utf8 } from '../util/crypto'
import {
  NotFoundError,
  pooled,
  type FileInfo,
  type StorageProvider,
} from './provider'

/*
 * Layout of the cloud folder:
 *
 *   manifest.json                 identifies the folder
 *   logs/<deviceId>/<n>.jsonl     changes made on one device, in order
 *   snapshots/<timestamp>.json    full state, so new devices start quickly
 *   blobs/<sha256>.jpg            photos
 *
 * A device only ever writes its own log files, so two devices never write
 * the same file. Every device reads and merges everyone else's.
 */

export const MANIFEST_PATH = 'manifest.json'
export const FORMAT = 1

export interface Manifest {
  app: 'partsbin'
  format: number
  /** Changes when the folder is a different library, not a copy of this one. */
  folderId: string
  createdAt: string
}

interface SnapshotFile {
  format: number
  deviceId: string
  hlc: string
  /** Per device, the highest log file number whose changes are included. */
  covers: Record<string, number>
  rows: Snapshot
}

export interface SyncReport {
  /** Rows changed locally by remote data. */
  rowsChanged: number
  /** Local changes uploaded. */
  opsPushed: number
  blobsUploaded: number
  blobsDownloaded: number
  /** Photos referenced by the data but found neither here nor in the cloud. */
  blobsMissing: number
  snapshotWritten: boolean
}

export interface SyncOptions {
  /** Write a snapshot and tidy up once this many log files exist. */
  compactAfter?: number
  onProgress?: (message: string) => void
}

const LOG_RE = /^logs\/([a-z0-9]+)\/(\d{8})\.jsonl$/
const SNAPSHOT_RE = /^snapshots\/[^/]+\.json$/
const BLOB_RE = /^blobs\/([0-9a-f]{64})\.jpg$/

export const logPath = (deviceId: string, n: number) =>
  `logs/${deviceId}/${String(n).padStart(8, '0')}.jsonl`
export const blobPath = (hash: string) => `blobs/${hash}.jpg`

function emptyReport(): SyncReport {
  return {
    rowsChanged: 0,
    opsPushed: 0,
    blobsUploaded: 0,
    blobsDownloaded: 0,
    blobsMissing: 0,
    snapshotWritten: false,
  }
}

/** Remembers which cloud files have already been merged into this device. */
interface Tracker {
  ingested: Set<string>
  covered: Record<string, number>
  add(path: string): Promise<void>
  forget(paths: string[]): Promise<void>
  setCovered(covered: Record<string, number>): Promise<void>
}

async function persistentTracker(store: Store): Promise<Tracker> {
  const tracker: Tracker = {
    ingested: new Set(await store.db.ingested.toCollection().primaryKeys()),
    covered: (await store.getMeta<Record<string, number>>('sync.covered')) ?? {},
    async add(path) {
      this.ingested.add(path)
      await store.db.ingested.put({ path })
    },
    async forget(paths) {
      for (const path of paths) this.ingested.delete(path)
      await store.db.ingested.bulkDelete(paths)
    },
    async setCovered(covered) {
      this.covered = covered
      await store.setMeta('sync.covered', covered)
    },
  }
  return tracker
}

/** For one-off imports, where nothing needs to be remembered. */
function ephemeralTracker(): Tracker {
  return {
    ingested: new Set(),
    covered: {},
    async add(path) {
      this.ingested.add(path)
    },
    async forget(paths) {
      for (const path of paths) this.ingested.delete(path)
    },
    async setCovered(covered) {
      this.covered = covered
    },
  }
}

async function readOrNull(provider: StorageProvider, path: string) {
  try {
    return await provider.read(path)
  } catch (e) {
    // Another device may have tidied the file away since it was listed.
    if (e instanceof NotFoundError) return null
    throw e
  }
}

function parseJson<T>(data: Uint8Array, path: string): T {
  try {
    return JSON.parse(utf8.decode(data)) as T
  } catch {
    throw new Error(`The file ${path} in the cloud folder is damaged.`)
  }
}

function checkFormat(format: number) {
  if (format > FORMAT) {
    throw new Error(
      'This library was written by a newer version of PartsBin. Update the app on this device.',
    )
  }
}

export async function readManifest(
  provider: StorageProvider,
  files: FileInfo[],
): Promise<Manifest | null> {
  if (!files.some((f) => f.path === MANIFEST_PATH)) return null
  const data = await readOrNull(provider, MANIFEST_PATH)
  if (!data) return null
  const manifest = parseJson<Manifest>(data, MANIFEST_PATH)
  if (manifest.app !== 'partsbin' || !manifest.folderId) {
    throw new Error('The cloud folder does not contain a PartsBin library.')
  }
  checkFormat(manifest.format)
  return manifest
}

async function writeManifest(provider: StorageProvider): Promise<Manifest> {
  const manifest: Manifest = {
    app: 'partsbin',
    format: FORMAT,
    folderId: randomHex(8),
    createdAt: new Date().toISOString(),
  }
  await provider.write(
    MANIFEST_PATH,
    utf8.encode(JSON.stringify(manifest, null, 2)),
  )
  return manifest
}

/** Merge snapshots and other devices' logs that have not been seen yet. */
async function pull(
  store: Store,
  provider: StorageProvider,
  files: FileInfo[],
  tracker: Tracker,
  report: SyncReport,
  /** Own logs are skipped during sync: their changes are already local. */
  skipOwnLogs = true,
): Promise<void> {
  const snapshots = files
    .filter((f) => SNAPSHOT_RE.test(f.path) && !tracker.ingested.has(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const { path } of snapshots) {
    const data = await readOrNull(provider, path)
    if (!data) continue
    const snapshot = parseJson<SnapshotFile>(data, path)
    checkFormat(snapshot.format)
    report.rowsChanged += await store.mergeSnapshot(snapshot.rows)
    const covered = { ...tracker.covered }
    for (const [device, n] of Object.entries(snapshot.covers ?? {})) {
      covered[device] = Math.max(covered[device] ?? 0, n)
    }
    await tracker.setCovered(covered)
    await tracker.add(path)
  }

  const logs = files
    .map((f) => ({ path: f.path, match: LOG_RE.exec(f.path) }))
    .filter(
      (f) =>
        f.match &&
        !(skipOwnLogs && f.match[1] === store.deviceId) &&
        Number(f.match[2]) > (tracker.covered[f.match[1]] ?? 0) &&
        !tracker.ingested.has(f.path),
    )
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const { path } of logs) {
    const data = await readOrNull(provider, path)
    if (!data) continue
    const ops: Op[] = []
    for (const line of utf8.decode(data).split('\n')) {
      if (!line.trim()) continue
      try {
        ops.push(JSON.parse(line) as Op)
      } catch {
        throw new Error(`The file ${path} in the cloud folder is damaged.`)
      }
    }
    report.rowsChanged += await store.applyOps(
      ops.filter((op) => TABLE_NAMES.includes(op.t)),
    )
    await tracker.add(path)
  }
}

function ownChunkMax(files: FileInfo[], deviceId: string): number {
  let max = 0
  for (const f of files) {
    const match = LOG_RE.exec(f.path)
    if (match && match[1] === deviceId) max = Math.max(max, Number(match[2]))
  }
  return max
}

/** Upload local changes as one new log file. */
async function pushPending(
  store: Store,
  provider: StorageProvider,
  files: FileInfo[],
  tracker: Tracker,
): Promise<number> {
  const pending = await store.db.ops.orderBy('n').toArray()
  if (pending.length === 0) return 0
  // Never reuse a file number: other devices skip files they have read.
  const next =
    Math.max(
      ownChunkMax(files, store.deviceId),
      tracker.covered[store.deviceId] ?? 0,
      (await store.getMeta<number>('sync.lastChunk')) ?? 0,
    ) + 1
  const path = logPath(store.deviceId, next)
  const body = utf8.encode(
    pending
      .map(({ t, id, h, f }) => JSON.stringify({ t, id, h, f }))
      .join('\n') + '\n',
  )
  await provider.write(path, body)
  await store.setMeta('sync.lastChunk', next)
  await store.db.ops.bulkDelete(pending.map((op) => op.n!))
  files.push({ path, size: body.length })
  return pending.length
}

/**
 * Write the full local state as a snapshot. With `prune`, also delete the
 * log files and older snapshots that the new snapshot makes redundant.
 */
async function writeSnapshot(
  store: Store,
  provider: StorageProvider,
  files: FileInfo[],
  tracker: Tracker,
  options: { prune: boolean; dropPending: boolean },
): Promise<void> {
  const { snapshot, lastOp } = await store.dump()
  const hlc = store.timestamp()

  // What this snapshot includes: all of this device's own log files, and for
  // other devices every file up to the first one not yet merged.
  const covers: Record<string, number> = { ...tracker.covered }
  const devices = new Set(Object.keys(covers))
  for (const f of files) {
    const match = LOG_RE.exec(f.path)
    if (match) devices.add(match[1])
  }
  for (const device of devices) {
    let n = covers[device] ?? 0
    if (device === store.deviceId) {
      n = Math.max(n, ownChunkMax(files, device))
    } else {
      while (tracker.ingested.has(logPath(device, n + 1))) n += 1
    }
    if (n > 0) covers[device] = n
  }

  const file: SnapshotFile = {
    format: FORMAT,
    deviceId: store.deviceId,
    hlc,
    covers,
    rows: snapshot,
  }
  const path = `snapshots/${hlc}.json`
  const body = utf8.encode(JSON.stringify(file))
  await provider.write(path, body)
  await tracker.add(path)
  if (options.dropPending) {
    // Changes made up to the dump are in the snapshot; no need to upload them.
    await store.db.ops.where('n').belowOrEqual(lastOp).delete()
  }

  if (options.prune) {
    // Only files this device has fully merged are removed, so their content
    // is guaranteed to be in the snapshot just written.
    const redundant: string[] = []
    for (const f of files) {
      const match = LOG_RE.exec(f.path)
      if (match && Number(match[2]) <= (covers[match[1]] ?? 0)) {
        redundant.push(f.path)
      } else if (SNAPSHOT_RE.test(f.path) && tracker.ingested.has(f.path)) {
        redundant.push(f.path)
      }
    }
    await tracker.setCovered(covers)
    await pooled(redundant, 4, (p) => provider.remove(p))
    await tracker.forget(redundant.filter((p) => p !== path))
    for (const p of redundant) {
      const i = files.findIndex((f) => f.path === p)
      if (i >= 0) files.splice(i, 1)
    }
  }
  files.push({ path, size: body.length })
}

async function uploadBlobs(
  store: Store,
  provider: StorageProvider,
  files: FileInfo[],
  report: SyncReport,
): Promise<void> {
  const remote = remoteBlobs(files)
  const referenced = await store.referencedBlobs()
  const local = new Set(await store.db.blobs.toCollection().primaryKeys())
  // A matching name is not enough. An older iPhone build uploaded photos as
  // text, so the cloud file can be larger than the JPEG it was named for.
  const toUpload = [...referenced].filter((h) => local.has(h))
  await pooled(toUpload, 3, async (hash) => {
    const data = await store.getBlob(hash)
    if (!data) return
    if (remote.get(hash) === data.length) return
    await provider.write(blobPath(hash), data)
    const path = blobPath(hash)
    const info = files.find((f) => f.path === path)
    if (info) info.size = data.length
    else files.push({ path, size: data.length })
    remote.set(hash, data.length)
    report.blobsUploaded += 1
  })
}

async function downloadBlobs(
  store: Store,
  provider: StorageProvider,
  files: FileInfo[],
  report: SyncReport,
): Promise<void> {
  const remote = remoteBlobs(files)
  const referenced = await store.referencedBlobs()
  const local = new Set(await store.db.blobs.toCollection().primaryKeys())
  const wanted = [...referenced].filter((h) => !local.has(h))
  report.blobsMissing = wanted.filter((h) => !remote.has(h)).length
  await pooled(
    wanted.filter((h) => remote.has(h)),
    3,
    async (hash) => {
      const data = await readOrNull(provider, blobPath(hash))
      // Photos are named by their hash, so damage in transit is detectable.
      if (!data || (await sha256Hex(data)) !== hash) {
        report.blobsMissing += 1
        return
      }
      await store.db.blobs.put({ hash, data })
      report.blobsDownloaded += 1
    },
  )
}

/** Hash to byte size for photos already in the cloud folder. */
function remoteBlobs(files: FileInfo[]): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const f of files) {
    const match = BLOB_RE.exec(f.path)
    if (match) sizes.set(match[1], f.size)
  }
  return sizes
}

async function hasRows(store: Store): Promise<boolean> {
  for (const table of TABLE_NAMES) {
    if ((await store.db.rows(table).count()) > 0) return true
  }
  return false
}

/**
 * One full round of sync: merge what other devices wrote, upload what this
 * device changed, and exchange photos. Safe to interrupt and repeat.
 */
export async function syncOnce(
  store: Store,
  provider: StorageProvider,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const report = emptyReport()
  const progress = options.onProgress ?? (() => {})

  progress('Checking the cloud folder')
  const files = await provider.list('')
  let manifest = await readManifest(provider, files)
  if (!manifest) {
    manifest = await writeManifest(provider)
    files.push({ path: MANIFEST_PATH, size: 0 })
  }

  if ((await store.getMeta<string>('sync.folderId')) !== manifest.folderId) {
    // A different library than last time (or the first sync): forget what
    // was merged before, and make sure everything local gets uploaded.
    await store.db.ingested.clear()
    await store.setMeta('sync.covered', {})
    await store.setMeta('sync.lastChunk', 0)
    await store.setMeta('sync.needsFullPush', await hasRows(store))
    await store.setMeta('sync.folderId', manifest.folderId)
  }
  const tracker = await persistentTracker(store)

  progress('Downloading changes')
  await pull(store, provider, files, tracker, report)

  progress('Uploading photos')
  await uploadBlobs(store, provider, files, report)

  progress('Uploading changes')
  if (await store.getMeta<boolean>('sync.needsFullPush')) {
    report.opsPushed = await store.db.ops.count()
    await writeSnapshot(store, provider, files, tracker, {
      prune: true,
      dropPending: true,
    })
    await store.setMeta('sync.needsFullPush', false)
    report.snapshotWritten = true
  } else {
    report.opsPushed = await pushPending(store, provider, files, tracker)
    const logCount = files.filter((f) => LOG_RE.test(f.path)).length
    if (logCount > (options.compactAfter ?? 40)) {
      await writeSnapshot(store, provider, files, tracker, {
        prune: true,
        dropPending: false,
      })
      report.snapshotWritten = true
    }
  }

  progress('Downloading photos')
  await downloadBlobs(store, provider, files, report)

  await store.setMeta('sync.lastSyncAt', Date.now())
  return report
}

/**
 * Write a complete, self-contained copy of the local library to an empty
 * provider (used for zip backups). The copy gets its own folder ID so that
 * devices treat a restored backup as a separate library and re-upload.
 */
export async function exportLibrary(
  store: Store,
  provider: StorageProvider,
): Promise<{ blobs: number; blobsMissing: number }> {
  await writeManifest(provider)
  await writeSnapshot(store, provider, [], ephemeralTracker(), {
    prune: false,
    dropPending: false,
  })
  let blobs = 0
  let blobsMissing = 0
  for (const hash of await store.referencedBlobs()) {
    const data = await store.getBlob(hash)
    if (data) {
      await provider.write(blobPath(hash), data)
      blobs += 1
    } else {
      blobsMissing += 1
    }
  }
  return { blobs, blobsMissing }
}

/**
 * Merge a library (a zip backup) into the local one. Nothing local is
 * replaced unless the imported copy has a newer edit of the same field.
 */
export async function importLibrary(
  store: Store,
  provider: StorageProvider,
): Promise<SyncReport> {
  const report = emptyReport()
  const files = await provider.list('')
  const manifest = await readManifest(provider, files)
  if (!manifest) {
    throw new Error('This file is not a PartsBin backup.')
  }
  // Read every file, including logs written under this device's own ID.
  await pull(store, provider, files, ephemeralTracker(), report, false)
  await downloadBlobs(store, provider, files, report)
  if (report.rowsChanged > 0) {
    // The merged rows did not come from this device's own change log, so the
    // next sync must upload the full state.
    await store.setMeta('sync.needsFullPush', true)
  }
  return report
}
