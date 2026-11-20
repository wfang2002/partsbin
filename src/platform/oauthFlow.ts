import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { DESKTOP_OAUTH_PORT, IOS_URL_SCHEME, platformKind } from './env'

interface OAuthSessionPlugin {
  browse(options: { url: string }): Promise<{ url: string }>
}

const OAuthSession = registerPlugin<OAuthSessionPlugin>('OAuthSession')

/** The redirect URI saved on the Box app. Sign-in sends this exact string. */
export const BOX_REDIRECT_URI = 'https://app.box.com'

export function boxRedirectUris(kind: typeof platformKind): { register: string; send: string } {
  if (kind === 'ios' || kind === 'desktop') {
    return { register: BOX_REDIRECT_URI, send: BOX_REDIRECT_URI }
  }
  throw new Error(
    'Cloud sign-in is available in the desktop and iPhone apps, not in the browser preview.',
  )
}

/** Where the cloud provider sends the browser after sign-in. */
export function oauthRedirectUri(service?: string): string {
  if (service === 'box') return boxRedirectUris(platformKind).send
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

/** The address to paste into the provider's console. */
export function oauthRedirectToRegister(service?: string): string {
  if (service === 'box') return boxRedirectUris(platformKind).register
  return oauthRedirectUri(service)
}

/**
 * Open the sign-in page in the system browser and wait for the redirect.
 * Resolves with the query parameters of the redirect URL.
 */
export async function runOAuthFlow(
  authUrl: string,
  options?: { httpsRedirect?: boolean },
): Promise<URLSearchParams> {
  if (options?.httpsRedirect) return httpsRedirect(authUrl)
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
          finish(() => {
            void Browser.close().catch(() => {})
            resolve(queryOf(url))
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

/** Box sends the browser to https://app.box.com with the sign-in code. */
async function httpsRedirect(authUrl: string): Promise<URLSearchParams> {
  if (platformKind === 'ios') {
    const result = await OAuthSession.browse({ url: authUrl })
    return queryOf(result.url)
  }
  if (platformKind === 'desktop') {
    const target = await invoke<string>('oauth_browse', { url: authUrl })
    return queryOf(target)
  }
  throw new Error(
    'Cloud sign-in is available in the desktop and iPhone apps, not in the browser preview.',
  )
}

function queryOf(url: string): URLSearchParams {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return new URLSearchParams()
  const hash = url.indexOf('#', queryStart)
  const query = url.slice(queryStart + 1, hash === -1 ? undefined : hash)
  return new URLSearchParams(query)
}
