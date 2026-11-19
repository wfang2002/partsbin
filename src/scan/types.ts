export interface Barcode {
  /** e.g. "DataMatrix", "QRCode", "Code128". Informational only. */
  format: string
  text: string
}

/** A photo of a label, as taken or chosen by the user. */
export interface LabelImage {
  blob: Blob
  /** File path of the photo on the phone, for the native recognizers. */
  nativePath?: string
}

/**
 * Camera, barcode and text recognition. There are two implementations:
 * native plugins on the iPhone, and WebAssembly ones for desktop.
 */
export interface Scanner {
  /** Take or choose a photo of a label. Null if the user cancels. */
  capturePhoto(): Promise<LabelImage | null>
  readBarcodes(image: LabelImage): Promise<Barcode[]>
  recognizeText(image: LabelImage): Promise<string>
  /** Point the camera at a barcode; resolves with the first one seen. */
  scanLive(): Promise<Barcode | null>
}

export type LabelSource =
  | 'digikey'
  | 'mouser'
  | 'lcsc'
  | 'barcode'
  | 'ocr'
  | 'ai'
  | 'none'

/** What could be read from one label. */
export interface ParsedLabel {
  source: LabelSource
  mpn?: string
  manufacturer?: string
  description?: string
  category?: string
  qty?: number
  /** The distributor's own order code, e.g. an LCSC "C" number. */
  distributorPn?: string
  /** Value, package, tolerance and similar, when they could be read. */
  specs: Record<string, string>
  /** Other strings on the label that look like part numbers. */
  mpnCandidates: string[]
  /** "high" when the part number came from a barcode or a labelled field. */
  confidence: 'high' | 'low'
}

export function emptyLabel(source: LabelSource = 'none'): ParsedLabel {
  return { source, specs: {}, mpnCandidates: [], confidence: 'low' }
}
