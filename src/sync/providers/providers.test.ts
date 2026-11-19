/*
 * These tests run the three cloud adapters against small in-memory stand-ins
 * for the Google Drive, Dropbox and Box HTTP APIs. They check the adapters'
 * own logic (path-to-ID mapping, paging, folder creation, overwrite, races).
 * The stand-ins follow the published API documentation, but they are not the
 * real services: only a sign-in with a real account proves the last mile.
 */
import { describe, expect, it } from 'vitest'
import { Store } from '../../db/store'
import { utf8 } from '../../util/crypto'
import { syncOnce } from '../engine'
import { migrate } from '../migrate'
import type { Fetch } from '../oauth'
import { NotFoundError, pooled, type StorageProvider } from '../provider'
import { BoxProvider } from './box'
import { DropboxProvider } from './dropbox'
import { GoogleDriveProvider } from './gdrive'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const bytes = (data: Uint8Array) => new Response(data as BodyInit, { status: 200 })
const empty = (status: number) => new Response(null, { status })

function bodyBytes(init?: RequestInit): Uint8Array {
  const body = init?.body
  if (typeof body === 'string') return utf8.encode(body)
  if (body instanceof Uint8Array) return body
  return new Uint8Array()
}
const bodyJson = (init?: RequestInit) => JSON.parse(utf8.decode(bodyBytes(init)))
const header = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers as HeadersInit).get(name) ?? ''

/** Split a multipart body into its parts' raw contents. */
function multipartParts(init?: RequestInit): Uint8Array[] {
  const boundary = /boundary=(.+)$/.exec(header(init, 'Content-Type'))![1]
  const latin1 = new TextDecoder('latin1').decode(bodyBytes(init))
  return latin1
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const content = part.slice(part.indexOf('\r\n\r\n') + 4, part.lastIndexOf('\r\n'))
      return Uint8Array.from(content, (c) => c.charCodeAt(0))
    })
}

// ---- Google Drive stand-in -------------------------------------------------

function fakeDrive() {
  interface Item {
    id: string
    name: string
    mimeType: string
    parents: string[]
    data: Uint8Array
    createdTime: string
  }
  const items = new Map<string, Item>()
  let nextId = 1
  let requests = 0
  const add = (name: string, mimeType: string, parent: string, data: Uint8Array = new Uint8Array()) => {
    const id = `id${nextId++}`
    items.set(id, {
      id,
      name,
      mimeType,
      parents: [parent],
      data,
      createdTime: new Date(1_700_000_000_000 + nextId * 1000).toISOString(),
    })
    return id
  }
  const fetch: Fetch = async (input, init) => {
    requests += 1
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const fileId = /\/files\/([^/]+)$/.exec(url.pathname)?.[1]
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      let found = [...items.values()]
      const name = /name = '([^']+)'/.exec(q)?.[1]
      if (name) {
        found = found.filter((i) => i.name === name && i.parents[0] === 'root')
      }
      // Two per page, to exercise paging.
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      const page = found.slice(start, start + 2)
      return json({
        files: page.map(({ data, ...rest }) => ({ ...rest, size: String(data.length) })),
        nextPageToken: start + 2 < found.length ? String(start + 2) : undefined,
      })
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = bodyJson(init)
      return json({ id: add(meta.name, meta.mimeType, meta.parents[0]) })
    }
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const [metaPart, dataPart] = multipartParts(init)
      const meta = JSON.parse(utf8.decode(metaPart))
      return json({ id: add(meta.name, 'application/octet-stream', meta.parents[0], dataPart) })
    }
    const item = fileId ? items.get(fileId) : undefined
    if (!item) return empty(404)
    if (method === 'GET') return bytes(item.data)
    if (method === 'PATCH') {
      item.data = bodyBytes(init)
      return json({ id: item.id })
    }
    if (method === 'DELETE') {
      items.delete(item.id)
      return empty(204)
    }
    return empty(400)
  }
  return {
    fetch,
    items,
    add,
    requests: () => requests,
    provider: () => new GoogleDriveProvider(fetch),
  }
}

// ---- Dropbox stand-in ------------------------------------------------------

