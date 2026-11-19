import {
  BLOB_FIELDS,
  TABLE_NAMES,
  type TableName,
  type TableTypes,
} from '../domain/types'
import { Hlc } from '../sync/hlc'
import { randomHex, sha256Hex } from '../util/crypto'
import { PartsDb } from './db'
import { applyFields, mergeRow, toOpFields, type Op, type Row } from './merge'

export type FieldsOf<T extends TableName> = Partial<Omit<TableTypes[T], 'id'>>

export interface Change<T extends TableName = TableName> {
  table: T
  id: string
  fields: FieldsOf<T> | { deleted: boolean }
}

export type Snapshot = Record<TableName, Row[]>

const DATA_TABLES = TABLE_NAMES

/**
 * All reads and writes of inventory data go through here, so that every local
 * change is timestamped and queued for upload.
 */
export class Store {
  readonly db: PartsDb
  deviceId = ''
  private hlc!: Hlc
  private readonly listeners = new Set<() => void>()

  private constructor(db: PartsDb) {
    this.db = db
  }

  static async open(name = 'partsbin', now?: () => number): Promise<Store> {
    const store = new Store(new PartsDb(name))
    let deviceId = await store.getMeta<string>('deviceId')
    if (!deviceId) {
      deviceId = randomHex(5)
      await store.setMeta('deviceId', deviceId)
    }
    store.deviceId = deviceId
    store.hlc = new Hlc(deviceId, await store.getMeta<string>('hlc'), now)
    return store
  }

  /** Called after every local change; used to schedule a sync. */
  onLocalChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ---- Local writes -------------------------------------------------------

  put<T extends TableName>(table: T, id: string, fields: FieldsOf<T>) {
    return this.write([{ table, id, fields }])
  }

  remove(table: TableName, id: string) {
    return this.write([{ table, id, fields: { deleted: true } }])
  }

  /** Apply several changes atomically. */
  async write(changes: Change[]): Promise<void> {
    if (changes.length === 0) return
    const { db } = this
    await db.transaction(
      'rw',
      [db.locations, db.parts, db.stock, db.projects, db.ops, db.meta],
      async () => {
        const cache = new Map<string, Row | undefined>()
        let last = ''
        for (const change of changes) {
          last = this.hlc.tick()
          const fields = toOpFields(change.fields as Record<string, unknown>)
          const key = `${change.table}:${change.id}`
          const existing = cache.has(key)
            ? cache.get(key)
            : await db.rows(change.table).get(change.id)
          const { row } = applyFields(existing, change.id, fields, last)
          cache.set(key, row)
          await db.rows(change.table).put(row)
          await db.ops.add({ t: change.table, id: change.id, h: last, f: fields })
        }
        await db.meta.put({ key: 'hlc', value: last })
      },
    )
    for (const listener of this.listeners) listener()
  }

  // ---- Merging remote data ------------------------------------------------

  /** Merge changes made on other devices. Returns how many rows changed. */
  async applyOps(ops: Op[]): Promise<number> {
    if (ops.length === 0) return 0
    const { db } = this
    let changedCount = 0
    await db.transaction(
      'rw',
      [db.locations, db.parts, db.stock, db.projects, db.meta],
      async () => {
        const cache = new Map<string, Row | undefined>()
        const dirty = new Map<string, { table: TableName; row: Row }>()
        for (const op of ops) {
          this.hlc.observe(op.h)
          const key = `${op.t}:${op.id}`
          const existing = cache.has(key)
            ? cache.get(key)
            : await db.rows(op.t).get(op.id)
          const { row, changed } = applyFields(existing, op.id, op.f, op.h)
          cache.set(key, row)
          if (changed) dirty.set(key, { table: op.t, row })
        }
        for (const { table, row } of dirty.values()) {
          await db.rows(table).put(row)
        }
        changedCount = dirty.size
        await db.meta.put({ key: 'hlc', value: this.hlc.tick() })
      },
    )
    return changedCount
  }

  /** Merge full rows from a snapshot. Returns how many rows changed. */
  async mergeSnapshot(snapshot: Partial<Snapshot>): Promise<number> {
    const { db } = this
    let changedCount = 0
    await db.transaction(
      'rw',
      [db.locations, db.parts, db.stock, db.projects, db.meta],
      async () => {
        for (const table of DATA_TABLES) {
          const incoming = snapshot[table] ?? []
          if (incoming.length === 0) continue
          const existing = await db.rows(table).bulkGet(incoming.map((r) => r.id))
          const updates: Row[] = []
          incoming.forEach((remote, i) => {
            for (const hlc of Object.values(remote._clocks)) this.hlc.observe(hlc)
            const { row, changed } = mergeRow(existing[i], remote)
            if (changed) updates.push(row)
          })
          await db.rows(table).bulkPut(updates)
          changedCount += updates.length
        }
        await db.meta.put({ key: 'hlc', value: this.hlc.tick() })
      },
    )
    return changedCount
  }

  /** Every row, tombstones included, plus the newest pending-change number. */
  async dump(): Promise<{ snapshot: Snapshot; lastOp: number }> {
    const { db } = this
    return db.transaction(
      'r',
      [db.locations, db.parts, db.stock, db.projects, db.ops],
      async () => {
        const snapshot = {} as Snapshot
        for (const table of DATA_TABLES) {
          snapshot[table] = await db.rows(table).toArray()
        }
        const lastOp = (await db.ops.orderBy('n').last())?.n ?? 0
        return { snapshot, lastOp }
      },
    )
  }

  /** Blob hashes referenced by rows that are not deleted. */
  async referencedBlobs(): Promise<Set<string>> {
    const refs = new Set<string>()
    for (const table of DATA_TABLES) {
      const fields = BLOB_FIELDS[table]
      if (fields.length === 0) continue
      await this.db.rows(table).each((row) => {
        if (row.deleted) return
        for (const field of fields) {
          const hash = (row as Record<string, unknown>)[field]
          if (typeof hash === 'string' && hash) refs.add(hash)
        }
      })
    }
    return refs
  }

  timestamp(): string {
    return this.hlc.tick()
  }

  // ---- Blobs --------------------------------------------------------------

  async putBlob(data: Uint8Array): Promise<string> {
    const hash = await sha256Hex(data)
    await this.db.blobs.put({ hash, data })
    return hash
  }

  async getBlob(hash: string): Promise<Uint8Array | undefined> {
    return (await this.db.blobs.get(hash))?.data
  }

  // ---- Device-local settings ---------------------------------------------

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value })
  }
}
