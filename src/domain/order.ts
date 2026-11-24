/** A–Z or Z–A. Names are compared with numeric ordering, so "Box 2" precedes "Box 10". */
export type SortDir = 'asc' | 'desc'

export function compareName(a: string, b: string, dir: SortDir): number {
  const n = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return dir === 'desc' ? -n : n
}

export function sortByName<T>(items: readonly T[], name: (item: T) => string, dir: SortDir): T[] {
  return [...items].sort((a, b) => compareName(name(a), name(b), dir))
}

export interface CategoryGroup<T> {
  key: string
  label: string
  items: T[]
}

/**
 * Groups items by category name. Categories stay A–Z, with items that have
 * no category last. `compare` orders the items inside each category.
 */
export function groupByCategory<T>(
  items: readonly T[],
  category: (item: T) => string | undefined,
  compare: (a: T, b: T) => number,
): CategoryGroup<T>[] {
  const buckets = new Map<string, { label: string; items: T[] }>()
  for (const item of items) {
    const raw = category(item)?.trim() ?? ''
    const key = raw.toLocaleLowerCase()
    const bucket = buckets.get(key)
    if (bucket) bucket.items.push(item)
    else buckets.set(key, { label: raw, items: [item] })
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === '') return 1
      if (b === '') return -1
      return compareName(buckets.get(a)!.label, buckets.get(b)!.label, 'asc')
    })
    .map(([key, bucket]) => ({
      key: key || 'none',
      label: bucket.label || 'No category',
      items: [...bucket.items].sort(compare),
    }))
}
