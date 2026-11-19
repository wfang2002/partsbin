import { sha256Hex } from '../util/crypto'
import { MANIFEST_PATH, readManifest } from './engine'
import { pooled, type StorageProvider } from './provider'

export interface MigrationProgress {
  phase: 'copying' | 'verifying'
  done: number
  total: number
}

export interface MigrationReport {
  files: number
  bytes: number
  /** Files that were already present and identical in size (a resumed run). */
  skipped: number
}

/**
 * Copy the whole library folder from one storage service to another and
 * prove the copy is complete: every file is read back from the target and
 * its SHA-256 compared with what was read from the source.
 *
 * The source is left untouched. Sync with the source first so that it holds
 * everything from this device.
 */
export async function migrate(
  source: StorageProvider,
  target: StorageProvider,
  onProgress: (progress: MigrationProgress) => void = () => {},
): Promise<MigrationReport> {
  const sourceFiles = await source.list('')
  const sourceManifest = await readManifest(source, sourceFiles)
  if (!sourceManifest) {
    throw new Error('The current storage does not contain a PartsBin library yet.')
  }

  const targetFiles = await target.list('')
  const targetManifest = await readManifest(target, targetFiles)
  if (targetManifest && targetManifest.folderId !== sourceManifest.folderId) {
    throw new Error(
      'The new storage already contains a different PartsBin library. ' +
        'Connect to it directly to merge, or empty its PartsBin folder first.',
    )
  }
  const targetSizes = new Map(targetFiles.map((f) => [f.path, f.size]))

  // The manifest goes last: its presence marks the copy as usable.
  const ordered = [
    ...sourceFiles.filter((f) => f.path !== MANIFEST_PATH),
    ...sourceFiles.filter((f) => f.path === MANIFEST_PATH),
  ]
  const hashes = new Map<string, string>()
  const report: MigrationReport = { files: ordered.length, bytes: 0, skipped: 0 }

  let done = 0
  const total = ordered.length
  onProgress({ phase: 'copying', done, total })
  const copy = async (path: string) => {
    const data = await source.read(path)
    hashes.set(path, await sha256Hex(data))
    report.bytes += data.length
    if (targetSizes.get(path) === data.length) {
      // Left over from an interrupted run; its content is checked below.
      report.skipped += 1
    } else {
      await target.write(path, data)
    }
    done += 1
    onProgress({ phase: 'copying', done, total })
  }
  const body = ordered.filter((f) => f.path !== MANIFEST_PATH)
  await pooled(body, 4, (f) => copy(f.path))
  for (const f of ordered.filter((f) => f.path === MANIFEST_PATH)) {
    await copy(f.path)
  }

  // Verify against a fresh listing and by reading everything back.
  const listed = new Set((await target.list('')).map((f) => f.path))
  const absent = ordered.filter((f) => !listed.has(f.path))
  if (absent.length > 0) {
    throw new Error(
      `${absent.length} file(s) are missing from the new storage after copying, ` +
        `for example ${absent[0].path}. Nothing was switched; try again.`,
    )
  }
  done = 0
  onProgress({ phase: 'verifying', done, total })
  const mismatched: string[] = []
  await pooled(ordered, 4, async ({ path }) => {
    const matches = async () =>
      (await sha256Hex(await target.read(path))) === hashes.get(path)
    if (!(await matches())) {
      // Copy once more before giving up (covers stale leftovers).
      await target.write(path, await source.read(path))
      if (!(await matches())) mismatched.push(path)
    }
    done += 1
    onProgress({ phase: 'verifying', done, total })
  })
  if (mismatched.length > 0) {
    throw new Error(
      `${mismatched.length} file(s) differ between the old and new storage, ` +
        `for example ${mismatched[0]}. Nothing was switched; try again.`,
    )
  }
  return report
}
