/*
 * The distributor clients are tested against canned responses shaped like
 * the ones in the Digi-Key and Mouser API documentation, and like LCSC's
 * public catalog. They have not been run against the live services.
 */
import { describe, expect, it } from 'vitest'
import type { Fetch } from '../sync/oauth'
import { lookupLcscLabel, lookupPart } from './lookup'

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

const LCSC_DETAIL = {
  productCode: 'C1525',
  productModel: 'CL05B104KO5NNNC',
  brandNameEn: 'Samsung Electro-Mechanics',
  productIntroEn: '100nF ±10% 16V Ceramic Capacitor X7R 0402',
  catalogName: 'Ceramic Capacitors',
  encapStandard: '0402',
  pdfUrl: 'https://datasheet.lcsc.com/datasheet/pdf/c1525.pdf?productCode=C1525',
  productImages: ['https://assets.lcsc.com/images/lcsc/900x900/c1525.jpg'],
  paramVOList: [
    { paramNameEn: 'Capacitance', paramValueEn: '100nF' },
    { paramNameEn: 'Tolerance', paramValueEn: '±10%' },
    { paramNameEn: 'Features', paramValueEn: '-' },
  ],
}

const LCSC_MISS = { code: 200, result: { scene: 'PARTIAL_MATCH', exactMatchResult: [] } }

