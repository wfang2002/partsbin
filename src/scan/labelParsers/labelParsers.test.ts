import { describe, expect, it } from 'vitest'
import type { Barcode } from '../types'
import { parseAnsiFields, parseAnsiLabel, parseLinearField } from './ansi'
import { parseGenericText } from './generic'
import { locationQrPayload, parseLabel, parseLocationQr } from './index'
import { parseLcscLabel, parseLcscPrinted } from './lcsc'

const GS = '\x1d'
const RS = '\x1e'
const EOT = '\x04'
const ansi = (...fields: string[]) => `[)>${RS}06${GS}${fields.join(GS)}${RS}${EOT}`
const code = (text: string, format = 'DataMatrix'): Barcode => ({ format, text })

// Field layouts as published for Digi-Key and Mouser bag labels.
const DIGIKEY = ansi(
  'P455-1135-1-ND',
  '1PB3B-XH-A(LF)(SN)',
  'K',
  '1K64850195',
  '10K76595981',
  '11K1',
  '4LJP',
  'Q10',
  '11ZPICK',
  '12Z1837012',
  '13Z804297',
  '20Z0000000000000000000000000',
)
const DIGIKEY_NEW = ansi(
  'PRC0603FR-0710KL',
  '1PRC0603FR-0710KL',
  '30P311-10.0KHRCT-ND',
  'K',
  '1K80000000',
  '10K90000000',
  '9D2231',
  '1T12345',
  '11K1',
  '4LTW',
  'Q100',
)
const MOUSER = ansi(
  'K12345678',
  '14K001',
  '1PSN74HC595DR',
  'Q25',
  '11K087654321',
  '4LMX',
  '1VTexas Instruments',
)

describe('ANSI MH10.8.2 labels', () => {
  it('splits a label into its data identifiers', () => {
    const fields = parseAnsiFields(DIGIKEY)
    expect(fields?.get('1P')).toBe('B3B-XH-A(LF)(SN)')
    expect(fields?.get('P')).toBe('455-1135-1-ND')
    expect(fields?.get('Q')).toBe('10')
    expect(fields?.has('K')).toBe(false)
  })

  it('reads a Digi-Key bag', () => {
    expect(parseAnsiLabel(DIGIKEY)).toMatchObject({
      source: 'digikey',
      mpn: 'B3B-XH-A(LF)(SN)',
      qty: 10,
      distributorPn: '455-1135-1-ND',
      confidence: 'high',
    })
    expect(parseAnsiLabel(DIGIKEY_NEW)).toMatchObject({
      source: 'digikey',
      mpn: 'RC0603FR-0710KL',
      qty: 100,
      distributorPn: '311-10.0KHRCT-ND',
    })
  })

  it('reads a Mouser bag', () => {
    expect(parseAnsiLabel(MOUSER)).toMatchObject({
      source: 'mouser',
      mpn: 'SN74HC595DR',
      qty: 25,
      manufacturer: 'Texas Instruments',
    })
  })

  it('rejects other barcodes', () => {
    expect(parseAnsiLabel('https://example.com')).toBeNull()
    expect(parseAnsiLabel('[)>')).toBeNull()
    expect(parseAnsiLabel(ansi('K123', 'Q5'))).toBeNull()
  })

  it('reads single-field linear barcodes', () => {
    expect(parseLinearField('1PSN74HC595DR')).toEqual({ mpn: 'SN74HC595DR' })
    expect(parseLinearField('Q2500')).toEqual({ qty: 2500 })
    expect(parseLinearField('0123456789')).toBeNull()
  })
})

describe('LCSC labels', () => {
  it('reads the QR code on an LCSC bag', () => {
    const qr =
      '{pbn:PICK2009291337,on:SO2009291337,pc:C1525,pm:CL05B104KO5NNNC,qty:500,mc:,cc:1,pdi:34421807}'
    expect(parseLcscLabel(qr)).toMatchObject({
      source: 'lcsc',
      mpn: 'CL05B104KO5NNNC',
      distributorPn: 'C1525',
      qty: 500,
      confidence: 'high',
    })
  })

  it('rejects other text', () => {
    expect(parseLcscLabel('{"json": true}')).toBeNull()
    expect(parseLcscLabel('C1525')).toBeNull()
    expect(parseLcscPrinted('C1525\nCL05B104KO5NNNC')).toBeNull()
  })

  it('reads a printed label that says LCSC.COM', () => {
    const text = ['www.LCSC.COM', 'C1525', 'P/N: CL05B104KO5NNNC', '100nF 16V 0402', 'QTY: 100'].join(
      '\n',
    )
    expect(parseLcscPrinted(text)).toMatchObject({
      source: 'lcsc',
      distributorPn: 'C1525',
      mpn: 'CL05B104KO5NNNC',
      qty: 100,
      confidence: 'high',
      specs: { LCSC: 'C1525' },
    })
  })

  it('reads a photographed LCSC bag whose part number was cut off by OCR', () => {
    const text = [
      '25-D03-Q',
      'C77801',
      'MER P/N: CS1237-So',
      'Customer No: -',
      'Description:24 1 SPI SOP-',
      '8_15emil Analog To Digita',
      'L Converters (ADC. ..',
      'SO1911063623',
      '1106-0043',
      'QTY: 40',
      'SOP-8_150',
      'mil',
      '85/9F',
      'LCSC.COM',
    ].join('\n')
    expect(parseLabel([], text)).toMatchObject({
      source: 'lcsc',
      distributorPn: 'C77801',
      mpn: 'CS1237-So',
      qty: 40,
    })
  })

  it('reads an unlabelled C-code and part number under LCSC.COM', () => {
    expect(parseLcscPrinted('LCSC.COM\nC25804\nRC0603FR-0710KL')).toMatchObject({
      source: 'lcsc',
      distributorPn: 'C25804',
      mpn: 'RC0603FR-0710KL',
    })
  })
})

