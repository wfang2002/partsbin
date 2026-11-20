import { describe, expect, it } from 'vitest'
import { applyReading, newInboxItem } from './inbox'

describe('inbox', () => {
  it('copies what was read from the label onto the waiting photo', () => {
    const item = newInboxItem('a', 'box', 'hash', 1)
    const ready = applyReading(item, {
      ocrText: 'LM358',
      warnings: [],
      label: {
        source: 'ocr',
        mpn: 'LM358',
        specs: {},
        mpnCandidates: ['LM358', 'TI'],
        confidence: 'low',
        qty: 10,
      },
    })
    expect(ready.state).toBe('ready')
    expect(ready.mpn).toBe('LM358')
    expect(ready.qty).toBe(10)
    expect(ready.mpnCandidates).toEqual(['TI'])
  })
})