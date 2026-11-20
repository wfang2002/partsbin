import { registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import type { NiimbotLink } from '../print/niimbot'
import { platformKind } from './env'

export interface PrinterLink extends NiimbotLink {
  close(): Promise<void>
}

const SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
const CHARACTERISTIC = 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'

export interface NiimbotDevice {
  id: string
  name: string
}

interface NativeNiimbot {
  scan(): Promise<{ devices: NiimbotDevice[] }>
  connect(options: { id: string }): Promise<void>
  write(options: { bytes: number[] }): Promise<void>
  read(options: { timeoutMs: number }): Promise<{ bytes: number[] | null }>
  disconnect(): Promise<void>
}

const iosNiimbot = registerPlugin<NativeNiimbot>('Niimbot')

/** The phone app, the desktop app, and a Chrome tab can reach a D11_H. */
export function labelPrinterSupported(): boolean {
  if (platformKind === 'ios' || platformKind === 'desktop') return true
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

async function scanNative(): Promise<NiimbotDevice[]> {
  if (platformKind === 'ios') {
    const result = await iosNiimbot.scan()
    return result.devices
  }
  return invoke<NiimbotDevice[]>('niimbot_scan')
}

async function connectNative(id: string): Promise<void> {
  if (platformKind === 'ios') await iosNiimbot.connect({ id })
  else await invoke('niimbot_connect', { id })
}

async function writeNative(bytes: Uint8Array): Promise<void> {
  const payload = { bytes: Array.from(bytes) }
  if (platformKind === 'ios') await iosNiimbot.write(payload)
  else await invoke('niimbot_write', payload)
}

async function readNative(timeoutMs: number): Promise<Uint8Array | null> {
  if (platformKind === 'ios') {
    const result = await iosNiimbot.read({ timeoutMs })
    return result.bytes ? Uint8Array.from(result.bytes) : null
  }
  const bytes = await invoke<number[] | null>('niimbot_read', { timeoutMs })
  return bytes ? Uint8Array.from(bytes) : null
}

async function closeNative(): Promise<void> {
  try {
    if (platformKind === 'ios') await iosNiimbot.disconnect()
    else await invoke('niimbot_disconnect')
  } catch {
    // The link may already be gone.
  }
}

/** Look for a nearby printer whose name starts with D11. */
export function scanLabelPrinters(): Promise<NiimbotDevice[]> {
  return scanNative()
}

/** Connect to a printer found by {@link scanLabelPrinters}. */
export async function connectLabelPrinter(id: string): Promise<PrinterLink> {
  await connectNative(id)
  return { write: writeNative, read: readNative, close: closeNative }
}

interface BleCharacteristic {
  properties: { writeWithoutResponse?: boolean; write?: boolean }
  startNotifications(): Promise<unknown>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  writeValueWithResponse(value: BufferSource): Promise<void>
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
}

interface BleDevice {
  name?: string
  gatt?: {
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<BleCharacteristic>
      }>
    }>
    disconnect(): void
  }
}

/**
 * Chrome's device chooser. Must be started from the click that asked to print,
 * before any other await, or the browser will reject it.
 */
export function requestWebLabelPrinter(): Promise<PrinterLink> {
  const bluetooth = (navigator as Navigator & {
    bluetooth?: { requestDevice(options: unknown): Promise<BleDevice> }
  }).bluetooth
  if (!bluetooth) throw new Error('This browser cannot talk to a Bluetooth printer.')
  const pending = bluetooth.requestDevice({
    filters: [{ namePrefix: 'D11' }],
    optionalServices: [SERVICE],
  })
  return pending.then(openWebPrinter)
}

async function openWebPrinter(device: BleDevice): Promise<PrinterLink> {
  if (!device.gatt) throw new Error('Could not connect to the printer.')
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService(SERVICE)
  const characteristic = await service.getCharacteristic(CHARACTERISTIC)
  const queue: Uint8Array[] = []
  let waiter: ((bytes: Uint8Array | null) => void) | null = null
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    const view = (event.target as unknown as { value?: DataView } | null)?.value
    if (!view) return
    const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
    if (waiter) {
      const resolve = waiter
      waiter = null
      resolve(bytes)
    } else {
      queue.push(bytes)
    }
  })
  await characteristic.startNotifications()
  const write = (bytes: Uint8Array) => {
    const payload = bytes as BufferSource
    return characteristic.properties.writeWithoutResponse
      ? characteristic.writeValueWithoutResponse(payload)
      : characteristic.writeValueWithResponse(payload)
  }
  return {
    write,
    read: (timeoutMs) =>
      new Promise((resolve) => {
        const next = queue.shift()
        if (next) {
          resolve(next)
          return
        }
        const timer = window.setTimeout(() => {
          waiter = null
          resolve(null)
        }, timeoutMs)
        waiter = (bytes) => {
          window.clearTimeout(timer)
          resolve(bytes)
        }
      }),
    close: async () => {
      try {
        device.gatt?.disconnect()
      } catch {
        // Already disconnected.
      }
    },
  }
}
