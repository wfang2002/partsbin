/**
 * NIIMBOT D11_H print jobs over the measured v4 protocol.
 * The link only moves bytes. Framing, the print sequence, and the bitmap
 * rows live here so they can be tested without a printer.
 *
 * Sequence and opcodes follow the hardware-checked D11_H flow: model id 528,
 * 300 dpi, 30 mm pages (354 rows). A 12 mm roll is 142 px wide. A 15 mm roll
 * uses the full 144 px head.
 */

export const D11H = {
  modelId: 528,
  density: 3,
  labelType: 1,
  speed: 1,
} as const

export type TapeId = '12x30' | '15x30'

export interface TapeSize {
  id: TapeId
  label: string
  /** Printable columns. The D11_H head is 144 px. */
  width: number
  /** Rows along the tape. 30 mm is 354 rows. */
  height: number
}

export const TAPES: Record<TapeId, TapeSize> = {
  '12x30': { id: '12x30', label: '12 × 30 mm', width: 142, height: 354 },
  '15x30': { id: '15x30', label: '15 × 30 mm', width: 144, height: 354 },
}

export function tapeStride(tape: TapeSize): number {
  return Math.ceil(tape.width / 8)
}

const TAPE_KEY = 'partsbin.niimbotTape'

export function loadTape(): TapeId {
  try {
    return localStorage.getItem(TAPE_KEY) === '15x30' ? '15x30' : '12x30'
  } catch {
    return '12x30'
  }
}

export function saveTape(id: TapeId): void {
  try {
    localStorage.setItem(TAPE_KEY, id)
  } catch {
    // The choice still applies to this print.
  }
}

export interface NiimbotLink {
  write(bytes: Uint8Array): Promise<void>
  /** The next notification, or null when nothing arrives in time. */
  read(timeoutMs: number): Promise<Uint8Array | null>
}

interface Frame {
  cmd: number
  data: Uint8Array
}

export function pack(cmd: number, data: ArrayLike<number> = []): Uint8Array {
  const pkt = new Uint8Array(7 + data.length)
  pkt[0] = 0x55
  pkt[1] = 0x55
  pkt[2] = cmd
  pkt[3] = data.length
  let crc = cmd ^ data.length
  for (let i = 0; i < data.length; i++) {
    pkt[4 + i] = data[i]
    crc ^= data[i]
  }
  pkt[4 + data.length] = crc & 0xff
  pkt[5 + data.length] = 0xaa
  pkt[6 + data.length] = 0xaa
  return pkt
}

/** Pull complete frames out of a byte stream. `rest` is the unfinished tail. */
export function takeFrames(buf: Uint8Array): { frames: Frame[]; rest: Uint8Array } {
  const frames: Frame[] = []
  let i = 0
  while (i + 7 <= buf.length) {
    if (buf[i] !== 0x55 || buf[i + 1] !== 0x55) {
      i += 1
      continue
    }
    const len = buf[i + 3]
    const total = 7 + len
    if (i + total > buf.length) break
    if (buf[i + 5 + len] !== 0xaa || buf[i + 6 + len] !== 0xaa) {
      i += 1
      continue
    }
    frames.push({ cmd: buf[i + 2], data: buf.slice(i + 4, i + 4 + len) })
    i += total
  }
  return { frames, rest: buf.slice(i) }
}

function popcount(byte: number): number {
  let n = 0
  let v = byte
  while (v) {
    n += v & 1
    v >>>= 1
  }
  return n
}

function sameRow(buf: Uint8Array, a: number, b: number, stride: number): boolean {
  for (let i = 0; i < stride; i++) if (buf[a + i] !== buf[b + i]) return false
  return true
}

function rowBlank(buf: Uint8Array, off: number, stride: number): boolean {
  for (let i = 0; i < stride; i++) if (buf[off + i]) return false
  return true
}

/** Run-length rows: 0x84 for blank, 0x85 for ink, identical rows grouped up to 200. */
export function encodeRows(bitmap: Uint8Array, height: number, stride: number): Frame[] {
  const frames: Frame[] = []
  let row = 0
  while (row < height) {
    const off = row * stride
    const blank = rowBlank(bitmap, off, stride)
    let run = 1
    while (run < 200 && row + run < height && sameRow(bitmap, off, (row + run) * stride, stride)) {
      run += 1
    }
    if (blank) {
      frames.push({ cmd: 0x84, data: Uint8Array.of((row >> 8) & 0xff, row & 0xff, run) })
    } else {
      let total = 0
      for (let i = 0; i < stride; i++) total += popcount(bitmap[off + i])
      const data = new Uint8Array(6 + stride)
      data[0] = (row >> 8) & 0xff
      data[1] = row & 0xff
      data[2] = 0
      data[3] = total & 0xff
      data[4] = (total >> 8) & 0xff
      data[5] = run
      data.set(bitmap.subarray(off, off + stride), 6)
      frames.push({ cmd: 0x85, data })
    }
    row += run
  }
  return frames
}

const CONNECT = Uint8Array.of(0x03, 0x55, 0x55, 0xc1, 0x01, 0x01, 0xc1, 0xaa, 0xaa)

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

