import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { platformKind } from './env'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * HTTP that is not subject to browser cross-origin rules, so distributor and
 * cloud APIs can be called directly.
 * - desktop: requests go through Rust.
 * - ios: Capacitor routes window.fetch through native code (CapacitorHttp is
 *   enabled in capacitor.config.ts).
 * - browser: plain fetch; APIs without CORS headers will fail there.
 */
export const platformFetch: Fetch =
  platformKind === 'desktop'
    ? (input, init) => tauriFetch(input, init)
    : (input, init) => fetch(input, init)
