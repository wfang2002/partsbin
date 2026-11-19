import { describe, expect, it } from 'vitest'
import { parseBom } from './bom'
import { parseCsv } from './csv'
import { parseOrderCsv } from './orders'

describe('parseCsv', () => {
  it('handles quotes, embedded delimiters, line breaks and a BOM', () => {
    const text = '\uFEFF"a","b,c","say ""hi"""\r\n1,"two\nlines",3\r\n\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ])
  })

  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseBom', () => {
  it('reads a grouped KiCad BOM and skips parts marked do-not-populate', () => {
    const csv = [
      '"Reference","Value","Datasheet","Footprint","Qty","DNP"',
      '"C1,C2,C3","100nF","~","Capacitor_SMD:C_0603_1608Metric","3",""',
      '"R1,R2","10k","~","Resistor_SMD:R_0603_1608Metric","2",""',
      '"U1","ATmega328P-AU","http://x","Package_QFP:TQFP-32_7x7mm_P0.8mm","1",""',
      '"J9","Conn","~","Connector:Test","1","DNP"',
    ].join('\n')
    expect(parseBom(csv)).toEqual([
      { mpn: '100nF 0603', qty: 3, refs: 'C1, C2, C3' },
      { mpn: '10k 0603', qty: 2, refs: 'R1, R2' },
      { mpn: 'ATmega328P-AU TQFP-32_7x7mm_P0.8mm', qty: 1, refs: 'U1' },
    ])
  })

  it('prefers a part number column and groups one-row-per-component files', () => {
    const csv = [
      'Reference;Value;Footprint;MPN',
      'R1;10k;R_0603;RC0603FR-0710KL',
      'R2;10k;R_0603;RC0603FR-0710KL',
      'U1;NE555;SOIC-8;NE555DR',
    ].join('\n')
    expect(parseBom(csv)).toEqual([
      { mpn: 'RC0603FR-0710KL', qty: 2, refs: 'R1, R2' },
      { mpn: 'NE555DR', qty: 1, refs: 'U1' },
    ])
  })

  it('skips the preamble of the legacy KiCad exporter', () => {
    const csv = [
      'Source:,/home/me/board.kicad_sch',
      'Date:,2026-01-01',
      'Component Count:,3',
      '',
      'Collated Components:',
      '',
      'Item,Qty,Reference(s),Value,LibPart,Footprint,Datasheet',
      '1,2,"D1, D2",1N4148,Device:D,Diode_SMD:D_SOD-123,~',
    ].join('\n')
    expect(parseBom(csv)).toEqual([
      { mpn: '1N4148 D_SOD-123', qty: 2, refs: 'D1, D2' },
    ])
  })

  it('explains files it cannot read', () => {
    expect(() => parseBom('hello,world\n1,2')).toThrow(/BOM columns/)
    expect(() => parseBom('Reference,Value\n')).toThrow(/no component rows/)
  })
})

describe('parseOrderCsv', () => {
  it('reads a Digi-Key order export', () => {
    const csv = [
      'Index,Quantity,Part Number,Manufacturer Part Number,Description,Customer Reference,Available,Backorder,Unit Price,Extended Price',
      '1,100,311-10.0KHRCT-ND,RC0603FR-0710KL,RES 10K OHM 1% 1/10W 0603,,100,0,0.00370,$0.37',
      '2,"1,000",1276-1000-1-ND,CL10B104KB8NNNC,"CAP CER 0.1UF 50V X7R 0603",,1000,0,0.0056,$5.60',
      ',,,,,,,Subtotal,,$5.97',
    ].join('\n')
    expect(parseOrderCsv(csv)).toEqual([
      {
        mpn: 'RC0603FR-0710KL',
        qty: 100,
        description: 'RES 10K OHM 1% 1/10W 0603',
        distributorPn: '311-10.0KHRCT-ND',
        manufacturer: undefined,
        package: undefined,
      },
      {
        mpn: 'CL10B104KB8NNNC',
        qty: 1000,
        description: 'CAP CER 0.1UF 50V X7R 0603',
        distributorPn: '1276-1000-1-ND',
        manufacturer: undefined,
        package: undefined,
      },
    ])
  })

  it('reads Mouser and LCSC style headers', () => {
    const mouser = [
      'Mouser #,Mfr. #,Manufacturer,Customer #,Description,RoHS,Lifecycle,Order Qty.,Price (USD),Ext.: (USD)',
      '595-SN74HC595DR,SN74HC595DR,Texas Instruments,,Counter Shift Registers,RoHS,,25,$0.41,$10.25',
    ].join('\n')
    expect(parseOrderCsv(mouser)[0]).toMatchObject({
      mpn: 'SN74HC595DR',
      distributorPn: '595-SN74HC595DR',
      manufacturer: 'Texas Instruments',
      qty: 25,
    })
    const lcsc = [
      'LCSC Part Number,Manufacture Part Number,Manufacturer,Customer NO.,Package,Description,RoHS,Order Qty.,Min\\Mult Order Qty.,Unit Price($),Order Price($)',
      'C1525,CL05B104KO5NNNC,Samsung Electro-Mechanics,,0402,100nF 16V X7R,YES,500,100\\100,0.0012,0.6',
    ].join('\n')
    expect(parseOrderCsv(lcsc)[0]).toMatchObject({
      mpn: 'CL05B104KO5NNNC',
      distributorPn: 'C1525',
      package: '0402',
      qty: 500,
    })
  })

  it('explains files it cannot read', () => {
    expect(() => parseOrderCsv('a,b\n1,2')).toThrow(/order columns/)
  })
})
