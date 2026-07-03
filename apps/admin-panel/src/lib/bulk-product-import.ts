import { z } from 'zod'
import {
  normalizeManagedMediaUrl,
  resolveManagedMediaSourceUrl,
} from '@hanuja/api/lib/media-url'
import {
  looksLikeCategorySlug,
  normalizeCategorySlugValue,
  normalizeRootCategoryValue,
} from '@/lib/bulk-category-options'

export const MAX_BULK_IMPORT_ROWS = 500

function isAllowedImageUrl(raw: string): boolean {
  return Boolean(resolveManagedMediaSourceUrl(raw))
}
export const BULK_PRODUCT_IMAGE_COLUMN_COUNT = 8
const BULK_PRODUCT_IMAGE_KEYS = [
  'image1',
  'image2',
  'image3',
  'image4',
  'image5',
  'image6',
  'image7',
  'image8',
] as const

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional()

const barcodeSchema = z.string().regex(/^\d{13}$/, 'Barkod 13 haneli rakam olmali')

export const BULK_PRODUCT_COLUMN_CONFIG = [
  { key: 'productGroupCode', label: 'Urun Grup Kodu' },
  { key: 'name', label: 'Urun Adi*' },
  { key: 'categorySlug', label: 'Kategori*' },
  { key: 'price', label: 'Fiyat*' },
  { key: 'stockQuantity', label: 'Stok*' },
  { key: 'barcode', label: 'Barkod (13 hane)*' },
  { key: 'variantColor', label: 'Renk' },
  { key: 'variantSize', label: 'Beden' },
  { key: 'variantCustomOptionName', label: 'Ek Ozellik Adi' },
  { key: 'variantCustomOptionValue', label: 'Ek Ozellik Degeri' },
  { key: 'sku', label: 'SKU' },
  { key: 'shortDescription', label: 'Kisa Aciklama' },
  { key: 'description', label: 'Aciklama' },
  { key: 'story', label: 'Hikaye' },
  { key: 'careInstructions', label: 'Bakim Notu' },
  { key: 'compareAtPrice', label: 'Liste Fiyati (ustu cizili)' },
  { key: 'weight', label: 'Agirlik (kg)' },
  ...Array.from({ length: BULK_PRODUCT_IMAGE_COLUMN_COUNT }, (_, index) => ({
    key: `image${index + 1}` as const,
    label: `Gorsel ${index + 1}`,
  })),
] as const

export type BulkProductColumnKey = (typeof BULK_PRODUCT_COLUMN_CONFIG)[number]['key']
type BulkImportMappedColumnKey = BulkProductColumnKey | 'rootCategorySlug'

export const BULK_PRODUCT_HEADERS = BULK_PRODUCT_COLUMN_CONFIG.map((column) => column.key)
export const BULK_PRODUCT_TEMPLATE_HEADERS = BULK_PRODUCT_COLUMN_CONFIG.map((column) => column.label)

const TURKISH_TO_INTERNAL_HEADER_MAP = new Map<string, BulkImportMappedColumnKey>(
  BULK_PRODUCT_COLUMN_CONFIG.flatMap((column) => {
    const normalizedLabel = normalizeHeaderKey(column.label)
    const normalizedKey = normalizeHeaderKey(column.key)
    return [
      [normalizedLabel, column.key],
      [normalizedKey, column.key],
    ] as Array<[string, BulkImportMappedColumnKey]>
  }),
)

TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Eski Fiyat'), 'compareAtPrice')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ana Kategori*'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ana Kategori'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('rootCategorySlug'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori*'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori Slug*'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori Slug'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ürün Grup Kodu'), 'productGroupCode')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ürün Adı*'), 'name')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kısa Açıklama'), 'shortDescription')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Açıklama'), 'description')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Bakım Notu'), 'careInstructions')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Liste Fiyatı (üstü çizili)'), 'compareAtPrice')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ağırlık (kg)'), 'weight')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ek Özellik Adı'), 'variantCustomOptionName')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ek Özellik Değeri'), 'variantCustomOptionValue')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 1'), 'image1')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 2'), 'image2')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 3'), 'image3')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 4'), 'image4')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 5'), 'image5')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 6'), 'image6')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 7'), 'image7')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Görsel 8'), 'image8')

export const BULK_PRODUCT_TEMPLATE_SAMPLE_ROW: Record<BulkProductColumnKey, string | number> = {
  productGroupCode: 'SEHPA-001',
  name: 'Dogal Mese Yan Sehpa',
  categorySlug: 'Mobilya / Sehpa Modelleri',
  price: 3490,
  stockQuantity: 8,
  barcode: '8691234567890',
  variantColor: 'Ceviz',
  variantSize: '',
  variantCustomOptionName: 'Ayak',
  variantCustomOptionValue: 'Metal',
  sku: 'SEHPA-001',
  shortDescription: 'Masif mese govdeli, el isciligi detayli.',
  description: 'Salon ve yatak odasi icin tasarlanmis kompakt yan sehpa.',
  story: 'Istanbul atolyesinde sinirli adet uretilir.',
  careInstructions: 'Nemli bezle silin, direkt gunesten uzak tutun.',
  compareAtPrice: 3890,
  weight: 7.2,
  image1: 'https://cdn.hanuja.example/products/sehpa-1.jpg',
  image2: 'https://cdn.hanuja.example/products/sehpa-2.jpg',
  image3: '',
  image4: '',
  image5: '',
  image6: '',
  image7: '',
  image8: '',
}

