import type { TableName } from '../domain/types'

/** Timestamp of the last write to each field. */
export type Clocks = Record<string, string>

/** A stored record: the domain fields plus merge metadata. */
export type Row<T = Record<string, unknown>> = T & {
  id: string
  _clocks: Clocks
  /** Tombstone. Deleted rows are kept so the delete can reach other devices. */
  deleted?: boolean
}

/**
 * One change to one row. `f` holds only the fields that changed; null means
 * "cleared". A delete is `{ deleted: true }`.
 */
export interface Op {
  t: TableName
  id: string
  h: string
  f: Record<string, unknown>
}

/** Fields where null is a real value rather than "cleared". */
const KEEP_NULL = new Set(['parentId'])
const RESERVED = new Set(['id', '_clocks'])

type AnyRow = Row<Record<string, unknown>>

/**
 * Apply one change, field by field: a field is taken only if its timestamp is
 * newer than the one already stored (last writer wins per field).
 */
export function applyFields(
  existing: AnyRow | undefined,
  id: string,
  fields: Record<string, unknown>,
  hlc: string,
): { row: AnyRow; changed: boolean } {
  const row: AnyRow = existing
    ? { ...existing, _clocks: { ...existing._clocks } }
    : { id, _clocks: {} }
  let changed = !existing
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key)) continue
    const current = row._clocks[key]
    if (current !== undefined && current >= hlc) continue
    setField(row, key, value)
    row._clocks[key] = hlc
    changed = true
  }
  return { row, changed }
}

/** Merge a full remote row (from a snapshot) into the local one. */
export function mergeRow(
  existing: AnyRow | undefined,
  remote: AnyRow,
): { row: AnyRow; changed: boolean } {
  const row: AnyRow = existing
    ? { ...existing, _clocks: { ...existing._clocks } }
    : { id: remote.id, _clocks: {} }
  let changed = !existing
  for (const [key, hlc] of Object.entries(remote._clocks)) {
    const current = row._clocks[key]
    if (current !== undefined && current >= hlc) continue
    setField(row, key, key in remote ? remote[key] : null)
    row._clocks[key] = hlc
    changed = true
  }
  return { row, changed }
}

function setField(row: AnyRow, key: string, value: unknown) {
  if (value === undefined || (value === null && !KEEP_NULL.has(key))) {
    delete row[key]
  } else {
    row[key] = value
  }
}

/** Turn undefined into null so a cleared field survives JSON. */
export function toOpFields(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key)) continue
    out[key] = value === undefined ? null : value
  }
  return out
}
