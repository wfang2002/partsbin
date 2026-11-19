import { utf8 } from '../../util/crypto'

/** Throw a readable error for an unexpected HTTP status. */
export async function expectOk(response: Response, action: string): Promise<Response> {
  if (response.ok) return response
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 300)
  } catch {
    // No body.
  }
  throw new Error(`${action} failed (HTTP ${response.status}). ${detail}`.trim())
}

export function concatBytes(parts: (Uint8Array | string)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? utf8.encode(p) : p))
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export const dirname = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export const newBoundary = () =>
  `partsbin${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
