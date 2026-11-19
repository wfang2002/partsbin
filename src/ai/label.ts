import { emptyLabel, type ParsedLabel } from '../scan/types'
import type { AiClient } from './client'

const PROMPT = `You are reading the label on a bag or box of electronic components.
Reply with a JSON object with exactly these keys:
- "mpn": the manufacturer part number, or null. Not a distributor order code, lot, or date code.
- "manufacturer": string or null
- "description": a short description such as "RES 10K OHM 1% 0603" or "IC MCU 8BIT 32KB TQFP-32", or null
- "category": e.g. "Resistor", "Capacitor", "Microcontroller", "Connector", or null
- "quantity": the number of pieces stated on the label as a number, or null
- "specs": an object of short name to value for what the label states, e.g. {"Resistance": "10k", "Tolerance": "1%", "Package": "0603"}
- "other_part_numbers": array of other strings on the label that could be part numbers

Only report what is legible on the label. Use null when something is not there; do not guess.`

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** Turn a model answer into the same structure the on-device parsers produce. */
export function labelFromAiAnswer(answer: unknown): ParsedLabel {
  const label = emptyLabel('ai')
  if (!answer || typeof answer !== 'object') return label
  const a = answer as Record<string, unknown>
  label.mpn = str(a.mpn)
  label.manufacturer = str(a.manufacturer)
  label.description = str(a.description)
  label.category = str(a.category)
  const qty = typeof a.quantity === 'string' ? Number(a.quantity) : a.quantity
  if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) label.qty = qty
  if (a.specs && typeof a.specs === 'object' && !Array.isArray(a.specs)) {
    for (const [name, value] of Object.entries(a.specs)) {
      const text = typeof value === 'number' ? String(value) : str(value)
      if (text) label.specs[name] = text
    }
  }
  if (Array.isArray(a.other_part_numbers)) {
    label.mpnCandidates = a.other_part_numbers
      .map(str)
      .filter((c): c is string => Boolean(c) && c !== label.mpn)
      .slice(0, 6)
  }
  // The user still confirms every field; "high" only means "worth a lookup".
  label.confidence = label.mpn ? 'high' : 'low'
  return label
}

/** Ask the vision model to read a label photo. */
export async function readLabelWithAi(
  ai: AiClient,
  imageJpeg: Uint8Array,
  ocrText: string,
): Promise<ParsedLabel> {
  const prompt = ocrText.trim()
    ? `${PROMPT}\n\nText already read from the label by OCR (may contain errors):\n${ocrText.slice(0, 2000)}`
    : PROMPT
  return labelFromAiAnswer(await ai.completeJson({ prompt, imageJpeg }))
}
