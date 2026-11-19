import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { DESKTOP_OAUTH_PORT, IOS_URL_SCHEME, platformKind } from './env'

/** Where the cloud provider sends the browser after sign-in. */
export function oauthRedirectUri(): string {
  switch (platformKind) {
    case 'desktop':
      return `http://localhost:${DESKTOP_OAUTH_PORT}/oauth2redirect`
    case 'ios':
      return `${IOS_URL_SCHEME}:/oauth2redirect`
    case 'browser':
      throw new Error(
        'Cloud sign-in is available in the desktop and iPhone apps, not in the browser preview.',
      )
  }
}

/**
 * Open the sign-in page in the system browser and wait for the redirect.
 * Resolves with the query parameters of the redirect URL.
 */
export async function runOAuthFlow(authUrl: string): Promise<URLSearchParams> {
  if (platformKind === 'desktop') {
    const waiting = invoke<string>('oauth_listen', {
      port: DESKTOP_OAUTH_PORT,
      timeoutSecs: 300,
    })
    await openUrl(authUrl)
    const target = await waiting
    return new URL(target, 'http://localhost').searchParams
  }
  if (platformKind === 'ios') {
    return new Promise((resolve, reject) => {
      let settled = false
      const handles: Promise<{ remove(): Promise<void> }>[] = []
      const finish = (action: () => void) => {
        if (settled) return
        settled = true
        for (const handle of handles) void handle.then((h) => h.remove())
        action()
      }
      handles.push(
        App.addListener('appUrlOpen', ({ url }) => {
          if (!url.startsWith(`${IOS_URL_SCHEME}:`)) return
          const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
          finish(() => {
            void Browser.close().catch(() => {})
            resolve(new URLSearchParams(query))
          })
        }),
        Browser.addListener('browserFinished', () => {
          // Give a redirect that closed the browser a moment to arrive first.
          setTimeout(
            () => finish(() => reject(new Error('Sign-in was cancelled.'))),
            1000,
          )
        }),
      )
      Browser.open({ url: authUrl }).catch((e) => finish(() => reject(e)))
    })
  }
  throw new Error(
    'Cloud sign-in is available in the desktop and iPhone apps, not in the browser preview.',
  )
}