function fakeDropbox() {
  const files = new Map<string, Uint8Array>()
  const notFound = () => json({ error_summary: 'path/not_found/..' }, 409)
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input)
    const arg = () => JSON.parse(header(init, 'Dropbox-API-Arg'))
    const page = (all: string[], start: number) => ({
      entries: all.slice(start, start + 2).map((p) => ({
        '.tag': 'file',
        path_lower: p,
        size: files.get(p)!.length,
      })),
      cursor: String(start + 2),
      has_more: start + 2 < all.length,
    })
    switch (url.pathname) {
      case '/2/files/list_folder': {
        const { path, recursive } = bodyJson(init)
        const under = [...files.keys()].filter((p) => p.startsWith(`${path.toLowerCase()}/`))
        if (under.length === 0 || !recursive) return notFound()
        return json(page(under, 0))
      }
      case '/2/files/list_folder/continue':
        return json(page([...files.keys()], Number(bodyJson(init).cursor)))
      case '/2/files/download': {
        // Dropbox rejects a JSON content type on content endpoints.
        if (header(init, 'Content-Type').includes('json')) return empty(400)
        const data = files.get(arg().path.toLowerCase())
        return data ? bytes(data) : notFound()
      }
      case '/2/files/upload':
        if (arg().mode !== 'overwrite') return empty(400)
        files.set(arg().path.toLowerCase(), bodyBytes(init))
        return json({})
      case '/2/files/delete_v2': {
        const path = bodyJson(init).path.toLowerCase()
        return files.delete(path) ? json({}) : notFound()
      }
    }
    return empty(400)
  }
  return { fetch, files, provider: () => new DropboxProvider(fetch) }
}

// ---- Box stand-in ----------------------------------------------------------

function fakeBox() {
  interface Item {
    type: 'file' | 'folder'
    id: string
    name: string
    parent: string
    data: Uint8Array
  }
  const items = new Map<string, Item>()
  let nextId = 100
  const sibling = (parent: string, name: string) =>
    [...items.values()].find((i) => i.parent === parent && i.name === name)
  const conflict = (item: Item, asArray: boolean) =>
    json(
      {
        code: 'item_name_in_use',
        context_info: {
          conflicts: asArray ? [{ type: item.type, id: item.id }] : { type: item.type, id: item.id },
        },
      },
      409,
    )
  const create = (type: Item['type'], name: string, parent: string, data: Uint8Array = new Uint8Array()) => {
    const item: Item = { type, id: String(nextId++), name, parent, data }
    items.set(item.id, item)
    return item
  }
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const folderItems = /^\/2\.0\/folders\/(\d+)\/items$/.exec(url.pathname)
    if (folderItems) {
      const all = [...items.values()].filter((i) => i.parent === folderItems[1])
      const offset = Number(url.searchParams.get('offset'))
      // The adapter asks for 1000 per page; hand out all of them.
      return json({
        total_count: all.length,
        entries: all.slice(offset).map((i) => ({
          type: i.type,
          id: i.id,
          name: i.name,
          size: i.data.length,
        })),
      })
    }
    if (url.pathname === '/2.0/folders' && method === 'POST') {
      const { name, parent } = bodyJson(init)
      const existing = sibling(parent.id, name)
      if (existing) return conflict(existing, true)
      return json({ id: create('folder', name, parent.id).id }, 201)
    }
    if (url.pathname === '/api/2.0/files/content' && method === 'POST') {
      const [attributesPart, dataPart] = multipartParts(init)
      const { name, parent } = JSON.parse(utf8.decode(attributesPart))
      const existing = sibling(parent.id, name)
      if (existing) return conflict(existing, false)
      const file = create('file', name, parent.id, dataPart)
      return json({ entries: [{ type: 'file', id: file.id }] }, 201)
    }
    const version = /^\/api\/2\.0\/files\/(\d+)\/content$/.exec(url.pathname)
    if (version && method === 'POST') {
      const file = items.get(version[1])
      if (!file) return empty(404)
      file.data = multipartParts(init)[0]
      return json({ entries: [{ type: 'file', id: file.id }] })
    }
    const content = /^\/2\.0\/files\/(\d+)\/content$/.exec(url.pathname)
    if (content) {
      const file = items.get(content[1])
      return file ? bytes(file.data) : empty(404)
    }
    const file = /^\/2\.0\/files\/(\d+)$/.exec(url.pathname)
    if (file && method === 'DELETE') {
      return empty(items.delete(file[1]) ? 204 : 404)
    }
    return empty(400)
  }
  return { fetch, items, provider: () => new BoxProvider(fetch) }
}

// ---- Shared behaviour ------------------------------------------------------

const services = {
  'Google Drive': fakeDrive,
  Dropbox: fakeDropbox,
  Box: fakeBox,
}

