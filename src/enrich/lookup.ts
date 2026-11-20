import { mpnKey } from '../domain/inventory'
import type { Fetch } from '../sync/oauth'

/** What a distributor knows about a part. */
export interface PartInfo {
  source: 'digikey' | 'mouser' | 'lcsc'
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

export const LOOKUP_SOURCE_NAME: Record<PartInfo['source'], string> = {
  digikey: 'Digi-Key',
  mouser: 'Mouser',
  lcsc: 'LCSC',
}

function absoluteUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined
  const trimmed = url.trim()
  return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

async function failure(response: Response, who: string, keyed = true): Promise<Error> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 200)
  } catch {
    // No body.
  }
  if (keyed && (response.status === 401 || response.status === 403)) {
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

// ---- LCSC -------------------------------------------------------------------

/** Catalog fields shared by the public search and product-detail responses. */
interface LcscProduct {
  productCode?: string
  productModel?: string
  brandNameEn?: string
  productIntroEn?: string
  productDescEn?: string
  productNameEn?: string
  catalogName?: string
  parentCatalogName?: string
  encapStandard?: string
  pdfUrl?: string
  productImages?: string[]
  productImageUrl?: string
  paramVOList?: { paramNameEn?: string; paramValueEn?: string }[]
}

interface LcscSearch {
  scene?: string
  totalCount?: number | null
  exactMatchResult?: LcscProduct[]
  tipProductDetailUrlVO?: { productCode?: string } | null
}

// LCSC refuses requests that have no browser user agent.
const LCSC_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  Origin: 'https://www.lcsc.com',
  Referer: 'https://www.lcsc.com/',
}

export function lcscToPartInfo(product: LcscProduct, exact: boolean): PartInfo {
  const specs: Record<string, string> = {}
  const code = text(product.productCode)
  if (code) specs.LCSC = code
  const pack = text(product.encapStandard)
  if (pack) specs.Package = pack
  for (const parameter of product.paramVOList ?? []) {
    const name = text(parameter.paramNameEn)
    const value = text(parameter.paramValueEn)
    if (name && value && value !== '-') specs[name] = value
  }
  return {
    source: 'lcsc',
    mpn: text(product.productModel) ?? code ?? '',
    exact,
    manufacturer: text(product.brandNameEn),
    description:
      text(product.productIntroEn) ?? text(product.productDescEn) ?? text(product.productNameEn),
    category: text(product.catalogName) ?? text(product.parentCatalogName),
    specs,
    datasheetUrl: absoluteUrl(product.pdfUrl),
    imageUrl: absoluteUrl(product.productImages?.[0] ?? product.productImageUrl),
  }
}

/**
 * LCSC's public catalog, the same one the website searches. No API key.
 * A C-number is loaded directly. Anything else is searched, and a hit is
 * loaded again so the parametric specs (absent from search) are included.
 */
export class LcscClient {
  private readonly fetch: Fetch

  constructor(fetch: Fetch) {
    this.fetch = fetch
  }

  private async result(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetch(url, init)
    if (!response.ok) throw await failure(response, 'LCSC', false)
    const json = (await response.json()) as { code?: number; msg?: string | null; result?: unknown }
    if (typeof json.code === 'number' && json.code !== 200) {
      throw new Error(`LCSC lookup failed: ${text(json.msg) ?? `code ${json.code}`}`)
    }
    return json.result
  }

  private async detail(code: string): Promise<LcscProduct | null> {
    const result = await this.result(
      `https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=${encodeURIComponent(code)}`,
      { headers: LCSC_HEADERS },
    )
    if (!result || typeof result !== 'object') return null
    const product = result as LcscProduct
    return product.productCode ? product : null
  }