const bulkProductRowSchema = z.object({
  productGroupCode: optionalString.pipe(z.string().max(120).optional()),
  name: z.string().trim().min(3, 'Urun adi en az 3 karakter olmali').max(200),
  rootCategorySlug: optionalString.pipe(z.string().max(120).optional()),
  categorySlug: z.string().trim().min(1, 'Kategori zorunludur'),
  price: z.number().positive('Fiyat 0dan buyuk olmali'),
  stockQuantity: z.number().int('Stok tam sayi olmali').min(0, 'Stok negatif olamaz'),
  barcode: barcodeSchema,
  variantColor: optionalString.pipe(z.string().max(80).optional()),
  variantSize: optionalString.pipe(z.string().max(80).optional()),
  variantCustomOptionName: optionalString.pipe(z.string().max(80).optional()),
  variantCustomOptionValue: optionalString.pipe(z.string().max(120).optional()),
  sku: optionalString.pipe(z.string().max(120).optional()),
  shortDescription: optionalString.pipe(z.string().max(500).optional()),
  description: optionalString.pipe(z.string().max(5000).optional()),
  story: optionalString.pipe(z.string().max(5000).optional()),
  careInstructions: optionalString.pipe(z.string().max(5000).optional()),
  compareAtPrice: z.number().positive('Liste fiyati 0dan buyuk olmali').optional(),
  weight: z.number().positive('Agirlik 0dan buyuk olmali').optional(),
  image1: optionalString.pipe(z.string().url('Gorsel 1 gecerli bir URL olmali').optional()),
  image2: optionalString.pipe(z.string().url('Gorsel 2 gecerli bir URL olmali').optional()),
  image3: optionalString.pipe(z.string().url('Gorsel 3 gecerli bir URL olmali').optional()),
  image4: optionalString.pipe(z.string().url('Gorsel 4 gecerli bir URL olmali').optional()),
  image5: optionalString.pipe(z.string().url('Gorsel 5 gecerli bir URL olmali').optional()),
  image6: optionalString.pipe(z.string().url('Gorsel 6 gecerli bir URL olmali').optional()),
  image7: optionalString.pipe(z.string().url('Gorsel 7 gecerli bir URL olmali').optional()),
  image8: optionalString.pipe(z.string().url('Gorsel 8 gecerli bir URL olmali').optional()),
})

type ParsedBulkProductRow = z.infer<typeof bulkProductRowSchema>

export interface BulkProductImportRow
  extends Omit<
    ParsedBulkProductRow,
    | 'image1'
    | 'image2'
    | 'image3'
    | 'image4'
    | 'image5'
    | 'image6'
    | 'image7'
    | 'image8'
  > {
  imageUrls: string[]
  hasVariant: boolean
}

export interface BulkProductRowResult {
  rowNumber: number
  raw: Record<string, unknown>
  data?: BulkProductImportRow
  errors: string[]
}

function normalizeFingerprintValue(value: string | number | undefined) {
  if (value === undefined) return ''
  return String(value).trim()
}

export function buildBulkProductGroupKey(row: BulkProductImportRow) {
  const groupCode = row.productGroupCode?.trim()
  if (groupCode) return `group:${groupCode.toLowerCase()}`

  const sku = row.sku?.trim()
  if (sku) return `sku:${sku.toLowerCase()}`

  const fingerprint = JSON.stringify({
    name: normalizeFingerprintValue(row.name).toLowerCase(),
    categorySlug: normalizeFingerprintValue(row.categorySlug).toLowerCase(),
    shortDescription: normalizeFingerprintValue(row.shortDescription),
    description: normalizeFingerprintValue(row.description),
    story: normalizeFingerprintValue(row.story),
    careInstructions: normalizeFingerprintValue(row.careInstructions),
    compareAtPrice: normalizeFingerprintValue(row.compareAtPrice),
    weight: normalizeFingerprintValue(row.weight),
    imageUrls: row.imageUrls.map((url) => url.trim()),
  })

  return `fingerprint:${fingerprint}`
}

function normalizeHeaderKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseOptionalNumber(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN

  const normalized = String(value).trim()
  if (!normalized) return undefined

  const parsed = Number(normalized.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function normalizeCategoryValue(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''

  return looksLikeCategorySlug(normalized) ? normalizeCategorySlugValue(normalized) : normalized
}

function mapRawRowToInternalKeys(raw: Record<string, unknown>) {
  const prepared: Partial<Record<BulkImportMappedColumnKey, unknown>> = {}

  for (const [rawKey, value] of Object.entries(raw)) {
    const internalKey = TURKISH_TO_INTERNAL_HEADER_MAP.get(normalizeHeaderKey(rawKey))
    if (internalKey) {
      prepared[internalKey] = value
    }
  }

  return prepared
}

export function getMissingBulkProductHeaders(headers: string[]) {
  const normalizedHeaders = new Set(headers.map((header) => normalizeHeaderKey(header)))
  const missing = BULK_PRODUCT_COLUMN_CONFIG
    .filter((column) =>
      ['name', 'price', 'stockQuantity', 'barcode'].includes(column.key) &&
      !normalizedHeaders.has(normalizeHeaderKey(column.label)) &&
      !normalizedHeaders.has(normalizeHeaderKey(column.key)),
    )
    .map((column) => column.label)

  const hasCategoryHeader =
    normalizedHeaders.has(normalizeHeaderKey('Kategori*')) ||
    normalizedHeaders.has(normalizeHeaderKey('Kategori')) ||
    normalizedHeaders.has(normalizeHeaderKey('Kategori Slug*')) ||
    normalizedHeaders.has(normalizeHeaderKey('Kategori Slug')) ||
    normalizedHeaders.has(normalizeHeaderKey('categorySlug'))

  if (!hasCategoryHeader) {
    missing.push('Kategori*')
  }

  return missing
}

export function normalizeBulkProductRow(
  raw: Record<string, unknown>,
  rowNumber: number,
): BulkProductRowResult {
  const mapped = mapRawRowToInternalKeys(raw)
  const prepared = {
    productGroupCode: mapped.productGroupCode,
    name: String(mapped.name ?? '').trim(),
    rootCategorySlug: mapped.rootCategorySlug
      ? normalizeRootCategoryValue(String(mapped.rootCategorySlug))
      : undefined,
    categorySlug: normalizeCategoryValue(mapped.categorySlug),
    price: parseOptionalNumber(mapped.price),
    stockQuantity: parseOptionalNumber(mapped.stockQuantity),
    barcode: String(mapped.barcode ?? '').trim(),
    variantColor: mapped.variantColor,
    variantSize: mapped.variantSize,
    variantCustomOptionName: mapped.variantCustomOptionName,
    variantCustomOptionValue: mapped.variantCustomOptionValue,
    sku: mapped.sku,
    shortDescription: mapped.shortDescription,
    description: mapped.description,
    story: mapped.story,
    careInstructions: mapped.careInstructions,
    compareAtPrice: parseOptionalNumber(mapped.compareAtPrice),
    weight: parseOptionalNumber(mapped.weight),
    image1: mapped.image1,
    image2: mapped.image2,
    image3: mapped.image3,
    image4: mapped.image4,
    image5: mapped.image5,
    image6: mapped.image6,
    image7: mapped.image7,
    image8: mapped.image8,
  }

  const parsed = bulkProductRowSchema.safeParse(prepared)
  if (!parsed.success) {
    return {
      rowNumber,
      raw,
      errors: parsed.error.issues.map((issue) => issue.message),
    }
  }

  const imageUrls = BULK_PRODUCT_IMAGE_KEYS.map((key) => parsed.data[key])
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveManagedMediaSourceUrl(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeManagedMediaUrl(value))

  if (
    BULK_PRODUCT_IMAGE_KEYS.some((key) => {
      const val = parsed.data[key]
      return Boolean(val) && !isAllowedImageUrl(val as string)
    })
  ) {
    return {
      rowNumber,
      raw,
      errors: [
        'Goruntuler yalnizca platform CDN adresinizden yuklenebilir. Harici URL kullanilamaz.',
      ],
    }
  }

  if (parsed.data.compareAtPrice !== undefined && parsed.data.compareAtPrice <= parsed.data.price) {
    return {
      rowNumber,
      raw,
      errors: ['Liste fiyati satis fiyatindan buyuk olmalidir.'],
    }
  }

  const hasVariant = Boolean(
    parsed.data.variantColor ||
      parsed.data.variantSize ||
      parsed.data.variantCustomOptionName ||
      parsed.data.variantCustomOptionValue,
  )

  return {
    rowNumber,
    raw,
    data: {
      productGroupCode: parsed.data.productGroupCode,
      name: parsed.data.name,
      rootCategorySlug: parsed.data.rootCategorySlug,
      categorySlug: parsed.data.categorySlug,
      price: parsed.data.price,
      stockQuantity: parsed.data.stockQuantity,
      barcode: parsed.data.barcode,
      variantColor: parsed.data.variantColor,
      variantSize: parsed.data.variantSize,
      variantCustomOptionName: parsed.data.variantCustomOptionName,
      variantCustomOptionValue: parsed.data.variantCustomOptionValue,
      sku: parsed.data.sku,
      shortDescription: parsed.data.shortDescription,
      description: parsed.data.description,
      story: parsed.data.story,
      careInstructions: parsed.data.careInstructions,
      compareAtPrice: parsed.data.compareAtPrice,
      weight: parsed.data.weight,
      imageUrls,
      hasVariant,
    },
    errors: [],
  }
}
