import { describe, expect, it } from 'vitest'
import {
  D11H,
  TAPES,
  encodeRows,
  pack,
  printD11h,
  takeFrames,
  tapeStride,
  type NiimbotLink,
} from './niimbot'

function frame(cmd: number, data: number[] = []): Uint8Array {
  return pack(cmd, data)
}

class FakePrinter implements NiimbotLink {
  writes: Uint8Array[] = []
  private inbox: Uint8Array[] = []
  private page = 0

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes)
    const { frames } = takeFrames(bytes[0] === 0x03 ? bytes.slice(1) : bytes)
    for (const item of frames) this.reply(item.cmd, item.data)
  }

  async read(): Promise<Uint8Array | null> {
    return this.inbox.shift() ?? null
  }

  private reply(cmd: number, data: Uint8Array) {
    if (cmd === 0xc1) this.inbox.push(frame(0xc2, [1]))
    else if (cmd === 0x40 && data[0] === 0x08) this.inbox.push(frame(0x48, [0x02, 0x10]))
    else if (cmd === 0x21) this.inbox.push(frame(0x31, [D11H.density]))
    else if (cmd === 0x23) this.inbox.push(frame(0x33, [1]))
    else if (cmd === 0x01) this.inbox.push(frame(0x02, [1]))
    else if (cmd === 0x13) this.inbox.push(frame(0x14, [1]))
    else if (cmd === 0xa3) {
      this.inbox.push(frame(0xb3, [(this.page >> 8) & 0xff, this.page & 0xff, 100, 100]))
    } else if (cmd === 0xe3) {
      this.page += 1
      this.inbox.push(frame(0xe4, [1]))
    } else if (cmd === 0xf3) this.inbox.push(frame(0xf4, [1]))
  }
}

describe('D11_H packets', () => {
  it('frames a command with the checksum the printer expects', () => {
    expect([...pack(0xc1, [0x01])]).toEqual([0x55, 0x55, 0xc1, 0x01, 0x01, 0xc1, 0xaa, 0xaa])
  })

  it('reassembles a frame that arrives in pieces', () => {
    const pkt = pack(0x31, [3])
    const first = takeFrames(pkt.slice(0, 4))
    expect(first.frames).toEqual([])
    const second = takeFrames(new Uint8Array([...first.rest, ...pkt.slice(4)]))
    expect(second.frames.map((f) => f.cmd)).toEqual([0x31])
    expect([...second.frames[0].data]).toEqual([3])
  })

  it('collapses blank rows and counts black pixels', () => {
    const stride = 1
    const bitmap = Uint8Array.of(0xff, 0xff, 0x00, 0x00)
    const rows = encodeRows(bitmap, 4, stride)
    expect(rows.map((row) => row.cmd)).toEqual([0x85, 0x84])
    expect([...rows[0].data]).toEqual([0, 0, 0, 8, 0, 2, 0xff])
    expect([...rows[1].data]).toEqual([0, 2, 2])
  })

  async function printedWidth(tape: (typeof TAPES)['12x30']): Promise<number> {
    const printer = new FakePrinter()
    const page = new Uint8Array(tapeStride(tape) * tape.height)
    await printD11h(printer, [page], { tape, paceMs: 0, settleMs: 0 })
    const size = printer.writes
      .flatMap((bytes) => takeFrames(bytes[0] === 0x03 ? bytes.slice(1) : bytes).frames)
      .find((item) => item.cmd === 0x13)
    if (!size) throw new Error('missing page size')
    return (size.data[2] << 8) | size.data[3]
  }

  it('prints one label and waits until the printer counts it', async () => {
    const printer = new FakePrinter()
    const tape = TAPES['12x30']
    const page = new Uint8Array(tapeStride(tape) * tape.height)
    const notes: string[] = []
    await printD11h(printer, [page], {
      tape,
      paceMs: 0,
      settleMs: 0,
      onProgress: (message) => notes.push(message),
    })
    const sent = printer.writes.flatMap((bytes) =>
      takeFrames(bytes[0] === 0x03 ? bytes.slice(1) : bytes).frames.map((f) => f.cmd),
    )
    expect(sent[0]).toBe(0xc1)
    expect(sent).toContain(0x40)
    expect(sent).toContain(0x21)
    expect(sent).toContain(0x01)
    expect(sent).toContain(0x13)
    expect(sent).toContain(0x84)
    expect(sent.at(-1)).toBe(0xf3)
    expect(notes.some((note) => note.includes('1 of 1'))).toBe(true)
  })

  it('sends the tape width the user picked', async () => {
    expect(await printedWidth(TAPES['12x30'])).toBe(142)
    expect(await printedWidth(TAPES['15x30'])).toBe(144)
  })
})