  /** Search hits for a model often leave the product list empty. */
  private async productList(keyword: string): Promise<LcscProduct[]> {
    const result = await this.result('https://wmsc.lcsc.com/ftps/wm/product/query/list', {
      method: 'POST',
      headers: { ...LCSC_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, currentPage: 1, pageSize: 10 }),
    })
    if (!result || typeof result !== 'object') return []
    const list = (result as { dataList?: LcscProduct[] }).dataList
    return Array.isArray(list) ? list.filter((row) => text(row.productCode)) : []
  }

  /**
   * Prefer the C-code or the full model. A single model that continues the
   * query is the same part when OCR stopped early, as in "CS1237-So".
   */
  private chooseListed(
    rows: LcscProduct[],
    key: string,
  ): { product: LcscProduct; exact: boolean } | null {
    const codeHit = rows.find((row) => mpnKey(row.productCode) === key)
    if (codeHit) return { product: codeHit, exact: true }
    const modelHit = rows.find((row) => mpnKey(row.productModel) === key)
    if (modelHit) return { product: modelHit, exact: true }
    if (key.length >= 6) {
      const prefix = rows.filter((row) => mpnKey(row.productModel).startsWith(key))
      if (prefix.length === 1) return { product: prefix[0], exact: true }
    }
    return null
  }

  async lookup(mpn: string): Promise<PartInfo | null> {
    const wanted = mpn.trim()
    const key = mpnKey(wanted)
    if (!key) return null
    if (/^C\d+$/.test(key)) {
      const product = await this.detail(key)
      if (product) return lcscToPartInfo(product, true)
    }
    const found = (await this.result('https://wmsc.lcsc.com/ftps/wm/search/v3/global', {
      method: 'POST',
      headers: { ...LCSC_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: wanted }),
    })) as LcscSearch | null
    if (!found) return null
    const redirect = text(found.tipProductDetailUrlVO?.productCode)
    if (found.scene === 'REDIRECT_PRODUCT_DETAIL' && redirect) {
      const product = await this.detail(redirect)
      if (product) return lcscToPartInfo(product, true)
    }
    const hits = found.scene === 'FULL_MATCH' ? (found.exactMatchResult ?? []) : []
    const exactHit = hits.find(
      (hit) => mpnKey(hit.productModel) === key || mpnKey(hit.productCode) === key,
    )
    const chosen = exactHit ?? hits[0]
    const chosenCode = text(chosen?.productCode)
    if (chosen && chosenCode) {
      const product = (await this.detail(chosenCode)) ?? chosen
      return lcscToPartInfo(product, Boolean(exactHit))
    }
    const total = found.totalCount ?? 0
    if (found.scene === 'FULL_MATCH' && total > 0 && total <= 10) {
      const listed = this.chooseListed(await this.productList(wanted), key)
      if (!listed) return null
      const code = text(listed.product.productCode)
      if (!code) return null
      const product = (await this.detail(code)) ?? listed.product
      return lcscToPartInfo(product, listed.exact)
    }
    return null
  }
}

/**
 * An LCSC bag: the C-code is the part LCSC sells. The manufacturer part
 * number is used only when that code is not in the catalog.
 */
export async function lookupLcscLabel(
  fetch: Fetch,
  code: string | undefined,
  mpn: string | undefined,
): Promise<LookupResult> {
  const client = new LcscClient(fetch)
  const errors: string[] = []
  const tryOne = async (query: string | undefined): Promise<PartInfo | null> => {
    const wanted = query?.trim()
    if (!wanted) return null
    try {
      return await client.lookup(wanted)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
      return null
    }
  }
  const codeKey = mpnKey(code)
  if (/^C\d+$/.test(codeKey)) {
    const found = await tryOne(code)
    if (found?.exact) return { info: found, errors: [] }
  }
  const pn = mpn?.trim()
  if (pn && mpnKey(pn) !== codeKey) {
    const found = await tryOne(pn)
    return { info: found, errors: found ? [] : errors }
  }
  return { info: null, errors }
}

// ---- Combined --------------------------------------------------------------

export interface LookupResult {
  info: PartInfo | null
  /** Problems with individual distributors, for display. */
  errors: string[]
}

/**
 * Ask Digi-Key first (it returns full parametric specs), then Mouser, then
 * LCSC. LCSC needs no key. An exact part-number match wins over a similar one.
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
  const lcsc = new LcscClient(fetch)
  attempts.push(() => lcsc.lookup(mpn))
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
