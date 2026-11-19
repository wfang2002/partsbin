import {
  formatQty,
  pathLabel,
  type Inventory,
} from '../domain/inventory'
import type { Part } from '../domain/types'
import type { AiClient } from './client'

export interface AskMatch {
  partId: string
  why: string
}

export interface AskResult {
  answer: string
  matches: AskMatch[]
  /** True when the inventory was too large to send in full. */
  truncated: boolean
}

/** Upper bound on parts sent with a question, to keep requests affordable. */
export const ASK_PART_LIMIT = 1500

function catalogLine(inv: Inventory, part: Part, n: number): string {
  const specs = Object.entries(part.specs)
    .slice(0, 12)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  const where = (inv.stockByPart.get(part.id) ?? [])
    .map((s) => {
      const qty = formatQty(s)
      return `${pathLabel(inv, s.locationId)}${qty ? ` (${qty})` : ''}`
    })
    .join(' / ')
  return [
    `#${n}`,
    part.mpn ?? '',
    part.manufacturer ?? '',
    part.description ?? '',
    specs,
    part.tags.join(','),
    where || 'no stock recorded',
  ]
    .map((field) => field.replace(/[|\n]/g, ' ').slice(0, 300))
    .join(' | ')
}

export function buildAskPrompt(
  inv: Inventory,
  parts: Part[],
  question: string,
): string {
  return `You help find electronic parts in a home inventory.
Each inventory line is: #number | part number | manufacturer | description | specs | tags | where it is stored (quantity).

Inventory:
${parts.map((p, i) => catalogLine(inv, p, i + 1)).join('\n')}

Question: ${question}

Reply with a JSON object:
{"answer": "one or two sentences answering the question",
 "matches": [{"n": <inventory line number>, "why": "short reason this part fits"}]}
List the best matches first, at most 10. Use only parts from the inventory above.
If nothing fits, say so in "answer" and return an empty "matches" array.`
}

/**
 * Answer a question such as "do I have a regulator for 5 V to 3.3 V at 1 A?"
 * from the inventory. `candidates` are the parts to consider, best first.
 */
export async function askInventory(
  ai: AiClient,
  inv: Inventory,
  candidates: Part[],
  question: string,
): Promise<AskResult> {
  const parts = candidates.slice(0, ASK_PART_LIMIT)
  const raw = (await ai.completeJson({
    prompt: buildAskPrompt(inv, parts, question),
  })) as { answer?: unknown; matches?: unknown }
  const matches: AskMatch[] = []
  if (Array.isArray(raw.matches)) {
    for (const item of raw.matches as { n?: unknown; why?: unknown }[]) {
      const part = typeof item?.n === 'number' ? parts[item.n - 1] : undefined
      // Ignore line numbers the model made up.
      if (!part || matches.some((m) => m.partId === part.id)) continue
      matches.push({
        partId: part.id,
        why: typeof item.why === 'string' ? item.why : '',
      })
    }
  }
  return {
    answer: typeof raw.answer === 'string' ? raw.answer : '',
    matches,
    truncated: candidates.length > parts.length,
  }
}
