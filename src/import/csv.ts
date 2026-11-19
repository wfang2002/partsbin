/** Parse delimited text (comma, semicolon or tab) with quoted fields. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
    .map((r) => r.map((f) => f.trim()))
    .filter((r) => r.some((f) => f !== ''))
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n')
  let best = ','
  let bestCount = 0
  for (const candidate of [',', ';', '\t']) {
    const count = sample.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/** Lower-case a header and drop spaces and punctuation, keeping "#". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9#]/g, '')
}

/**
 * Find the header row (files often start with a preamble) and map the
 * wanted fields to column indexes. `aliases` lists normalized header names
 * per field, most specific first.
 */
export function findColumns<K extends string>(
  rows: string[][],
  aliases: Record<K, string[]>,
  required: K[][],
): { headerRow: number; columns: Partial<Record<K, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const headers = rows[r].map(normalizeHeader)
    const columns: Partial<Record<K, number>> = {}
    const taken = new Set<number>()
    for (const field of Object.keys(aliases) as K[]) {
      for (const alias of aliases[field]) {
        const index = headers.findIndex((h, i) => h === alias && !taken.has(i))
        if (index >= 0) {
          columns[field] = index
          taken.add(index)
          break
        }
      }
    }
    // A header row has at least one field from each required group.
    if (required.every((group) => group.some((f) => columns[f] !== undefined))) {
      return { headerRow: r, columns }
    }
  }
  return null
}

export function parseCount(text: string | undefined): number | undefined {
  if (!text) return undefined
  const n = Number(text.replace(/[,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
