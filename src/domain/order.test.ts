import { describe, expect, it } from 'vitest'
import { compareName, groupByCategory, sortByName } from './order'

describe('sortByName', () => {
  const boxes = [{ name: 'Box 10' }, { name: 'box 2' }, { name: 'Shelf' }]

  it('sorts names A–Z, with numbers in numeric order', () => {
    expect(sortByName(boxes, (b) => b.name, 'asc').map((b) => b.name)).toEqual([
      'box 2',
      'Box 10',
      'Shelf',
    ])
  })

  it('sorts names Z–A', () => {
    expect(sortByName(boxes, (b) => b.name, 'desc').map((b) => b.name)).toEqual([
      'Shelf',
      'Box 10',
      'box 2',
    ])
  })
})

describe('groupByCategory', () => {
  const parts = [
    { id: 'c', name: 'C10', category: 'Capacitor' },
    { id: 'a', name: 'R2', category: 'resistor' },
    { id: 'b', name: 'R10', category: 'Resistor' },
    { id: 'd', name: 'LM358', category: '  ' },
    { id: 'e', name: 'D1' },
  ]

  it('keeps categories A–Z and sorts parts inside each one', () => {
    const groups = groupByCategory(
      parts,
      (p) => p.category,
      (a, b) => compareName(a.name, b.name, 'desc'),
    )
    expect(groups.map((g) => g.label)).toEqual(['Capacitor', 'resistor', 'No category'])
    expect(groups[1].items.map((p) => p.name)).toEqual(['R10', 'R2'])
    expect(groups[2].items.map((p) => p.name)).toEqual(['LM358', 'D1'])
  })
})
