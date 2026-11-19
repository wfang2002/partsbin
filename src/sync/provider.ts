export interface FileInfo {
  /** Path inside the PartsBin folder, with forward slashes. */
  path: string
  size: number
}

/**
 * The only thing PartsBin needs from a cloud storage service: a folder of
 * plain files. Google Drive, Dropbox, Box and a zip archive all implement it.
 */
export interface StorageProvider {
  /** Every file whose path starts with the prefix, in any order. */
  list(prefix: string): Promise<FileInfo[]>
  /** Throws NotFoundError if the file does not exist. */
  read(path: string): Promise<Uint8Array>
  /** Create or replace a file, creating parent folders as needed. */
  write(path: string, data: Uint8Array): Promise<void>
  /** Deleting a file that does not exist is not an error. */
  remove(path: string): Promise<void>
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`)
    this.name = 'NotFoundError'
  }
}

/** A provider kept in memory. Used for zip archives and tests. */
export class MemoryProvider implements StorageProvider {
  readonly files = new Map<string, Uint8Array>()

  async list(prefix: string): Promise<FileInfo[]> {
    const out: FileInfo[] = []
    for (const [path, data] of this.files) {
      if (path.startsWith(prefix)) out.push({ path, size: data.length })
    }
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(path)
    if (!data) throw new NotFoundError(path)
    return data
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
}

/** Run tasks with limited concurrency. */
export async function pooled<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
    }
  })
  await Promise.all(workers)
}