const b = (...values: number[]) => new Uint8Array(values)
const sorted = async (provider: StorageProvider, prefix = '') =>
  (await provider.list(prefix)).sort((x, y) => x.path.localeCompare(y.path))

let counter = 0
let clock = 1_800_000_000_000
const device = () => Store.open(`provider-test-${counter++}`, () => clock++)

describe.each(Object.entries(services))('%s adapter', (_name, makeService) => {
  it('starts empty', async () => {
    expect(await makeService().provider().list('')).toEqual([])
  })

  it('writes, lists, reads, replaces and removes files', async () => {
    const provider = makeService().provider()
    await provider.write('manifest.json', b(1))
    await provider.write('logs/abc/00000001.jsonl', b(2, 2))
    await provider.write('logs/abc/00000002.jsonl', b(3, 3, 3))
    await provider.write('blobs/ff.jpg', b(0, 255, 13, 10, 45, 45))

    expect(await sorted(provider)).toEqual([
      { path: 'blobs/ff.jpg', size: 6 },
      { path: 'logs/abc/00000001.jsonl', size: 2 },
      { path: 'logs/abc/00000002.jsonl', size: 3 },
      { path: 'manifest.json', size: 1 },
    ])
    expect((await sorted(provider, 'logs/')).map((f) => f.path)).toEqual([
      'logs/abc/00000001.jsonl',
      'logs/abc/00000002.jsonl',
    ])
    // Binary content, including bytes that look like line breaks and dashes.
    expect(await provider.read('blobs/ff.jpg')).toEqual(b(0, 255, 13, 10, 45, 45))

    await provider.write('manifest.json', b(7, 7))
    expect(await provider.read('manifest.json')).toEqual(b(7, 7))
    expect((await sorted(provider)).filter((f) => f.path === 'manifest.json')).toEqual([
      { path: 'manifest.json', size: 2 },
    ])

    await provider.remove('logs/abc/00000001.jsonl')
    await provider.remove('logs/abc/00000001.jsonl')
    await provider.remove('never/existed.txt')
    expect((await sorted(provider, 'logs/')).map((f) => f.path)).toEqual([
      'logs/abc/00000002.jsonl',
    ])
  })

  it('reports a missing file as NotFoundError', async () => {
    const provider = makeService().provider()
    await expect(provider.read('nope.json')).rejects.toBeInstanceOf(NotFoundError)
    await provider.write('a.json', b(1))
    await expect(provider.read('b.json')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('shares files between devices without duplicating them', async () => {
    const service = makeService()
    const phone = service.provider()
    const desktop = service.provider()
    await phone.write('snapshots/s1.json', b(1))
    // The desktop has not listed anything yet; it must still find the file.
    await desktop.write('snapshots/s1.json', b(2, 2))
    await desktop.write('snapshots/s2.json', b(3))
    expect(await sorted(phone)).toEqual([
      { path: 'snapshots/s1.json', size: 2 },
      { path: 'snapshots/s2.json', size: 1 },
    ])
    expect(await phone.read('snapshots/s1.json')).toEqual(b(2, 2))
  })

  it('creates a folder once when files are uploaded in parallel', async () => {
    const provider = makeService().provider()
    const names = Array.from({ length: 6 }, (_, i) => `blobs/${i}.jpg`)
    await pooled(names, 3, (path) => provider.write(path, b(1)))
    expect((await sorted(provider)).map((f) => f.path)).toEqual(names)
  })

  it('reports a file that vanished after listing as NotFoundError', async () => {
    const service = makeService()
    const phone = service.provider()
    const desktop = service.provider()
    await phone.write('logs/abc/00000001.jsonl', b(1))
    await desktop.list('')
    await phone.remove('logs/abc/00000001.jsonl')
    await expect(desktop.read('logs/abc/00000001.jsonl')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    // And writing it again works rather than updating a dead ID.
    await desktop.write('logs/abc/00000001.jsonl', b(5))
    expect(await phone.read('logs/abc/00000001.jsonl')).toEqual(b(5))
  })

  it('syncs two devices end to end', async () => {
    const service = makeService()
    const phone = await device()
    const desktop = await device()
    const photo = await phone.putBlob(b(1, 2, 3, 4))
    await phone.write([
      { table: 'locations', id: 'box1', fields: { name: 'Box 1', kind: 'box', parentId: null, photoBlob: photo } },
      { table: 'parts', id: 'p1', fields: { mpn: 'NE555P', specs: {}, tags: [] } },
      { table: 'stock', id: 's1', fields: { partId: 'p1', locationId: 'box1', qty: 3, lastSeenAt: 1 } },
    ])
    await syncOnce(phone, service.provider())
    await syncOnce(desktop, service.provider())
    expect((await desktop.db.parts.get('p1'))?.mpn).toBe('NE555P')
    expect(await desktop.getBlob(photo)).toEqual(b(1, 2, 3, 4))

    await desktop.put('stock', 's1', { qty: 1 })
    await syncOnce(desktop, service.provider())
    for (let i = 0; i < 4; i++) {
      await phone.put('parts', `extra${i}`, { mpn: `X${i}`, specs: {}, tags: [] })
      await syncOnce(phone, service.provider(), { compactAfter: 2 })
    }
    await syncOnce(desktop, service.provider())
    expect((await phone.db.stock.get('s1'))?.qty).toBe(1)
    expect(await desktop.db.parts.count()).toBe(5)
  })
})

describe('Google Drive adapter', () => {
  it('ignores app files outside the PartsBin folder', async () => {
    const drive = fakeDrive()
    const provider = drive.provider()
    await provider.write('manifest.json', b(1))
    drive.add('stray.txt', 'text/plain', 'root', b(9))
    const other = drive.add('Other', 'application/vnd.google-apps.folder', 'root')
    drive.add('manifest.json', 'application/json', other, b(9, 9))
    expect(await sorted(provider)).toEqual([{ path: 'manifest.json', size: 1 }])
  })

  it('resolves duplicate folders and files to the oldest, on every device', async () => {
    const drive = fakeDrive()
    const phone = drive.provider()
    await phone.write('logs/aaa/00000001.jsonl', b(1))
    // Another device raced and created a second "logs" folder and manifest.
    const root = [...drive.items.values()].find((i) => i.name === 'PartsBin')!.id
    const dupLogs = drive.add('logs', 'application/vnd.google-apps.folder', root)
    const dupDevice = drive.add('bbb', 'application/vnd.google-apps.folder', dupLogs)
    drive.add('00000001.jsonl', 'application/octet-stream', dupDevice, b(2, 2))
    await phone.write('manifest.json', b(1))
    drive.add('manifest.json', 'application/json', root, b(9, 9, 9))

    for (const provider of [phone, drive.provider()]) {
      expect(await sorted(provider)).toEqual([
        { path: 'logs/aaa/00000001.jsonl', size: 1 },
        { path: 'logs/bbb/00000001.jsonl', size: 2 },
        { path: 'manifest.json', size: 1 },
      ])
      expect(await provider.read('manifest.json')).toEqual(b(1))
    }
  })

  it('reuses the existing PartsBin folder', async () => {
    const drive = fakeDrive()
    await drive.provider().write('a.json', b(1))
    await drive.provider().write('b.json', b(1))
    const roots = [...drive.items.values()].filter((i) => i.name === 'PartsBin')
    expect(roots).toHaveLength(1)
  })
})

describe('moving between services', () => {
  it.each([
    ['Google Drive', 'Dropbox'],
    ['Dropbox', 'Box'],
    ['Box', 'Google Drive'],
  ] as const)('migrates from %s to %s', async (from, to) => {
    const source = services[from]()
    const target = services[to]()
    const phone = await device()
    const photo = await phone.putBlob(b(8, 8, 8))
    await phone.write([
      { table: 'locations', id: 'box1', fields: { name: 'Box 1', kind: 'box', parentId: null, photoBlob: photo } },
      { table: 'parts', id: 'p1', fields: { mpn: 'LM358', specs: {}, tags: [] } },
    ])
    await syncOnce(phone, source.provider())
    await phone.put('parts', 'p2', { mpn: 'LM324', specs: {}, tags: [] })
    await syncOnce(phone, source.provider())

    const report = await migrate(source.provider(), target.provider())
    expect(report.files).toBe((await source.provider().list('')).length)
    expect(await sorted(target.provider())).toEqual(await sorted(source.provider()))

    // The phone continues on the new service; a new device joins there.
    const after = await syncOnce(phone, target.provider())
    expect(after).toMatchObject({ opsPushed: 0, snapshotWritten: false })
    const desktop = await device()
    await syncOnce(desktop, target.provider())
    expect(await desktop.db.parts.count()).toBe(2)
    expect(await desktop.getBlob(photo)).toEqual(b(8, 8, 8))
  })
})
