import { unzipSync, zipSync } from 'fflate'
import type { Store } from '../db/store'
import { exportLibrary, importLibrary, type SyncReport } from './engine'
import { MemoryProvider } from './provider'

/** Pack a provider's files into a zip archive. */
export function toZip(provider: MemoryProvider): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, data] of provider.files) entries[path] = data
  // Photos are already compressed; store everything without recompressing.
  return zipSync(entries, { level: 0 })
}

export function fromZip(zip: Uint8Array): MemoryProvider {
  const provider = new MemoryProvider()
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch {
    throw new Error('This file is not a zip archive.')
  }
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    provider.files.set(path, data)
  }
  return provider
}

/** A backup of the whole library as one zip file. */
export async function exportZip(
  store: Store,
): Promise<{ zip: Uint8Array; blobs: number; blobsMissing: number }> {
  const provider = new MemoryProvider()
  const counts = await exportLibrary(store, provider)
  return { zip: toZip(provider), ...counts }
}

/** Merge a zip backup into the local library. */
export async function importZip(
  store: Store,
  zip: Uint8Array,
): Promise<SyncReport> {
  return importLibrary(store, fromZip(zip))
}
