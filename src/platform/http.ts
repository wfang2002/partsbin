import { CapacitorHttp, type HttpResponse } from '@capacitor/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { fromBase64, utf8 } from '../util/crypto'
import { platformKind } from './env'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Capacitor's fetch patch sends these methods through WKWebView. The web view
 * removes Authorization before the request is sent, so OpenAI (and the cloud
 * APIs) answer 401. The native plugin keeps the header.
 */
const WEBVIEW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

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

async function iosFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (!WEBVIEW_METHODS.has(method)) return fetch(input, init)
  const result = await CapacitorHttp.request({
    url: input,
    method,
    headers: plainHeaders(init?.headers),
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
 * - ios: GET goes through the Capacitor HTTP plugin so Authorization is kept;
 *   other methods already do, via the patched fetch.
 * - browser: plain fetch; APIs without CORS headers will fail there.
 */
export const platformFetch: Fetch =
  platformKind === 'desktop'
    ? (input, init) => tauriFetch(input, desktopInit(init))
    : platformKind === 'ios'
      ? iosFetch
      : (input, init) => fetch(input, init)
