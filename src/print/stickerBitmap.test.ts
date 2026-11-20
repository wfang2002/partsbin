import { describe, expect, it } from 'vitest'
import { packLandscape } from './stickerBitmap'

function bit(bitmap: Uint8Array, stride: number, row: number, col: number): boolean {
  return (bitmap[row * stride + (col >> 3)] & (0x80 >> (col & 7))) !== 0
}

describe('landscape stickers', () => {
  it('runs the picture along the tape, with the top of the text across the head', () => {
    const feed = 4
    const head = 8
    const bitmap = packLandscape((x, y) => x === 0 && y === 0, feed, head)
    expect(bit(bitmap, 1, 0, head - 1)).toBe(true)
    expect(bit(bitmap, 1, 0, 0)).toBe(false)
    expect(bit(bitmap, 1, 1, head - 1)).toBe(false)

    const further = packLandscape((x, y) => x === 2 && y === 1, feed, head)
    expect(bit(further, 1, 2, head - 2)).toBe(true)
    expect(bit(further, 1, 0, head - 1)).toBe(false)
  })
})
