import { OpenAiClient, type AiClient } from '../ai/client'
import type { Store } from '../db/store'
import type { PartFields } from '../domain/actions'
import { DigiKeyClient, lookupPart, type LookupKeys, type PartInfo } from '../enrich/lookup'
import { platformFetch } from '../platform/http'
import { toJpeg } from '../platform/image'
import { secrets } from '../platform/secrets'

/** Names of the secrets and device-local settings used by online features. */
export const KEYS = {
  digikeyClientId: 'digikey.clientId',
  digikeyClientSecret: 'digikey.clientSecret',
  mouserApiKey: 'mouser.apiKey',
  openaiApiKey: 'openai.apiKey',
  aiModel: 'ai.model',
  aiBaseUrl: 'ai.baseUrl',
  aiAuto: 'ai.auto',
} as const

export async function loadLookupKeys(): Promise<LookupKeys> {
  const [clientId, clientSecret, apiKey] = await Promise.all([
    secrets.get(KEYS.digikeyClientId),
    secrets.get(KEYS.digikeyClientSecret),
    secrets.get(KEYS.mouserApiKey),
  ])
  return {
    digikey: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    mouser: apiKey ? { apiKey } : undefined,
  }
}

// Keeps the Digi-Key access token between lookups.
const lookupCache: { digikey?: DigiKeyClient; forClientId?: string } = {}

export async function lookupOnline(mpn: string) {
  const keys = await loadLookupKeys()
  if (lookupCache.forClientId !== keys.digikey?.clientId) {
    lookupCache.digikey = undefined
    lookupCache.forClientId = keys.digikey?.clientId
  }
  return lookupPart(platformFetch, keys, mpn, lookupCache)
}

/** The configured AI client, or null when no key or model is set. */
export async function loadAi(store: Store): Promise<AiClient | null> {
  const [apiKey, model, baseUrl] = await Promise.all([
    secrets.get(KEYS.openaiApiKey),
    store.getMeta<string>(KEYS.aiModel),
    store.getMeta<string>(KEYS.aiBaseUrl),
  ])
  if (!apiKey || !model) return null
  return new OpenAiClient(platformFetch, { apiKey, model, baseUrl })
}

/** Download a product image and keep a small copy. Failure is not an error. */
export async function fetchPartImage(
  store: Store,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const response = await platformFetch(url)
    if (!response.ok) return undefined
    return await store.putBlob(await toJpeg(await response.blob(), 480, 0.8))
  } catch {
    return undefined
  }
}

/** Distributor data as part fields. */
export function partFieldsFromInfo(info: PartInfo): PartFields {
  return {
    mpn: info.mpn || undefined,
    manufacturer: info.manufacturer,
    description: info.description,
    category: info.category,
    specs: info.specs,
    datasheetUrl: info.datasheetUrl,
    source: info.source,
  }
}
