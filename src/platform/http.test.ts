import { describe, expect, it } from 'vitest'
import { toBase64 } from '../util/crypto'
import { desktopInit, responseFromCapacitor } from './http'

/** What the Tauri HTTP plugin keeps after it copies headers off the Request. */
function headersAfterPlugin(init?: RequestInit): Headers {
  const prepared = desktopInit(init)
  const headers =
    prepared.headers instanceof Headers ? prepared.headers : new Headers(prepared.headers)
  const req = new Request('https://api.box.com/2.0/folders/0/items', prepared)
  for (const [key, value] of req.headers) {
    if (!headers.get(key)) headers.set(key, value)
  }
  return headers
}

describe('desktopInit', () => {
  it('asks the desktop client to omit Origin on a normal request', () => {
    const headers = headersAfterPlugin({ headers: { Authorization: 'Bearer token' } })
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('origin')).toBe('')
  })

  it('keeps an Origin the caller set', () => {
    const headers = headersAfterPlugin({
      headers: { Origin: 'https://www.lcsc.com', Accept: 'application/json' },
    })
    expect(headers.get('origin')).toBe('https://www.lcsc.com')
    expect(headers.get('accept')).toBe('application/json')
  })
})

describe('responseFromCapacitor', () => {
  it('rebuilds JSON that the native client already parsed', async () => {
    const response = responseFromCapacitor({
      data: { data: [{ id: 'gpt-a' }] },
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: 'https://api.openai.com/v1/models',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ data: [{ id: 'gpt-a' }] })
  })

  it('decodes a binary body that arrived as base64', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255])
    const response = responseFromCapacitor({
      data: toBase64(bytes),
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      url: 'https://example.com/a.jpg',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('keeps an error body that explains a rejected key', async () => {
    const response = responseFromCapacitor({
      data: { error: { message: 'Incorrect API key provided' } },
      status: 401,
      headers: { 'content-type': 'application/json' },
      url: 'https://api.openai.com/v1/models',
    })
    const body = (await response.json()) as { error: { message: string } }
    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Incorrect API key provided')
  })
})
