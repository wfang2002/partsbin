import type { Fetch, OAuthService } from '../oauth'
import { NotFoundError, type FileInfo, type StorageProvider } from '../provider'
import { expectOk } from './http'

export const DROPBOX_OAUTH: OAuthService = {
  authUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  // Scopes are fixed in the Dropbox App Console.
  scopes: [],
  // Ask for a refresh token so the sign-in lasts.
  extraAuthParams: { token_access_type: 'offline' },
}

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted'
  path_lower?: string
  size?: number
}

interface ListResult {
  entries: DropboxEntry[]
  cursor: string
  has_more: boolean
}

/**
 * Dropbox addresses files by path. Everything is kept in one folder
 * ("/PartsBin" inside the app folder), so the app never lists or touches
 * anything else even if it was registered with full-Dropbox access.
 *
 * Dropbox paths are case-insensitive; PartsBin only uses lower-case paths.
 */
export class DropboxProvider implements StorageProvider {
  private readonly fetch: Fetch
  private readonly root: string

  constructor(fetch: Fetch, root = '/PartsBin') {
    this.fetch = fetch
    this.root = root
  }

  private full(path: string) {
    return `${this.root}/${path}`
  }

  private rpc(endpoint: string, body: unknown): Promise<Response> {
    return this.fetch(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  /** True for Dropbox's "this path does not exist" error response. */
  private async isNotFound(response: Response): Promise<boolean> {
    if (response.status !== 409) return false
    const text = await response.clone().text()
    return text.includes('not_found')
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const out: FileInfo[] = []
    let response = await this.rpc('files/list_folder', {
      path: this.root,
      recursive: true,
      limit: 2000,
    })
    if (await this.isNotFound(response)) return []
    const strip = this.root.toLowerCase().length + 1
    for (;;) {
      const page = (await (
        await expectOk(response, 'Listing files in Dropbox')
      ).json()) as ListResult
      for (const entry of page.entries) {
        if (entry['.tag'] !== 'file' || !entry.path_lower) continue
        const path = entry.path_lower.slice(strip)
        if (path.startsWith(prefix)) out.push({ path, size: entry.size ?? 0 })
      }
      if (!page.has_more) break
      response = await this.rpc('files/list_folder/continue', {
        cursor: page.cursor,
      })
    }
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    const response = await this.fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': JSON.stringify({ path: this.full(path) }) },
    })
    if (await this.isNotFound(response)) throw new NotFoundError(path)
    await expectOk(response, `Downloading ${path} from Dropbox`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const response = await this.fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: this.full(path),
          mode: 'overwrite',
          mute: true,
        }),
      },
      body: data as BodyInit,
    })
    await expectOk(response, `Uploading ${path} to Dropbox`)
  }

  async remove(path: string): Promise<void> {
    const response = await this.rpc('files/delete_v2', { path: this.full(path) })
    if (await this.isNotFound(response)) return
    await expectOk(response, `Deleting ${path} from Dropbox`)
  }
}
