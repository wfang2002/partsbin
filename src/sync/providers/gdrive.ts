import type { Fetch, OAuthService } from '../oauth'
import { NotFoundError, type FileInfo, type StorageProvider } from '../provider'
import { basename, concatBytes, dirname, expectOk, newBoundary } from './http'

export const GOOGLE_DRIVE_OAUTH: OAuthService = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  // drive.file: PartsBin can only see the files it created itself.
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  // Ask for a refresh token so the sign-in lasts.
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  size?: string
  createdTime?: string
}

/**
 * Google Drive addresses files by ID and allows several files with the same
 * name in one folder, so this class keeps a path-to-ID map built from a full
 * listing. When names are duplicated (two devices creating the same folder at
 * once), the oldest one wins on every device.
 */
export class GoogleDriveProvider implements StorageProvider {
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

  private async json<T>(response: Response, action: string): Promise<T> {
    return (await expectOk(response, action)).json() as Promise<T>
  }

  private root(): Promise<string> {
    this.rootId ??= (async () => {
      const q = `name = '${this.rootName}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`
      const found = await this.json<{ files: DriveFile[] }>(
        await this.fetch(
          `${API}/files?${new URLSearchParams({ q, fields: 'files(id,createdTime)', pageSize: '100' })}`,
        ),
        'Finding the PartsBin folder in Google Drive',
      )
      if (found.files.length > 0) {
        return found.files.sort(byAge)[0].id
      }
      return this.createFolder(this.rootName, 'root')
    })()
    this.rootId.catch(() => {
      this.rootId = null
    })
    return this.rootId
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const created = await this.json<{ id: string }>(
      await this.fetch(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      }),
      `Creating the folder ${name} in Google Drive`,
    )
    return created.id
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
    const rootId = await this.root()
    const items: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: 'trashed = false',
        fields: 'nextPageToken,files(id,name,mimeType,parents,size,createdTime)',
        pageSize: '1000',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(
        await this.fetch(`${API}/files?${params}`),
        'Listing files in Google Drive',
      )
      items.push(...page.files)
      pageToken = page.nextPageToken
    } while (pageToken)

    const byId = new Map(items.map((item) => [item.id, item]))
    const pathCache = new Map<string, string | null>()
    // Path relative to the PartsBin folder, or null if the file is elsewhere.
    const pathOf = (item: DriveFile, depth = 0): string | null => {
      const cached = pathCache.get(item.id)
      if (cached !== undefined) return cached
      const parentId = item.parents?.[0]
      let path: string | null = null
      if (parentId === rootId) {
        path = item.name
      } else if (parentId && depth < 20) {
        const parent = byId.get(parentId)
        const parentPath = parent ? pathOf(parent, depth + 1) : null
        path = parentPath === null ? null : `${parentPath}/${item.name}`
      }
      pathCache.set(item.id, path)
      return path
    }

    const fileIds = new Map<string, string>()
    const folderIds = new Map<string, string>()
    const out: FileInfo[] = []
    for (const item of items.sort(byAge)) {
      const path = pathOf(item)
      if (path === null) continue
      if (item.mimeType === FOLDER_MIME) {
        if (!folderIds.has(path)) folderIds.set(path, item.id)
      } else if (!fileIds.has(path)) {
        fileIds.set(path, item.id)
        out.push({ path, size: Number(item.size ?? 0) })
      }
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
    const response = await this.fetch(`${API}/files/${id}?alt=media`)
    if (response.status === 404) {
      this.fileIds.delete(path)
      throw new NotFoundError(path)
    }
    await expectOk(response, `Downloading ${path} from Google Drive`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const id = await this.idOf(path)
    if (id) {
      const response = await this.fetch(
        `${UPLOAD}/files/${id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: data as BodyInit,
        },
      )
      if (response.status !== 404) {
        await expectOk(response, `Uploading ${path} to Google Drive`)
        return
      }
      this.fileIds.delete(path)
    }
    const parentId = await this.ensureFolder(dirname(path))
    const boundary = newBoundary()
    const body = concatBytes([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name: basename(path), parents: [parentId] }),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ])
    const created = await this.json<{ id: string }>(
      await this.fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: body as BodyInit,
      }),
      `Uploading ${path} to Google Drive`,
    )
    this.fileIds.set(path, created.id)
  }

  async remove(path: string): Promise<void> {
    const id = await this.idOf(path)
    if (!id) return
    const response = await this.fetch(`${API}/files/${id}`, { method: 'DELETE' })
    if (response.status !== 404) {
      await expectOk(response, `Deleting ${path} from Google Drive`)
    }
    this.fileIds.delete(path)
  }
}

/** Oldest first; ties broken by ID so every device picks the same one. */
function byAge(a: DriveFile, b: DriveFile): number {
  return (
    (a.createdTime ?? '').localeCompare(b.createdTime ?? '') ||
    a.id.localeCompare(b.id)
  )
}
