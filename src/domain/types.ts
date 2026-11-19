/** SHA-256 (hex) of a JPEG held in the blob store. */
export type BlobRef = string

export type LocationKind = 'room' | 'rack' | 'shelf' | 'box' | 'compartment'

export const LOCATION_KINDS: LocationKind[] = [
  'room',
  'rack',
  'shelf',
  'box',
  'compartment',
]

export interface Location {
  id: string
  /** null for a top-level location. */
  parentId: string | null
  name: string
  kind: LocationKind
  photoBlob?: BlobRef
  note?: string
}

export type PartSource = 'digikey' | 'mouser' | 'ai' | 'manual'

export interface Part {
  id: string
  mpn?: string
  manufacturer?: string
  category?: string
  description?: string
  specs: Record<string, string>
  datasheetUrl?: string
  imageBlob?: BlobRef
  tags: string[]
  ocrText?: string
  source?: PartSource
}

export type QtyApprox = 'few' | 'some' | 'many'

/** One bag (or reel, tube, loose pile) of a part sitting in one location. */
export interface Stock {
  id: string
  partId: string
  locationId: string
  qty?: number
  qtyApprox?: QtyApprox
  labelPhotoBlob?: BlobRef
  /** Milliseconds since the epoch. */
  lastSeenAt: number
}

export interface BomLine {
  partId?: string
  /** Part number, or "value footprint" when the BOM has no part number. */
  mpn: string
  qty: number
  /** Reference designators, e.g. "R1, R2". */
  refs?: string
}

export interface Project {
  id: string
  name: string
  note?: string
  locationIds: string[]
  bom: BomLine[]
}

export interface TableTypes {
  locations: Location
  parts: Part
  stock: Stock
  projects: Project
}

export type TableName = keyof TableTypes

export const TABLE_NAMES: TableName[] = [
  'locations',
  'parts',
  'stock',
  'projects',
]

/** Fields that hold a BlobRef, per table. */
export const BLOB_FIELDS: Record<TableName, string[]> = {
  locations: ['photoBlob'],
  parts: ['imageBlob'],
  stock: ['labelPhotoBlob'],
  projects: [],
}
