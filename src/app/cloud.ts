import type { Store } from '../db/store'
import { platformKind } from '../platform/env'
import { platformFetch } from '../platform/http'
import { oauthRedirectUri, runOAuthFlow } from '../platform/oauthFlow'
import { secrets } from '../platform/secrets'
import {
  TokenManager,
  completeAuthRequest,
  createAuthRequest,
  type OAuthCredentials,
  type OAuthService,
  type TokenSet,
} from '../sync/oauth'
import type { StorageProvider } from '../sync/provider'
import { BOX_OAUTH, BoxProvider } from '../sync/providers/box'
import { DROPBOX_OAUTH, DropboxProvider } from '../sync/providers/dropbox'
import { GOOGLE_DRIVE_OAUTH, GoogleDriveProvider } from '../sync/providers/gdrive'

export type ProviderId = 'gdrive' | 'dropbox' | 'box'

export interface CloudService {
  id: ProviderId
  name: string
  oauth: OAuthService
  /** What the service calls the app's public identifier. */
  clientIdLabel: string
  /** Whether sign-in needs the app's secret as well. */
  secret: 'none' | 'required'
  /** Where the files end up, for display. */
  folderHint: string
  make(fetch: TokenManager['authedFetch']): StorageProvider
}

const googleNeedsSecret = platformKind !== 'ios'

export const CLOUD_SERVICES: Record<ProviderId, CloudService> = {
  gdrive: {
    id: 'gdrive',
    name: 'Google Drive',
    oauth: GOOGLE_DRIVE_OAUTH,
    clientIdLabel: 'Client ID',
    // Google's "Desktop app" clients are issued a secret that must be sent;
    // its "iOS" clients have none.
    secret: googleNeedsSecret ? 'required' : 'none',
    folderHint: 'My Drive > PartsBin',
    make: (fetch) => new GoogleDriveProvider(fetch),
  },
  dropbox: {
    id: 'dropbox',
    name: 'Dropbox',
    oauth: DROPBOX_OAUTH,
    clientIdLabel: 'App key',
    secret: 'none',
    folderHint: 'Dropbox > Apps > (your app name) > PartsBin',
    make: (fetch) => new DropboxProvider(fetch),
  },
  box: {
    id: 'box',
    name: 'Box',
    oauth: BOX_OAUTH,
    clientIdLabel: 'Client ID',
    secret: 'required',
    folderHint: 'All Files > PartsBin',
    make: (fetch) => new BoxProvider(fetch),
  },
}

export const PROVIDER_IDS = Object.keys(CLOUD_SERVICES) as ProviderId[]

const clientIdKey = (id: ProviderId) => `cloud.${id}.clientId`
const secretKey = (id: ProviderId) => `cloud.${id}.clientSecret`
const tokensKey = (id: ProviderId) => `cloud.${id}.tokens`

export async function loadCredentials(
  store: Store,
  id: ProviderId,
): Promise<OAuthCredentials> {
  return {
    clientId: (await store.getMeta<string>(clientIdKey(id))) ?? '',
    clientSecret: await secrets.get(secretKey(id)),
  }
}

async function loadTokens(id: ProviderId): Promise<TokenSet | undefined> {
  const raw = await secrets.get(tokensKey(id))
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as TokenSet
  } catch {
    return undefined
  }
}

export async function isConnected(id: ProviderId): Promise<boolean> {
  return (await loadTokens(id)) !== undefined
}

/** Sign in to a service in the system browser and remember the result. */
export async function connect(
  store: Store,
  id: ProviderId,
  credentials: OAuthCredentials,
): Promise<void> {
  const service = CLOUD_SERVICES[id]
  const clientId = credentials.clientId.trim()
  const clientSecret = credentials.clientSecret?.trim() || undefined
  if (!clientId) throw new Error(`Enter the ${service.clientIdLabel} first.`)
  if (service.secret === 'required' && !clientSecret) {
    throw new Error('Enter the client secret first.')
  }
  const creds = { clientId, clientSecret }
  const request = await createAuthRequest(service.oauth, creds, oauthRedirectUri())
  const redirect = await runOAuthFlow(request.url)
  const tokens = await completeAuthRequest(
    platformFetch,
    service.oauth,
    creds,
    request,
    redirect,
  )
  await store.setMeta(clientIdKey(id), clientId)
  if (clientSecret) await secrets.set(secretKey(id), clientSecret)
  else await secrets.remove(secretKey(id))
  await secrets.set(tokensKey(id), JSON.stringify(tokens))
}

export async function disconnect(id: ProviderId): Promise<void> {
  await secrets.remove(tokensKey(id))
}

/** A ready-to-use provider for a connected service, or null. */
export async function openProvider(
  store: Store,
  id: ProviderId,
): Promise<StorageProvider | null> {
  const tokens = await loadTokens(id)
  if (!tokens) return null
  const service = CLOUD_SERVICES[id]
  const manager = new TokenManager(
    platformFetch,
    service.oauth,
    await loadCredentials(store, id),
    tokens,
    (updated) => secrets.set(tokensKey(id), JSON.stringify(updated)),
  )
  return service.make(manager.authedFetch)
}
