import MiniSearch, { type Query } from 'minisearch'
import { pathLabel, type Inventory } from '../domain/inventory'
import { canonicalValue, joinSplitValues } from './values'

interface SearchDoc {
  id: string
  mpn: string
  manufacturer: string
  category: string
  description: string
  specs: string
  tags: string
  ocr: string
  where: string
}

export interface SearchHit {
  kind: 'part' | 'location'
  id: string
  score: number
}

const FIELDS = [
  'mpn',
  'manufacturer',
  'category',
  'description',
  'specs',
  'tags',
  'ocr',
  'where',
] as const

const SPLIT_RE = /[\s,;:()[\]{}|"'\\/=<>]+/

/** Split text into raw tokens, keeping things like "0.1uF" and "SOT-23" whole. */
function rawTokens(text: string): string[] {
  return joinSplitValues(text)
    .split(SPLIT_RE)
    .map((t) => t.replace(/^[.\-+#*]+|[.\-+*]+$/g, ''))
    .filter(Boolean)
}

/** Every searchable form of one token. */
function expandToken(token: string, field: string): string[] {
  const lower = token.toLowerCase()
  const out = new Set<string>([lower])
  const value = canonicalValue(token)
  if (value) out.add(value)
  if (/[-_.]/.test(lower)) {
    // "SOT-23" is also findable as "sot23", "sot" and "23".
    out.add(lower.replace(/[-_.]/g, ''))
    for (const piece of lower.split(/[-_]/)) {
      if (!piece) continue
      out.add(piece)
      const pieceValue = canonicalValue(piece)
      if (pieceValue) out.add(pieceValue)
    }
  }
  if (field === 'mpn') {
    // Index every tail of a part number so "328p" finds "ATMEGA328P".
    const compact = lower.replace(/[^a-z0-9]/g, '')
    for (let i = 1; i <= compact.length - 3; i++) out.add(compact.slice(i))
  }
  return [...out]
}

function tokenizeField(text: string, field = ''): string[] {
  return rawTokens(text).flatMap((t) => expandToken(t, field))
}

export function buildIndex(inv: Inventory): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>({
    fields: [...FIELDS],
    tokenize: tokenizeField,
    // Tokens are already normalized by tokenizeField.
    processTerm: (term) => term,
  })
  const docs: SearchDoc[] = []
  for (const part of inv.parts) {
    const where = (inv.stockByPart.get(part.id) ?? [])
      .map((s) => pathLabel(inv, s.locationId))
      .join(' | ')
    docs.push({
      id: `part:${part.id}`,
      mpn: part.mpn ?? '',
      manufacturer: part.manufacturer ?? '',
      category: part.category ?? '',
      description: part.description ?? '',
      specs: Object.entries(part.specs)
        .map(([k, v]) => `${k} ${v}`)
        .join(' | '),
      tags: part.tags.join(' '),
      ocr: part.ocrText ?? '',
      where,
    })
  }
  for (const location of inv.locations) {
    docs.push({
      id: `location:${location.id}`,
      mpn: '',
      manufacturer: '',
      category: '',
      description: location.name,
      specs: '',
      tags: location.kind,
      ocr: location.note ?? '',
      where: '',
    })
  }
  index.addAll(docs)
  return index
}

/** All words of the query must match; each may match literally or by value. */
export function search(index: MiniSearch<SearchDoc>, query: string): SearchHit[] {
  const words = rawTokens(query)
  if (words.length === 0) return []
  const queries: Query[] = words.map((word) => {
    const lower = word.toLowerCase()
    const alternatives: Query[] = [
      { queries: [lower], prefix: true, fuzzy: lower.length > 4 ? 0.2 : false },
    ]
    const compact = lower.replace(/[-_.]/g, '')
    if (compact !== lower && compact) {
      alternatives.push({ queries: [compact], prefix: true })
    }
    const value = canonicalValue(word)
    if (value) alternatives.push({ queries: [value], prefix: false, fuzzy: false })
    return { combineWith: 'OR', queries: alternatives }
  })
  const results = index.search(
    { combineWith: 'AND', queries },
    {
      // The query tree above already holds final terms.
      tokenize: (text) => [text],
      processTerm: (term) => term,
      boost: {
        mpn: 4,
        description: 2,
        tags: 2,
        category: 1.5,
        manufacturer: 1.5,
        ocr: 0.5,
      },
    },
  )
  return results.map((r) => {
    const [kind, id] = String(r.id).split(':')
    return { kind: kind as SearchHit['kind'], id, score: r.score }
  })
}
