import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { TextRecognition } from '@capacitor-mlkit/text-recognition'
import { Camera } from '@capacitor/camera'
import type { Barcode, LabelImage, Scanner } from './types'

/*
 * iPhone scanner: the system camera for photos, and Google ML Kit running
 * on-device for barcodes and text.
 */

function isCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel/i.test(message)
}

async function ensureCameraPermission(): Promise<void> {
  const { camera } = await BarcodeScanner.requestPermissions()
  if (camera !== 'granted' && camera !== 'limited') {
    throw new Error(
      'PartsBin needs camera access. Allow it in Settings > PartsBin > Camera.',
    )
  }
}

export const nativeScanner: Scanner = {
  async capturePhoto(): Promise<LabelImage | null> {
    try {
      const photo = await Camera.takePhoto({
        quality: 90,
        correctOrientation: true,
        saveToGallery: false,
      })
      if (!photo.webPath) return null
      const blob = await (await fetch(photo.webPath)).blob()
      return { blob, nativePath: photo.uri }
    } catch (e) {
      if (isCancel(e)) return null
      throw e
    }
  },

  async readBarcodes(image): Promise<Barcode[]> {
    if (!image.nativePath) return []
    const { barcodes } = await BarcodeScanner.readBarcodesFromImage({
      path: image.nativePath,
    })
    return barcodes
      .map((b) => ({ format: String(b.format), text: b.rawValue ?? b.displayValue }))
      .filter((b) => b.text)
  },

  async recognizeText(image): Promise<string> {
    if (!image.nativePath) return ''
    const { text } = await TextRecognition.processImage({ path: image.nativePath })
    return text
  },

  async scanLive(): Promise<Barcode | null> {
    await ensureCameraPermission()
    try {
      const { barcodes } = await BarcodeScanner.scan()
      const first = barcodes[0]
      if (!first) return null
      return {
        format: String(first.format),
        text: first.rawValue ?? first.displayValue,
      }
    } catch (e) {
      if (isCancel(e)) return null
      throw e
    }
  },
}
