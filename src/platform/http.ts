import { CapacitorHttp, type HttpResponse } from '@capacitor/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { fromBase64, toBase64, utf8 } from '../util/crypto'
import { platformKind } from './env'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

function plainHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    out[key] = value
  })
  return out
}

function bodyBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') {
    if (data.length === 0) return new Uint8Array()
    try {
      return fromBase64(data)
    } catch {
      return utf8.encode(data)
    }
  }
  if (data == null) return new Uint8Array()
  // A JSON content type is parsed natively, so the bytes have to be rebuilt.
  return utf8.encode(JSON.stringify(data))
}

/** A CapacitorHttp result as a fetch Response callers can read as usual. */
export function responseFromCapacitor(result: HttpResponse): Response {
  const headers = new Headers()
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (value == null) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  }
  const bytes = bodyBytes(result.data)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Response(copy, { status: result.status, headers })
}

/** Bytes of a request body. Uint8Array is kept as-is, not decoded as text. */
export async function bytesOfBody(body: BodyInit): Promise<Uint8Array> {
  if (typeof body === 'string') return utf8.encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
  if (body instanceof URLSearchParams) return utf8.encode(body.toString())
  throw new Error('This request body cannot be sent.')
}

async function iosFetch(input: string, init?: RequestInit): Promise<Response> {
  // The patched fetch turns a Uint8Array into text, which destroys JPEG bytes.
  // Base64 with dataType "file" is handed to URLSession unchanged.
  const body = init?.body
  const result = await CapacitorHttp.request({
    url: input,
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: plainHeaders(init?.headers),
    data: body == null ? undefined : toBase64(await bytesOfBody(body)),
    dataType: body == null ? undefined : 'file',
    responseType: 'arraybuffer',
  })
  return responseFromCapacitor(result)
}

/**
 * The desktop HTTP plugin adds `Origin: tauri://localhost` when the request
 * has none. Box rejects that origin. An empty Origin is the plugin's signal
 * to leave the header off. A caller-supplied Origin, such as LCSC's, is kept.
 */
export function desktopInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('origin')) headers.set('origin', '')
  return { ...init, headers }
}

/**
 * HTTP that is not subject to browser cross-origin rules, so distributor and
 * cloud APIs can be called directly.
 * - desktop: requests go through Rust.
 * - ios: every request goes through the Capacitor HTTP plugin, so Authorization
 *   is kept and photo bytes are not decoded as text.
 * - browser: plain fetch; APIs without CORS headers will fail there.
 */
export const platformFetch: Fetch =
  platformKind === 'desktop'
    ? (input, init) => tauriFetch(input, desktopInit(init))
    : platformKind === 'ios'
      ? iosFetch
      : (input, init) => fetch(input, init)
