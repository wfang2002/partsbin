/**
 * Hybrid logical clock. Timestamps are strings that sort in causal order:
 *   <15-digit milliseconds>-<4-hex counter>-<deviceId>
 * The device ID breaks ties, so two devices never produce equal timestamps.
 */
export class Hlc {
  private ms = 0
  private counter = 0
  private readonly deviceId: string
  private readonly now: () => number

  constructor(deviceId: string, last?: string, now: () => number = Date.now) {
    if (!/^[a-z0-9]+$/.test(deviceId)) {
      throw new Error(`Invalid device ID: ${deviceId}`)
    }
    this.deviceId = deviceId
    this.now = now
    if (last) this.observe(last)
  }

  /** Timestamp for a new local change. */
  tick(): string {
    const wall = this.now()
    if (wall > this.ms) {
      this.ms = wall
      this.counter = 0
    } else {
      this.counter += 1
      // Keep the counter at four hex digits so string order stays correct.
      if (this.counter > 0xffff) {
        this.ms += 1
        this.counter = 0
      }
    }
    return formatHlc(this.ms, this.counter, this.deviceId)
  }

  /** Advance past a timestamp seen from another device (or a stored one). */
  observe(remote: string): void {
    const parsed = parseHlc(remote)
    if (
      parsed.ms > this.ms ||
      (parsed.ms === this.ms && parsed.counter > this.counter)
    ) {
      this.ms = parsed.ms
      this.counter = parsed.counter
    }
  }
}

export function formatHlc(ms: number, counter: number, deviceId: string) {
  return `${String(ms).padStart(15, '0')}-${counter.toString(16).padStart(4, '0')}-${deviceId}`
}

export function parseHlc(hlc: string) {
  const match = /^(\d{15})-([0-9a-f]{4})-([a-z0-9]+)$/.exec(hlc)
  if (!match) throw new Error(`Malformed timestamp: ${hlc}`)
  return {
    ms: Number(match[1]),
    counter: parseInt(match[2], 16),
    deviceId: match[3],
  }
}
