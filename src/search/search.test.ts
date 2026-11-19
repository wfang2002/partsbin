import { describe, expect, it } from 'vitest'
import { buildInventory } from '../domain/inventory'
import type { Location, Part, Stock } from '../domain/types'
import { buildIndex, search } from './index'
import { canonicalValue, joinSplitValues, parseValue } from './values'

describe('parseValue', () => {
  it.each([
    ['10k', 10_000],
    ['10K', 10_000],
    ['10kΩ', 10_000],
    ['10kohm', 10_000],
    ['10000', 10_000],
    ['4k7', 4_700],
    ['4R7', 4.7],
    ['100R', 100],
    ['2M2', 2_200_000],
    ['1M', 1_000_000],
    ['100n', 1e-7],
    ['100nF', 1e-7],
    ['0.1uF', 1e-7],
    ['0.1UF', 1e-7],
    ['0.1µF', 1e-7],
    ['22pF', 22e-12],
    ['4n7', 4.7e-9],
    ['10uH', 1e-5],
    ['3.3V', 3.3],
    ['800MA', 0.8],
    ['800mA', 0.8],
    ['16MHz', 16e6],
    ['16MHZ', 16e6],
    ['10m', 0.01],
  ])('%s -> %d', (token, expected) => {
    expect(parseValue(token)).toBeCloseTo(expected, 15)
  })

  it.each(['LM358', 'SOT-23', 'abc', '1N4148', 'X7R', '10g', '1%'])(
    '%s is not a value',
    (token) => {
      expect(parseValue(token)).toBeNull()
    },
  )

  it('gives equal values the same canonical token', () => {
    const forms = ['10k', '10kΩ', '10000', '10K'].map(canonicalValue)
    expect(new Set(forms)).toEqual(new Set(['=1e4']))
    expect(canonicalValue('100n')).toBe(canonicalValue('0.1uF'))
    expect(canonicalValue('100n')).toBe('=1e-7')
  })

  it('joins a number and its unit', () => {
    expect(joinSplitValues('CAP 100 nF 50 V X7R')).toBe('CAP 100nF 50V X7R')
    expect(joinSplitValues('RES 10 kΩ 1%')).toBe('RES 10kΩ 1%')
    expect(joinSplitValues('LM1117 V2 board')).toBe('LM1117 V2 board')
  })
})

describe('search', () => {
  const locations: Location[] = [
    { id: 'garage', parentId: null, name: 'Garage', kind: 'room' },
    { id: 'rackb', parentId: 'garage', name: 'Rack B', kind: 'rack' },
    { id: 'box12', parentId: 'rackb', name: 'Box 12', kind: 'box' },
  ]
  const part = (id: string, fields: Partial<Part>): Part => ({
    id,
    specs: {},
    tags: [],
    ...fields,
  })
  const parts: Part[] = [
    part('r10k', {
      mpn: 'RC0603FR-0710KL',
      description: 'RES 10K OHM 1% 1/10W 0603',
      category: 'Chip Resistor - Surface Mount',
    }),
    part('r1k', {
      mpn: 'RC0603FR-071KL',
      description: 'RES 1K OHM 1% 1/10W 0603',
    }),
    part('c100n', {
      mpn: 'CL10B104KB8NNNC',
      description: 'CAP CER 0.1UF 50V X7R 0603',
    }),
    part('c100n0805', { description: 'Capacitor 100 nF 0805', tags: ['bulk'] }),
    part('ldo', {
      mpn: 'AMS1117-3.3',
      description: 'IC REG LINEAR 3.3V 1A SOT223',
      specs: { 'Voltage - Output': '3.3V', 'Current - Output': '1A' },
      tags: ['ldo'],
    }),
    part('mcu', { mpn: 'ATMEGA328P-AU', description: 'IC MCU 8BIT 32KB TQFP' }),
    part('hand', { ocrText: 'blue LED 5mm x50', description: 'LED' }),
  ]
  const stock: Stock[] = [
    { id: 's1', partId: 'r10k', locationId: 'box12', lastSeenAt: 0 },
  ]
  const inv = buildInventory(locations, parts, stock, [])
  const index = buildIndex(inv)
  const ids = (query: string) =>
    search(index, query)
      .filter((h) => h.kind === 'part')
      .map((h) => h.id)

  it('matches resistor values written differently', () => {
    expect(ids('10k 0603')).toEqual(['r10k'])
    expect(ids('10kΩ')).toEqual(['r10k'])
    expect(ids('10000 0603')).toEqual(['r10k'])
    expect(ids('1k 0603')).toEqual(['r1k'])
  })

  it('matches capacitor values across prefixes', () => {
    expect(ids('100n').sort()).toEqual(['c100n', 'c100n0805'])
    expect(ids('0.1uF').sort()).toEqual(['c100n', 'c100n0805'])
    expect(ids('100nF 0805')).toEqual(['c100n0805'])
  })

  it('finds parts by specs, tags and partial part numbers', () => {
    expect(ids('3.3V LDO')).toEqual(['ldo'])
    expect(ids('ams1117')).toEqual(['ldo'])
    expect(ids('1117')).toEqual(['ldo'])
    expect(ids('328p')).toEqual(['mcu'])
    expect(ids('atmega')).toEqual(['mcu'])
    expect(ids('sot223')).toEqual(['ldo'])
  })

  it('searches OCR text and location names', () => {
    expect(ids('blue led')).toEqual(['hand'])
    expect(ids('rack b')).toEqual(['r10k'])
    const hits = search(index, 'box 12')
    expect(hits.some((h) => h.kind === 'location' && h.id === 'box12')).toBe(true)
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(ids('')).toEqual([])
    expect(ids('zzzzqqq')).toEqual([])
  })
})
