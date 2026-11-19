import { describe, expect, it } from 'vitest'
import { toBase64 } from '../util/crypto'
import { responseFromCapacitor } from './http'

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
