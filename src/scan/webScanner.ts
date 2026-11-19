import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { requestBarcode, requestPhoto } from './cameraRequest'
import type { Barcode, LabelImage, Scanner } from './types'

/*
 * Desktop scanner: barcodes with zxing (WebAssembly), text with Tesseract
 * (WebAssembly). Both are loaded on first use and run entirely on-device;
 * their files ship with the app (see scripts/copy-ocr-assets.mjs).
 */

type ZxingReader = typeof import('zxing-wasm/reader')
let zxing: Promise<ZxingReader> | null = null

function loadZxing(): Promise<ZxingReader> {
  zxing ??= import('zxing-wasm/reader').then((module) => {
    module.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
    })
    return module
  })
  return zxing
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface FoundBarcode extends Barcode {
  /** Where the barcode is in the image. */
  box: Box
}

async function findBarcodes(input: Blob | ImageData): Promise<FoundBarcode[]> {
  const { readBarcodes } = await loadZxing()
  const results = await readBarcodes(input, {
    tryHarder: true,
    maxNumberOfSymbols: 12,
  })
  return results
    .filter((r) => r.text)
    .map((r) => {
      const { topLeft, topRight, bottomLeft, bottomRight } = r.position
      const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x]
      const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y]
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return {
        format: String(r.format),
        text: r.text,
        box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
      }
    })
}

/** Decode every barcode in a photo or a camera frame. */
export async function decodeBarcodes(input: Blob | ImageData): Promise<Barcode[]> {
  return (await findBarcodes(input)).map(({ format, text }) => ({ format, text }))
}

// A label photo is searched for barcodes once, for decoding and for masking.
const foundIn = new WeakMap<Blob, Promise<FoundBarcode[]>>()

function barcodesIn(blob: Blob): Promise<FoundBarcode[]> {
  let found = foundIn.get(blob)
  if (!found) {
    found = findBarcodes(blob)
    foundIn.set(blob, found)
  }
  return found
}

/**
 * The area to blank out for one barcode. For bar codes the decoder reports
 * only the line it scanned, so the area is grown across the bars.
 */
export function maskArea(box: Box): Box {
  let { x, y, width, height } = box
  if (height < width * 0.24) {
    y -= (width * 0.24 - height) / 2
    height = width * 0.24
  } else if (width < height * 0.24) {
    x -= (height * 0.24 - width) / 2
    width = height * 0.24
  }
  const margin = Math.max(width, height) * 0.06 + 4
  return {
    x: x - margin,
    y: y - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  }
}

/** Paint over the barcodes, which text recognition would read as gibberish. */
async function withoutBarcodes(blob: Blob, found: FoundBarcode[]): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0)
    ctx.fillStyle = '#fff'
    for (const { box } of found) {
      const area = maskArea(box)
      ctx.fillRect(area.x, area.y, area.width, area.height)
    }
    const masked = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    return masked ?? blob
  } finally {
    bitmap.close()
  }
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>
let ocrWorker: Promise<OcrWorker> | null = null

function loadOcr(): Promise<OcrWorker> {
  ocrWorker ??= import('tesseract.js')
    .then(({ createWorker }) => {
      const base = new URL('ocr/', document.baseURI).href
      // 1 = the LSTM engine, which is the one the bundled data supports.
      return createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base.replace(/\/$/, ''),
        langPath: base.replace(/\/$/, ''),
        gzip: true,
        // Blob workers cannot load scripts from the app's custom URL schemes.
        workerBlobURL: false,
      })
    })
    .catch((e) => {
      ocrWorker = null
      throw e
    })
  return ocrWorker
}

export const webScanner: Scanner = {
  async capturePhoto(): Promise<LabelImage | null> {
    const blob = await requestPhoto()
    return blob ? { blob } : null
  },

  async readBarcodes(image) {
    return (await barcodesIn(image.blob)).map(({ format, text }) => ({ format, text }))
  },

  async recognizeText(image) {
    // If the barcode search fails, the text is still read from the full photo.
    const found = await barcodesIn(image.blob).catch(() => [])
    const target = found.length > 0 ? await withoutBarcodes(image.blob, found) : image.blob
    const worker = await loadOcr()
    const { data } = await worker.recognize(target)
    return data.text
  },

  scanLive() {
    return requestBarcode()
  },
}
