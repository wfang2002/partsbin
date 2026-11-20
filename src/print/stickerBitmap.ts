import { TAPES, type TapeSize } from './niimbot'

/** Quiet zone around the code, in modules, as the QR standard asks. */
const QUIET = 4

export interface StickerArt {
  name: string
  inside: string
  /** Dark modules of the QR code, row by row, without the quiet zone. */
  modules: boolean[][]
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > width) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Turn a landscape picture into printer rows.
 * `feed` is the long side of the tape, `head` is the print head.
 * A pixel at (x, y) in the landscape picture — x along the tape, y across it —
 * is printed so the label reads left to right when its leading edge is on the left.
 */
export function packLandscape(
  isBlack: (x: number, y: number) => boolean,
  feed: number,
  head: number,
): Uint8Array {
  const stride = Math.ceil(head / 8)
  const bitmap = new Uint8Array(stride * feed)
  for (let x = 0; x < feed; x++) {
    for (let y = 0; y < head; y++) {
      if (!isBlack(x, y)) continue
      const col = head - 1 - y
      bitmap[x * stride + (col >> 3)] |= 0x80 >> (col & 7)
    }
  }
  return bitmap
}

/**
 * Draw one box sticker for the chosen D11_H tape, in landscape: the code on
 * the left and the name beside it, reading along the tape. Pixels are packed
 * MSB-first, 1 = black.
 */
export function renderStickerBitmap(sticker: StickerArt, tape: TapeSize = TAPES['12x30']): Uint8Array {
  const feed = tape.height
  const head = tape.width
  const canvas = document.createElement('canvas')
  canvas.width = feed
  canvas.height = head
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the sticker.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, feed, head)
  ctx.fillStyle = '#000'

  const count = sticker.modules.length + QUIET * 2
  const scale = Math.max(1, Math.floor((head - 8) / count))
  const size = count * scale
  const qrX = 4
  const qrY = Math.floor((head - size) / 2)
  sticker.modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) {
        ctx.fillRect(qrX + (c + QUIET) * scale, qrY + (r + QUIET) * scale, scale, scale)
      }
    }),
  )

  const textX = qrX + size + 8
  const textW = feed - textX - 6
  ctx.textBaseline = 'top'
  ctx.font = 'bold 36px system-ui, sans-serif'
  const nameLines = wrap(ctx, sticker.name, textW).slice(0, 2)
  ctx.font = '24px system-ui, sans-serif'
  const pathLines = wrap(ctx, sticker.inside, textW).slice(0, 2)
  const blockH = nameLines.length * 40 + (pathLines.length > 0 ? 6 + pathLines.length * 28 : 0)
  let y = Math.max(4, Math.floor((head - blockH) / 2))
  ctx.font = 'bold 36px system-ui, sans-serif'
  for (const line of nameLines) {
    ctx.fillText(line, textX, y)
    y += 40
  }
  y += 6
  ctx.font = '24px system-ui, sans-serif'
  for (const line of pathLines) {
    ctx.fillText(line, textX, y)
    y += 28
  }

  const pixels = ctx.getImageData(0, 0, feed, head).data
  return packLandscape(
    (x, y) => {
      const i = (y * feed + x) * 4
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
      return pixels[i + 3] > 32 && lum < 128
    },
    feed,
    head,
  )
}
