import { mpnKey } from '../domain/inventory'
import type { Fetch } from '../sync/oauth'

/** What a distributor knows about a part. */
export interface PartInfo {
  source: 'digikey' | 'mouser'
  mpn: string
  /** False when the distributor only had a similar part number. */
  exact: boolean
  manufacturer?: string
  description?: string
  category?: string
  specs: Record<string, string>
  datasheetUrl?: string
  imageUrl?: string
}

export interface LookupKeys {
  digikey?: { clientId: string; clientSecret: string }
  mouser?: { apiKey: string }
}

function absoluteUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined
  const trimmed = url.trim()
  return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

async function failure(response: Response, who: string): Promise<Error> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 200)
  } catch {
    // No body.
  }
  if (response.status === 401 || response.status === 403) {
    return new Error(`${who} did not accept the API key. Check it in Settings.`)
  }
  if (response.status === 429) {
    return new Error(`${who} lookup limit reached. Try again later.`)
  }
  return new Error(`${who} lookup failed (HTTP ${response.status}). ${detail}`.trim())
}

// ---- Digi-Key --------------------------------------------------------------

interface DigiKeyProduct {
  ManufacturerProductNumber?: string
  Manufacturer?: { Name?: string }
  Description?: { ProductDescription?: string; DetailedDescription?: string }
  Category?: DigiKeyCategory
  DatasheetUrl?: string
  PhotoUrl?: string
  Parameters?: { ParameterText?: string; ValueText?: string }[]
  ProductVariations?: { DigiKeyProductNumber?: string }[]
}

interface DigiKeyCategory {
  Name?: string
  ChildCategories?: DigiKeyCategory[]
}

function deepestCategory(category: DigiKeyCategory | undefined): string | undefined {
  let current = category
  while (current?.ChildCategories?.length) current = current.ChildCategories[0]
  return text(current?.Name)
}

export function digiKeyToPartInfo(product: DigiKeyProduct, exact: boolean): PartInfo {
  const specs: Record<string, string> = {}
  for (const parameter of product.Parameters ?? []) {
    const name = text(parameter.ParameterText)
    const value = text(parameter.ValueText)
    if (name && value && value !== '-') specs[name] = value
  }
  return {
    source: 'digikey',
    mpn: product.ManufacturerProductNumber ?? '',
    exact,
    manufacturer: text(product.Manufacturer?.Name),
    description:
      text(product.Description?.ProductDescription) ??
      text(product.Description?.DetailedDescription),
    category: deepestCategory(product.Category),
    specs,
    datasheetUrl: absoluteUrl(product.DatasheetUrl),
    imageUrl: absoluteUrl(product.PhotoUrl),
  }
}

/** Digi-Key Product Information API v4, with the two-legged OAuth flow. */
export class DigiKeyClient {
  private token: { value: string; expiresAt: number } | null = null
  private readonly fetch: Fetch
  private readonly keys: NonNullable<LookupKeys['digikey']>

