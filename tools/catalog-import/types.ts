export type CanonicalField =
  | 'modelCode'
  | 'name'
  | 'category'
  | 'price'
  | 'fulfillmentDays'
  | 'stock'
  | 'barcode'
  | 'sku'
  | 'description'
  | 'shortDescription'
  | 'story'
  | 'careInstructions'
  | 'color1'
  | 'color2'
  | 'material'
  | 'compareAtPrice'
  | 'weight'
  | 'dimensionWidth'
  | 'dimensionLength'
  | 'dimensionHeight'

export type CanonicalRow = {
  sourceRow: number
  modelCode?: string
  name?: string
  sourceCategory?: string
  canonicalCategoryPath?: string[]
  price?: number
  compareAtPrice?: number
  fulfillmentDays?: number
  stockQuantity?: number
  barcode?: string
  sku?: string
  description?: string
  shortDescription?: string
  story?: string
  careInstructions?: string
  color1?: string
  color2?: string
  material?: string
  weight?: number
  dimensionWidth?: number
  dimensionLength?: number
  dimensionHeight?: number
  imageUrls: string[]
}

export type HeaderCandidate = {
  sheetName: string
  headerRow: number
  score: number
  mappedFields: Partial<Record<CanonicalField, number>>
  ambiguousFields: CanonicalField[]
  imageColumns: number[]
}

export type MappingReport = {
  sourcePath: string
  candidates: HeaderCandidate[]
  selected?: HeaderCandidate
  blockingErrors: string[]
}

export type NormalizedWorkbook = {
  schemaVersion: 1
  normalizedAt: string
  sourcePath: string
  sourceHash: string
  mapping: MappingReport
  rows: CanonicalRow[]
}

export type ImportProfile = {
  name: string
  headerOverrides?: Partial<Record<CanonicalField, string>>
  imageHeaderAliases?: string[]
  imageHeaderRegex?: string
  stockTextValues?: Record<string, number>
  categoryRules?: Array<{ contains: string; path: string[] }>
}

export type CachedImage = {
  sourceUrl: string
  cachePath: string
  sha256: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sizeBytes: number
}

export type ManifestItem = {
  sourceRow: number
  normalizedModelCode: string
  categoryPath: string[]
  action: 'create' | 'skip-existing'
  row: CanonicalRow
  images: CachedImage[]
}

export type ImportManifest = {
  schemaVersion: 1
  createdAt: string
  expiresAt: string
  normalizedHash: string
  normalizedPath: string
  seller: { id: string; userId: string; slug: string; displayName: string }
  categories: Record<string, string>
  items: ManifestItem[]
  auditPath: string
}