function distributors(options: {
  digikey?: unknown
  digikeyStatus?: number
  mouser?: unknown
  lcscSearch?: unknown
  lcscDetail?: unknown
  lcscStatus?: number
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
    if (url.includes('wmsc.lcsc.com/ftps/wm/search/v3/global')) {
      return json(options.lcscSearch ?? LCSC_MISS, options.lcscStatus ?? 200)
    }
    if (url.includes('wmsc.lcsc.com/ftps/wm/product/detail')) {
      return json(options.lcscDetail ?? { code: 200, result: null }, options.lcscStatus ?? 200)
    }
    if (url.includes('wmsc.lcsc.com/ftps/wm/product/query/list')) {
      return json({ code: 200, result: { dataList: [] } })
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
    // An exact Digi-Key match means the other catalogs are not asked.
    expect(calls.some((c) => c.url.includes('mouser') || c.url.includes('lcsc'))).toBe(false)
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

  it('reports Mouser API errors and still searches LCSC without a key', async () => {
    const mouserOnly = await lookupPart(
      distributors({
        mouser: { Errors: [{ Message: 'Invalid unique identifier.' }], SearchResults: null },
      }).fetch,
      { mouser: KEYS.mouser },
      'X',
    )
    expect(mouserOnly).toEqual({
      info: null,
      errors: ['Mouser lookup failed: Invalid unique identifier.'],
    })
    const { fetch, calls } = distributors({})
    const none = await lookupPart(fetch, {}, 'C1525')
    expect(none).toEqual({ info: null, errors: [] })
    expect(calls.some((c) => c.url.includes('productCode=C1525'))).toBe(true)
    expect(calls.some((c) => c.url.includes('digikey') || c.url.includes('mouser'))).toBe(false)
  })

  it('searches an LCSC label by C-code and stops when that code is listed', async () => {
    const { fetch, calls } = distributors({ lcscDetail: { code: 200, result: LCSC_DETAIL } })
    const { info, errors } = await lookupLcscLabel(fetch, 'C1525', 'CL05B104KO5NNNC')
    expect(errors).toEqual([])
    expect(info).toMatchObject({ source: 'lcsc', exact: true, mpn: 'CL05B104KO5NNNC' })
    expect(calls.every((c) => c.url.includes('product/detail'))).toBe(true)
    expect(calls.some((c) => c.url.includes('digikey') || c.url.includes('mouser'))).toBe(false)
  })

  it('searches the manufacturer part number when the LCSC C-code is unknown', async () => {
    const { fetch, calls } = distributors({
      lcscSearch: {
        code: 200,
        result: { scene: 'FULL_MATCH', exactMatchResult: [LCSC_DETAIL] },
      },
    })
    const { info } = await lookupLcscLabel(fetch, 'C999999', 'CL05B104KO5NNNC')
    expect(info).toMatchObject({ source: 'lcsc', exact: true, mpn: 'CL05B104KO5NNNC' })
    expect(calls[0].url).toContain('productCode=C999999')
    expect(calls.some((c) => c.url.includes('search/v3'))).toBe(true)
  })

  it('recovers a cut-off LCSC part number from the product list', async () => {
    const adc = {
      productCode: 'C77801',
      productModel: 'CS1237-SOP8',
      brandNameEn: 'CHIPSEA',
      productIntroEn: '24 Bit Analog to Digital Converter 1 Input Sigma-Delta SOP-8',
      catalogName: 'Analog to Digital Converters (ADC)',
      encapStandard: 'SOP-8',
      pdfUrl: 'https://datasheet.lcsc.com/datasheet/pdf/cs1237.pdf?productCode=C77801',
      productImages: ['https://assets.lcsc.com/images/lcsc/900x900/c77801.jpg'],
      paramVOList: [{ paramNameEn: 'Resolution', paramValueEn: '24 bit' }],
    }
    let details = 0
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, init })
      if (url.includes('product/detail')) {
        details += 1
        if (details === 1) return new Response('denied', { status: 403 })
        return json({ code: 200, result: adc })
      }
      if (url.includes('search/v3')) {
        return json({
          code: 200,
          result: { scene: 'FULL_MATCH', totalCount: 1, exactMatchResult: [] },
        })
      }
      if (url.includes('product/query/list')) {
        return json({
          code: 200,
          result: {
            dataList: [
              { productCode: 'C77801', productModel: 'CS1237-SOP8' },
              { productCode: 'C777801', productModel: 'MM1Z15B' },
            ],
          },
        })
      }
      return json({}, 404)
    }
    const { info, errors } = await lookupLcscLabel(fetch, 'C77801', 'CS1237-So')
    expect(errors).toEqual([])
    expect(info).toMatchObject({
      source: 'lcsc',
      exact: true,
      mpn: 'CS1237-SOP8',
      manufacturer: 'CHIPSEA',
      specs: { LCSC: 'C77801', Resolution: '24 bit' },
    })
    const list = calls.find((c) => c.url.includes('product/query/list'))
    expect(JSON.parse(list?.init?.body as string).keyword).toBe('CS1237-So')
  })

  it('maps an LCSC C-number to the manufacturer part, with specs', async () => {
    const { fetch, calls } = distributors({ lcscDetail: { code: 200, result: LCSC_DETAIL } })
    const { info, errors } = await lookupPart(fetch, {}, 'c1525')
    expect(errors).toEqual([])
    expect(info).toEqual({
      source: 'lcsc',
      exact: true,
      mpn: 'CL05B104KO5NNNC',
      manufacturer: 'Samsung Electro-Mechanics',
      description: '100nF ±10% 16V Ceramic Capacitor X7R 0402',
      category: 'Ceramic Capacitors',
      specs: {
        LCSC: 'C1525',
        Package: '0402',
        Capacitance: '100nF',
        Tolerance: '±10%',
      },
      datasheetUrl: 'https://datasheet.lcsc.com/datasheet/pdf/c1525.pdf?productCode=C1525',
      imageUrl: 'https://assets.lcsc.com/images/lcsc/900x900/c1525.jpg',
    })
    expect(calls.some((c) => c.url.includes('search/v3'))).toBe(false)
    expect(calls.some((c) => c.url.includes('productCode=C1525'))).toBe(true)
  })

  it('searches LCSC by manufacturer part number and loads the detail for specs', async () => {
    const { fetch, calls } = distributors({
      lcscSearch: {
        code: 200,
        result: {
          scene: 'FULL_MATCH',
          exactMatchResult: [{ ...LCSC_DETAIL, paramVOList: [] }],
        },
      },
      lcscDetail: { code: 200, result: LCSC_DETAIL },
    })
    const { info } = await lookupPart(fetch, {}, 'CL05B104KO5NNNC')
    expect(info).toMatchObject({
      source: 'lcsc',
      exact: true,
      mpn: 'CL05B104KO5NNNC',
      specs: { Capacitance: '100nF', Tolerance: '±10%' },
    })
    const search = calls.find((c) => c.url.includes('search/v3'))!
    expect(JSON.parse(search.init?.body as string).keyword).toBe('CL05B104KO5NNNC')
    expect(calls.some((c) => c.url.includes('productCode=C1525'))).toBe(true)
  })

  it('treats a redirected LCSC search as that one product', async () => {
    const { fetch } = distributors({
      lcscSearch: {
        code: 200,
        result: {
          scene: 'REDIRECT_PRODUCT_DETAIL',
          tipProductDetailUrlVO: { productCode: 'C1525' },
          exactMatchResult: [],
        },
      },
      lcscDetail: { code: 200, result: LCSC_DETAIL },
    })
    const { info } = await lookupPart(fetch, {}, 'CL05B104KO5NNNC')
    expect(info).toMatchObject({ exact: true, mpn: 'CL05B104KO5NNNC' })
  })

  it('keeps a loose LCSC hit as a suggestion', async () => {
    const { fetch } = distributors({
      lcscSearch: {
        code: 200,
        result: { scene: 'FULL_MATCH', exactMatchResult: [LCSC_DETAIL] },
      },
      lcscDetail: { code: 200, result: LCSC_DETAIL },
    })
    const { info } = await lookupPart(fetch, {}, 'CL05B104')
    expect(info).toMatchObject({ source: 'lcsc', exact: false, mpn: 'CL05B104KO5NNNC' })
  })

  it('prefers an exact LCSC match over a similar Digi-Key one', async () => {
    const { fetch } = distributors({
      digikey: { Products: [{ ...DIGIKEY_PRODUCT, ManufacturerProductNumber: 'CL05B104KO5NNND' }] },
      lcscSearch: {
        code: 200,
        result: { scene: 'FULL_MATCH', exactMatchResult: [LCSC_DETAIL] },
      },
      lcscDetail: { code: 200, result: LCSC_DETAIL },
    })
    const { info } = await lookupPart(fetch, KEYS, 'CL05B104KO5NNNC')
    expect(info).toMatchObject({ source: 'lcsc', exact: true })
  })

  it('ignores a broad LCSC partial search', async () => {
    const { fetch, calls } = distributors({
      lcscSearch: { code: 200, result: { scene: 'PARTIAL_MATCH', totalCount: 60000, exactMatchResult: [] } },
    })
    expect(await lookupPart(fetch, {}, 'NOPE-123')).toEqual({ info: null, errors: [] })
    expect(calls.some((c) => c.url.includes('product/detail'))).toBe(false)
  })

  it('reports an LCSC catalog error', async () => {
    const { fetch } = distributors({
      lcscDetail: { code: 500, msg: 'busy', result: null },
    })
    const { info, errors } = await lookupPart(fetch, {}, 'C1525')
    expect(info).toBeNull()
    expect(errors).toEqual(['LCSC lookup failed: busy'])
  })

  it('finds nothing without error when the part is unknown', async () => {
    const { fetch } = distributors({})
    expect(await lookupPart(fetch, KEYS, 'NOPE-123')).toEqual({ info: null, errors: [] })
  })
})