  constructor(fetch: Fetch, keys: NonNullable<LookupKeys['digikey']>) {
    this.fetch = fetch
    this.keys = keys
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value
    }
    const response = await this.fetch('https://api.digikey.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.keys.clientId,
        client_secret: this.keys.clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
    })
    if (!response.ok) throw await failure(response, 'Digi-Key')
    const json = (await response.json()) as {
      access_token: string
      expires_in?: number
    }
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 600) * 1000,
    }
    return this.token.value
  }

  async lookup(mpn: string): Promise<PartInfo | null> {
    const response = await this.fetch(
      'https://api.digikey.com/products/v4/search/keyword',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.accessToken()}`,
          'X-DIGIKEY-Client-Id': this.keys.clientId,
          'X-DIGIKEY-Locale-Site': 'US',
          'X-DIGIKEY-Locale-Language': 'en',
          'X-DIGIKEY-Locale-Currency': 'USD',
        },
        body: JSON.stringify({ Keywords: mpn, Limit: 10, Offset: 0 }),
      },
    )
    if (!response.ok) throw await failure(response, 'Digi-Key')
    const json = (await response.json()) as {
      Products?: DigiKeyProduct[]
      ExactMatches?: DigiKeyProduct[]
    }
    const products = [...(json.ExactMatches ?? []), ...(json.Products ?? [])]
    const key = mpnKey(mpn)
    const exact = products.find(
      (p) =>
        mpnKey(p.ManufacturerProductNumber) === key ||
        p.ProductVariations?.some((v) => mpnKey(v.DigiKeyProductNumber) === key),
    )
    if (exact) return digiKeyToPartInfo(exact, true)
    return products.length > 0 ? digiKeyToPartInfo(products[0], false) : null
  }
}

// ---- Mouser ----------------------------------------------------------------

interface MouserPart {
  ManufacturerPartNumber?: string
  MouserPartNumber?: string
  Manufacturer?: string
  Description?: string
  Category?: string
  DataSheetUrl?: string
  ImagePath?: string
  ProductAttributes?: { AttributeName?: string; AttributeValue?: string }[]
}

export function mouserToPartInfo(part: MouserPart, exact: boolean): PartInfo {
  const specs: Record<string, string> = {}
  for (const attribute of part.ProductAttributes ?? []) {
    const name = text(attribute.AttributeName)
    const value = text(attribute.AttributeValue)
    if (!name || !value) continue
    // Mouser repeats a name for each option, e.g. Packaging: Reel, Cut Tape.
    specs[name] = specs[name] ? `${specs[name]}, ${value}` : value
  }
  return {
    source: 'mouser',
    mpn: part.ManufacturerPartNumber ?? '',
    exact,
    manufacturer: text(part.Manufacturer),
    description: text(part.Description),
    category: text(part.Category),
    specs,
    datasheetUrl: absoluteUrl(part.DataSheetUrl),
    imageUrl: absoluteUrl(part.ImagePath),
  }
}

/** Mouser Search API v1. */
export class MouserClient {
  private readonly fetch: Fetch
  private readonly keys: NonNullable<LookupKeys['mouser']>

  constructor(fetch: Fetch, keys: NonNullable<LookupKeys['mouser']>) {
    this.fetch = fetch
    this.keys = keys
  }

  async lookup(mpn: string): Promise<PartInfo | null> {
    const response = await this.fetch(
      `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(this.keys.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SearchByPartRequest: {
            mouserPartNumber: mpn,
            partSearchOptions: 'Exact',
          },
        }),
      },
    )
    if (!response.ok) throw await failure(response, 'Mouser')
    const json = (await response.json()) as {
      Errors?: { Message?: string }[]
      SearchResults?: { Parts?: MouserPart[] } | null
    }
    if (json.Errors?.length) {
      throw new Error(`Mouser lookup failed: ${json.Errors[0].Message ?? 'unknown error'}`)
    }
    const parts = json.SearchResults?.Parts ?? []
    const key = mpnKey(mpn)
    const exact = parts.find(
      (p) =>
        mpnKey(p.ManufacturerPartNumber) === key ||
        mpnKey(p.MouserPartNumber) === key,
    )
    if (exact) return mouserToPartInfo(exact, true)
    return parts.length > 0 ? mouserToPartInfo(parts[0], false) : null
  }
}

// ---- Combined --------------------------------------------------------------

export interface LookupResult {
  info: PartInfo | null
  /** Problems with individual distributors, for display. */
  errors: string[]
}

/**
 * Ask Digi-Key first (it returns full parametric specs), then Mouser. An
 * exact part-number match from either wins over a similar one.
 */
export async function lookupPart(
  fetch: Fetch,
  keys: LookupKeys,
  mpn: string,
  cache: { digikey?: DigiKeyClient } = {},
): Promise<LookupResult> {
  const errors: string[] = []
  let closest: PartInfo | null = null
  const attempts: (() => Promise<PartInfo | null>)[] = []
  if (keys.digikey) {
    cache.digikey ??= new DigiKeyClient(fetch, keys.digikey)
    const client = cache.digikey
    attempts.push(() => client.lookup(mpn))
  }
  if (keys.mouser) {
    const client = new MouserClient(fetch, keys.mouser)
    attempts.push(() => client.lookup(mpn))
  }
  if (attempts.length === 0) {
    return {
      info: null,
      errors: ['Add a Digi-Key or Mouser API key in Settings to look parts up.'],
    }
  }
  for (const attempt of attempts) {
    try {
      const info = await attempt()
      if (info?.exact) return { info, errors }
      closest ??= info
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { info: closest, errors }
}