describe('printed text', () => {
  it('prefers a labelled manufacturer part number', () => {
    const text = [
      'Mouser Part No: 595-SN74HC595DR',
      'MFG P/N: SN74HC595DR',
      'Desc: Counter Shift Registers 8-Bit',
      'QTY: 25',
    ].join('\n')
    expect(parseGenericText(text)).toMatchObject({
      source: 'ocr',
      mpn: 'SN74HC595DR',
      confidence: 'high',
      qty: 25,
      description: 'Counter Shift Registers 8-Bit',
    })
  })

  it('does not take a distributor number for the part number', () => {
    const label = parseGenericText('Digi-Key Part Number: 296-1600-1-ND\nQTY 5')
    expect(label.confidence).toBe('low')
  })

  it('reads the value, package and count from a resistor bag', () => {
    const label = parseGenericText('0603 10K 1% 100pcs')
    expect(label.mpn).toBeUndefined()
    expect(label.qty).toBe(100)
    expect(label.specs).toMatchObject({
      Resistance: '10K',
      Package: '0603',
      Tolerance: '1%',
    })
    expect(label.description).toBe('Resistor 10K 1% 0603')
  })

  it('reads a capacitor bag', () => {
    const label = parseGenericText('100nF 50V X7R 0805 ±10% x50')
    expect(label.specs).toMatchObject({
      Capacitance: '100nF',
      Voltage: '50V',
      Package: '0805',
      Tolerance: '10%',
    })
    expect(label.specs.Resistance).toBeUndefined()
    expect(label.qty).toBe(50)
  })

  it('guesses an unlabelled part number with low confidence', () => {
    const label = parseGenericText('ESP32-WROOM-32E\nWiFi module 5PCS\nMade in China')
    expect(label.mpn).toBe('ESP32-WROOM-32E')
    expect(label.confidence).toBe('low')
    expect(label.qty).toBe(5)
  })

  it('handles empty text', () => {
    expect(parseGenericText('  ')).toMatchObject({ source: 'none', mpnCandidates: [] })
  })
})

describe('parseLabel', () => {
  it('trusts the barcode and keeps printed extras', () => {
    const label = parseLabel(
      [code('0123456789', 'Code128'), code(DIGIKEY)],
      'B3B-XH-A(LF)(SN)\nCONN HEADER VERT 3POS 2.5MM\nDesc: CONN HEADER VERT 3POS',
    )
    expect(label).toMatchObject({
      source: 'digikey',
      mpn: 'B3B-XH-A(LF)(SN)',
      qty: 10,
      description: 'CONN HEADER VERT 3POS',
    })
    expect(label.mpnCandidates).not.toContain('B3B-XH-A(LF)(SN)')
  })

  it('combines the linear barcodes of a Mouser bag', () => {
    const label = parseLabel(
      [code('1PSN74HC595DR', 'Code128'), code('Q25', 'Code128'), code('K998877')],
      'MOUSER ELECTRONICS',
    )
    expect(label).toMatchObject({
      source: 'mouser',
      mpn: 'SN74HC595DR',
      qty: 25,
      confidence: 'high',
    })
  })

  it('uses LCSC when the printed label says LCSC.COM', () => {
    const text = 'LCSC.COM\nC1525\nP/N: CL05B104KO5NNNC\nQTY: 20'
    const label = parseLabel([], text)
    expect(label).toMatchObject({
      source: 'lcsc',
      distributorPn: 'C1525',
      mpn: 'CL05B104KO5NNNC',
      qty: 20,
    })
  })

  it('keeps the QR C-code and part number when the bag also says LCSC.COM', () => {
    const qr =
      '{pbn:PICK2009291337,on:SO2009291337,pc:C1525,pm:CL05B104KO5NNNC,qty:500,mc:,cc:1,pdi:34421807}'
    const label = parseLabel([code(qr, 'QRCode')], 'www.LCSC.COM\nC1525\nCL05B104KO5NNNC')
    expect(label).toMatchObject({
      source: 'lcsc',
      distributorPn: 'C1525',
      mpn: 'CL05B104KO5NNNC',
      qty: 500,
    })
  })

  it('falls back to printed text when no barcode is understood', () => {
    const label = parseLabel([code('0123456789')], '0603 10K 1% 100pcs')
    expect(label.source).toBe('ocr')
    expect(label.specs.Resistance).toBe('10K')
  })

  it('recognises PartsBin box stickers', () => {
    const payload = locationQrPayload('0123456789abcdef')
    expect(parseLocationQr(payload)).toBe('0123456789abcdef')
    expect(parseLocationQr('PB:L:xyz')).toBeNull()
    expect(parseLocationQr(DIGIKEY)).toBeNull()
  })
})
