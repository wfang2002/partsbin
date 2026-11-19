import type { Fetch, OAuthService } from '../oauth'
import { NotFoundError, pooled, type FileInfo, type StorageProvider } from '../provider'
import { basename, concatBytes, dirname, expectOk, newBoundary } from './http'

export const BOX_OAUTH: OAuthService = {
  authUrl: 'https://account.box.com/api/oauth2/authorize',
  tokenUrl: 'https://api.box.com/oauth2/token',
  // Scopes are fixed in the Box Developer Console.
  scopes: [],
}

const API = 'https://api.box.com/2.0'
const UPLOAD = 'https://upload.box.com/api/2.0'

interface BoxItem {
  type: 'file' | 'folder' | 'web_link'
  id: string
  name: string
  size?: number
}

interface BoxConflict {
  context_info?: { conflicts?: BoxItem | BoxItem[] }
}

/**
 * Box addresses files by ID, so this class keeps a path-to-ID map built by
 * walking the PartsBin folder. Names are unique within a Box folder.
 */
export class BoxProvider implements StorageProvider {
  private readonly fetch: Fetch
  private readonly rootName: string
  private rootId: Promise<string> | null = null
  private listed = false
  private fileIds = new Map<string, string>()
  private folderIds = new Map<string, string>()
  private creatingFolders = new Map<string, Promise<string>>()

  constructor(fetch: Fetch, rootName = 'PartsBin') {
    this.fetch = fetch
    this.rootName = rootName
  }

  private async children(folderId: string): Promise<BoxItem[]> {
    const items: BoxItem[] = []
    const limit = 1000
    for (let offset = 0; ; offset += limit) {
      const params = new URLSearchParams({
        fields: 'id,name,type,size',
        limit: String(limit),
        offset: String(offset),
      })
      const response = await expectOk(
        await this.fetch(`${API}/folders/${folderId}/items?${params}`),
        'Listing files in Box',
      )
      const page = (await response.json()) as {
        entries: BoxItem[]
        total_count: number
      }
      items.push(...page.entries)
      if (page.entries.length === 0 || offset + limit >= page.total_count) break
    }
    return items
  }

  private conflictId(body: BoxConflict): string | undefined {
    const conflicts = body.context_info?.conflicts
    return Array.isArray(conflicts) ? conflicts[0]?.id : conflicts?.id
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const response = await this.fetch(`${API}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent: { id: parentId } }),
    })
    if (response.status === 409) {
      // Another device created it first.
      const existing = this.conflictId((await response.json()) as BoxConflict)
      if (existing) return existing
    }
    const created = (await (
      await expectOk(response, `Creating the folder ${name} in Box`)
    ).json()) as BoxItem
    return created.id
  }

  private root(): Promise<string> {
    this.rootId ??= (async () => {
      const existing = (await this.children('0')).find(
        (item) => item.type === 'folder' && item.name === this.rootName,
      )
      return existing?.id ?? this.createFolder(this.rootName, '0')
    })()
    this.rootId.catch(() => {
      this.rootId = null
    })
    return this.rootId
  }

  private async ensureFolder(path: string): Promise<string> {
    if (path === '') return this.root()
    const known = this.folderIds.get(path)
    if (known) return known
    let creating = this.creatingFolders.get(path)
    if (!creating) {
      creating = (async () => {
        const parentId = await this.ensureFolder(dirname(path))
        const id = await this.createFolder(basename(path), parentId)
        this.folderIds.set(path, id)
        return id
      })().finally(() => this.creatingFolders.delete(path))
      this.creatingFolders.set(path, creating)
    }
    return creating
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const fileIds = new Map<string, string>()
    const folderIds = new Map<string, string>()
    const out: FileInfo[] = []
    let level = [{ id: await this.root(), path: '' }]
    while (level.length > 0) {
      const next: typeof level = []
      await pooled(level, 4, async (folder) => {
        for (const item of await this.children(folder.id)) {
          const path = folder.path ? `${folder.path}/${item.name}` : item.name
          if (item.type === 'folder') {
            folderIds.set(path, item.id)
            next.push({ id: item.id, path })
          } else if (item.type === 'file') {
            fileIds.set(path, item.id)
            out.push({ path, size: item.size ?? 0 })
          }
        }
      })
      level = next
    }
    this.fileIds = fileIds
    this.folderIds = folderIds
    this.listed = true
    return out.filter((f) => f.path.startsWith(prefix))
  }

  private async idOf(path: string): Promise<string | undefined> {
    if (!this.listed) await this.list('')
    return this.fileIds.get(path)
  }

  async read(path: string): Promise<Uint8Array> {
    let id = await this.idOf(path)
    if (!id) {
      // Another device may have created it since the last listing.
      await this.list('')
      id = this.fileIds.get(path)
    }
    if (!id) throw new NotFoundError(path)
    const response = await this.fetch(`${API}/files/${id}/content`)
    if (response.status === 404) {
      this.fileIds.delete(path)
      throw new NotFoundError(path)
    }
    await expectOk(response, `Downloading ${path} from Box`)
    return new Uint8Array(await response.arrayBuffer())
  }

  private upload(url: string, attributes: object | null, name: string, data: Uint8Array) {
    const boundary = newBoundary()
    const parts: (string | Uint8Array)[] = []
    if (attributes) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\n\r\n`,
        JSON.stringify(attributes),
        '\r\n',
      )
    }
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      data,
      `\r\n--${boundary}--\r\n`,
    )
    return this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: concatBytes(parts) as BodyInit,
    })
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const name = basename(path)
    let id = await this.idOf(path)
    if (!id) {
      const parentId = await this.ensureFolder(dirname(path))
      const response = await this.upload(
        `${UPLOAD}/files/content`,
        { name, parent: { id: parentId } },
        name,
        data,
      )
      if (response.status === 409) {
        // The file appeared since the last listing: replace its content.
        id = this.conflictId((await response.json()) as BoxConflict)
        if (!id) throw new Error(`Uploading ${path} to Box failed (name conflict).`)
      } else {
        const created = (await (
          await expectOk(response, `Uploading ${path} to Box`)
        ).json()) as { entries: BoxItem[] }
        this.fileIds.set(path, created.entries[0].id)
        return
      }
    }
    await expectOk(
      await this.upload(`${UPLOAD}/files/${id}/content`, null, name, data),
      `Uploading ${path} to Box`,
    )
    this.fileIds.set(path, id)
  }

  async remove(path: string): Promise<void> {
    const id = await this.idOf(path)
    if (!id) return
    const response = await this.fetch(`${API}/files/${id}`, { method: 'DELETE' })
    if (response.status !== 404) {
      await expectOk(response, `Deleting ${path} from Box`)
    }
    this.fileIds.delete(path)
  }
}
