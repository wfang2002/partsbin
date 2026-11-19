/*
 * The distributor clients are tested against canned responses shaped like
 * the ones in the Digi-Key and Mouser API documentation. They have not been
 * run against the live services (that needs API keys).
 */
import { describe, expect, it } from 'vitest'
import type { Fetch } from '../sync/oauth'
import { lookupPart } from './lookup'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const DIGIKEY_PRODUCT = {
  ManufacturerProductNumber: 'RC0603FR-0710KL',
  Manufacturer: { Id: 13, Name: 'YAGEO' },
  Description: {
    ProductDescription: 'RES 10K OHM 1% 1/10W 0603',
    DetailedDescription: '10 kOhms ±1% 0.1W, 1/10W Chip Resistor 0603',
  },
  DatasheetUrl: '//www.yageo.com/upload/media/product/RC.pdf',
  PhotoUrl: 'https://mm.digikey.com/Volume0/photos/RC0603.jpg',
  Category: {
    Name: 'Resistors',
    ChildCategories: [{ Name: 'Chip Resistor - Surface Mount', ChildCategories: [] }],
  },
  Parameters: [
    { ParameterText: 'Resistance', ValueText: '10 kOhms' },
    { ParameterText: 'Tolerance', ValueText: '±1%' },
    { ParameterText: 'Features', ValueText: '-' },
  ],
  ProductVariations: [{ DigiKeyProductNumber: '311-10.0KHRCT-ND' }],
}

const MOUSER_PART = {
  ManufacturerPartNumber: 'SN74HC595DR',
  MouserPartNumber: '595-SN74HC595DR',
  Manufacturer: 'Texas Instruments',
  Description: 'Counter Shift Registers 8-Bit Shift Register',
  Category: 'Counter Shift Registers',
  DataSheetUrl: 'https://www.mouser.com/datasheet/2/405/sn74hc595.pdf',
  ImagePath: 'https://www.mouser.com/images/texasinstruments/images/SOIC_16.jpg',
  ProductAttributes: [
    { AttributeName: 'Packaging', AttributeValue: 'Reel' },
    { AttributeName: 'Packaging', AttributeValue: 'Cut Tape' },
  ],
}

function distributors(options: {
  digikey?: unknown
  digikeyStatus?: number
  mouser?: unknown
}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/v1/oauth2/token')) {
      return json({ access_token: 'tok', expires_in: 600 })
    }
    if (url.includes('digikey.com/products/v4/search/keyword')) {
      return json(options.digikey ?? { Products: [] }, options.digikeyStatus ?? 200)
    }
    if (url.includes('api.mouser.com/api/v1/search/partnumber')) {
      return json(options.mouser ?? { Errors: [], SearchResults: { Parts: [] } })
    }
    return json({}, 404)
  }
  return { fetch, calls }
}

const KEYS = {
  digikey: { clientId: 'id', clientSecret: 'secret' },
  mouser: { apiKey: 'mkey' },
}

describe('lookupPart', () => {
  it('maps a Digi-Key product', async () => {
    const { fetch, calls } = distributors({
      digikey: { Products: [DIGIKEY_PRODUCT], ExactMatches: [] },
    })
    const { info, errors } = await lookupPart(fetch, KEYS, 'rc0603fr-0710kl')
    expect(errors).toEqual([])
    expect(info).toEqual({
      source: 'digikey',
      exact: true,
      mpn: 'RC0603FR-0710KL',
      manufacturer: 'YAGEO',
      description: 'RES 10K OHM 1% 1/10W 0603',
      category: 'Chip Resistor - Surface Mount',
      specs: { Resistance: '10 kOhms', Tolerance: '±1%' },
      datasheetUrl: 'https://www.yageo.com/upload/media/product/RC.pdf',
      imageUrl: 'https://mm.digikey.com/Volume0/photos/RC0603.jpg',
    })
    // An exact Digi-Key match means Mouser is not asked.
    expect(calls.some((c) => c.url.includes('mouser'))).toBe(false)
    const search = calls.find((c) => c.url.includes('search/keyword'))!
    const headers = new Headers(search.init?.headers as HeadersInit)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('X-DIGIKEY-Client-Id')).toBe('id')
    expect(JSON.parse(search.init?.body as string).Keywords).toBe('rc0603fr-0710kl')
  })

  it('matches a Digi-Key order code as well as the part number', async () => {
    const { fetch } = distributors({ digikey: { Products: [DIGIKEY_PRODUCT] } })
    const { info } = await lookupPart(fetch, KEYS, '311-10.0KHRCT-ND')
    expect(info).toMatchObject({ exact: true, mpn: 'RC0603FR-0710KL' })
  })

  it('falls back to Mouser and merges repeated attributes', async () => {
    const { fetch } = distributors({
      mouser: { Errors: [], SearchResults: { NumberOfResult: 1, Parts: [MOUSER_PART] } },
    })
    const { info } = await lookupPart(fetch, KEYS, 'SN74HC595DR')
    expect(info).toMatchObject({
      source: 'mouser',
      exact: true,
      manufacturer: 'Texas Instruments',
      category: 'Counter Shift Registers',
      specs: { Packaging: 'Reel, Cut Tape' },
    })
  })

  it('prefers an exact Mouser match over a similar Digi-Key one', async () => {
    const { fetch } = distributors({
      digikey: { Products: [{ ...DIGIKEY_PRODUCT, ManufacturerProductNumber: 'SN74HC595DRG4' }] },
      mouser: { Errors: [], SearchResults: { Parts: [MOUSER_PART] } },
    })
    const { info } = await lookupPart(fetch, KEYS, 'SN74HC595DR')
    expect(info).toMatchObject({ source: 'mouser', exact: true })
  })

  it('returns the closest match, marked as not exact, when nothing matches', async () => {
    const { fetch } = distributors({ digikey: { Products: [DIGIKEY_PRODUCT] } })
    const { info } = await lookupPart(fetch, KEYS, 'RC0603')
    expect(info).toMatchObject({ exact: false, mpn: 'RC0603FR-0710KL' })
  })

  it('reports a rejected key and still tries the other distributor', async () => {
    const { fetch } = distributors({
      digikeyStatus: 401,
      mouser: { Errors: [], SearchResults: { Parts: [MOUSER_PART] } },
    })
    const { info, errors } = await lookupPart(fetch, KEYS, 'SN74HC595DR')
    expect(info?.source).toBe('mouser')
    expect(errors).toEqual(['Digi-Key did not accept the API key. Check it in Settings.'])
  })

  it('reports Mouser API errors and missing keys', async () => {
    const { fetch } = distributors({
      mouser: { Errors: [{ Message: 'Invalid unique identifier.' }], SearchResults: null },
    })
    const mouserOnly = await lookupPart(fetch, { mouser: KEYS.mouser }, 'X')
    expect(mouserOnly).toEqual({
      info: null,
      errors: ['Mouser lookup failed: Invalid unique identifier.'],
    })
    const none = await lookupPart(fetch, {}, 'X')
    expect(none.info).toBeNull()
    expect(none.errors[0]).toMatch(/API key/)
  })

  it('finds nothing without error when the part is unknown', async () => {
    const { fetch } = distributors({})
    expect(await lookupPart(fetch, KEYS, 'NOPE-123')).toEqual({ info: null, errors: [] })
  })
})
