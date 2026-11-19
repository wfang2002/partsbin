import { Capacitor } from '@capacitor/core'

/**
 * Where the app is running:
 * - desktop: inside the Tauri shell
 * - ios: inside the Capacitor shell on an iPhone
 * - browser: a plain browser tab (development preview; no cloud sign-in)
 */
export type PlatformKind = 'desktop' | 'ios' | 'browser'

function detect(): PlatformKind {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'desktop'
  }
  if (Capacitor.isNativePlatform()) return 'ios'
  return 'browser'
}

export const platformKind: PlatformKind = detect()

/** Must match the URL scheme in ios/App/App/Info.plist. */
export const IOS_URL_SCHEME = 'com.wfang.partsbin'

/** Must be the port registered as redirect URI with Dropbox and Box. */
export const DESKTOP_OAUTH_PORT = 53127