class Reader {
  private pending = new Uint8Array()
  private queue: Frame[] = []
  private lastPage: number | null = null
  private link: NiimbotLink

  constructor(link: NiimbotLink) {
    this.link = link
  }

  async write(bytes: Uint8Array): Promise<void> {
    await this.link.write(bytes)
  }

  private absorb(chunk: Uint8Array) {
    const parsed = takeFrames(concat(this.pending, chunk))
    this.pending = new Uint8Array(parsed.rest)
    for (const frame of parsed.frames) {
      if (frame.cmd === 0xb3 && frame.data.length >= 2) {
        this.lastPage = (frame.data[0] << 8) | frame.data[1]
      }
      this.queue.push(frame)
    }
  }

  /** The next frame whose command is `cmd`, skipping chatter such as row counters. */
  async waitFor(cmd: number, timeoutMs: number): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const idx = this.queue.findIndex((frame) => frame.cmd === cmd)
      if (idx >= 0) {
        const [frame] = this.queue.splice(idx, 1)
        return frame
      }
      const left = deadline - Date.now()
      if (left <= 0) return null
      const chunk = await this.link.read(Math.min(left, 250))
      if (chunk) this.absorb(chunk)
    }
  }

  pageCount(): number | null {
    return this.lastPage
  }

  /** Forget replies that arrived before the caller started waiting for them. */
  drop(cmd: number) {
    this.queue = this.queue.filter((frame) => frame.cmd !== cmd)
    if (cmd === 0xb3) this.lastPage = null
  }
}

function modelIdOf(data: Uint8Array): number {
  if (data.length >= 2) return (data[0] << 8) | data[1]
  if (data.length === 1) return data[0] << 8
  return -1
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function printD11h(
  link: NiimbotLink,
  pages: Uint8Array[],
  options?: {
    tape?: TapeSize
    paceMs?: number
    settleMs?: number
    onProgress?: (message: string) => void
  },
): Promise<void> {
  if (pages.length === 0) throw new Error('Choose at least one sticker.')
  const tape = options?.tape ?? TAPES['12x30']
  const stride = tapeStride(tape)
  const expected = stride * tape.height
  for (const page of pages) {
    if (page.length !== expected) throw new Error('A sticker image was the wrong size for the D11_H.')
  }
  const paceMs = options?.paceMs ?? 10
  const settleMs = options?.settleMs ?? 200
  const progress = options?.onProgress ?? (() => {})
  const io = new Reader(link)

  progress('Connecting to the printer…')
  await io.write(CONNECT)
  if (settleMs) await sleep(settleMs)
  await io.write(pack(0x40, [0x08]))
  const identified = await io.waitFor(0x48, 1500)
  if (!identified) throw new Error('The printer did not respond. Move it closer and try again.')
  if (modelIdOf(identified.data) !== D11H.modelId) {
    throw new Error('That printer is not a NIIMBOT D11_H.')
  }

  const count = pages.length
  progress('Starting the print…')
  await io.write(pack(0x21, [D11H.density]))
  if (!(await io.waitFor(0x31, 1500))) throw new Error('The printer did not accept the print settings.')
  await io.write(pack(0x23, [D11H.labelType]))
  if (!(await io.waitFor(0x33, 1500))) throw new Error('The printer did not accept the label type.')
  await io.write(
    pack(0x01, [(count >> 8) & 0xff, count & 0xff, 0, 0, 0, 0, 0, D11H.speed, 0]),
  )
  if (!(await io.waitFor(0x02, 2000))) throw new Error('The printer did not start.')

  for (let i = 0; i < pages.length; i++) {
    progress(`Sending label ${i + 1} of ${count}…`)
    await io.write(pack(0xa3, [0x01]))
    await sleep(30)
    const height = tape.height
    const width = tape.width
    await io.write(
      pack(0x13, [
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        0x00,
        0x01,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
    )
    if (!(await io.waitFor(0x14, 2000))) throw new Error('The printer did not accept the label size.')
    for (const row of encodeRows(pages[i], tape.height, stride)) {
      await io.write(pack(row.cmd, row.data))
      if (paceMs) await sleep(paceMs)
    }
    await io.write(pack(0xe3, [0x01]))
    if (!(await io.waitFor(0xe4, 10000))) {
      await io.write(pack(0xf3, [0x01]))
      await io.waitFor(0xf4, 2500)
      throw new Error('The printer did not finish the label. Check that the tape is loaded.')
    }
  }

  progress('Waiting for the labels to finish…')
  io.drop(0xb3)
  const deadline = Date.now() + 25000
  let printed = false
  while (Date.now() < deadline) {
    await io.write(pack(0xa3, [0x01]))
    await io.waitFor(0xb3, 900)
    if ((io.pageCount() ?? 0) >= count) {
      printed = true
      break
    }
    await sleep(150)
  }
  await io.write(pack(0xf3, [0x01]))
  await io.waitFor(0xf4, 2500)
  if (!printed) {
    throw new Error('The printer did not finish the labels. Check the tape and try again.')
  }
}
