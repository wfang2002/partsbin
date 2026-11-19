import Dexie, { type Table } from 'dexie'
import type { TableName, TableTypes } from '../domain/types'
import type { Op, Row } from './merge'

export interface PendingOp extends Op {
  /** Local sequence number, assigned by the database. */
  n?: number
}

export interface BlobRecord {
  hash: string
  data: Uint8Array
}

export interface MetaRecord {
  key: string
  value: unknown
}

/**
 * The on-device database. It is a cache of the cloud folder plus the changes
 * that have not been uploaded yet, so it can always be rebuilt from the cloud.
 */
export class PartsDb extends Dexie {
  locations!: Table<Row<TableTypes['locations']>, string>
  parts!: Table<Row<TableTypes['parts']>, string>
  stock!: Table<Row<TableTypes['stock']>, string>
  projects!: Table<Row<TableTypes['projects']>, string>
  /** Local changes waiting to be uploaded. */
  ops!: Table<PendingOp, number>
  blobs!: Table<BlobRecord, string>
  /** Device-local settings and sync bookkeeping. Never synced. */
  meta!: Table<MetaRecord, string>
  /** Cloud files whose contents have already been merged in. */
  ingested!: Table<{ path: string }, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      locations: 'id',
      parts: 'id',
      stock: 'id',
      projects: 'id',
      ops: '++n',
      blobs: 'hash',
      meta: 'key',
      ingested: 'path',
    })
  }

  rows(table: TableName): Table<Row, string> {
    return this.table(table)
  }
}
