import { platformKind } from '../platform/env'
import { parseLabel } from './labelParsers'
import { nativeScanner } from './nativeScanner'
import type { Barcode, LabelImage, ParsedLabel, Scanner } from './types'
import { webScanner } from './webScanner'

export const scanner: Scanner = platformKind === 'ios' ? nativeScanner : webScanner

export interface LabelReading {
  barcodes: Barcode[]
  ocrText: string
  label: ParsedLabel
  /** Problems reading barcodes or text, for display. */
  warnings: string[]
}

/** Read barcodes and printed text from one label photo and combine them. */
export async function readLabel(image: LabelImage): Promise<LabelReading> {
  const warnings: string[] = []
  const [barcodes, ocrText] = await Promise.all([
    scanner.readBarcodes(image).catch((e) => {
      warnings.push(`Barcodes could not be read: ${message(e)}`)
      return [] as Barcode[]
    }),
    scanner.recognizeText(image).catch((e) => {
      warnings.push(`Text could not be read: ${message(e)}`)
      return ''
    }),
  ])
  return { barcodes, ocrText, label: parseLabel(barcodes, ocrText), warnings }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
