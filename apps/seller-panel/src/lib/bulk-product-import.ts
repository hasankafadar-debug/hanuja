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

// Optional: blank cells are auto-generated ("8"-prefixed EAN-13) at commit time.
const barcodeSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{13}$/.test(value), 'Barkod 13 haneli rakam olmali')

export const BULK_PRODUCT_COLUMN_CONFIG = [
  { key: 'modelCode', label: 'Model Kodu*', required: true, helpText: 'Ayni satici ve ayni kategoride ayni Model Kodu verilen urunler, ayni modelin renk/materyal secenekleri kabul edilir ve urun detayinda birlikte gosterilir.' },
  { key: 'name', label: 'Urun Adi*', required: true, helpText: 'Urun adini en az 3, en fazla 200 karakter olarak girin.' },
  { key: 'categorySlug', label: 'Kategori*', required: true, helpText: 'Sablonda secilen kategori kapsami icinden bir kategori girin.' },
  { key: 'productColor', label: 'Renk 1*', required: true, helpText: 'Urunun ana renk secenegini girin. Ikiden fazla renk varsa Mix secin.' },
  { key: 'secondColor', label: 'Renk 2', required: false, helpText: 'Urun iki renkli ise ikinci rengi buradan secin. Ikiden fazla renk varsa Renk 1 sutununda Mix secenegini kullanin.' },
  { key: 'productMaterial', label: 'Materyal*', required: true, helpText: 'Urunun ana materyalini girin.' },
  { key: 'price', label: 'Fiyat*', required: true, helpText: 'Satis fiyatini TL olarak sifirdan buyuk girin.' },
  { key: 'fulfillmentDays', label: 'Sevk Suresi (is gunu)*', required: true, helpText: 'Sevk suresini 1 ile 90 is gunu arasinda bir tam sayi olarak girin.' },
  { key: 'stockQuantity', label: 'Stok*', required: true, helpText: 'Stok adedini sifir veya daha buyuk bir tam sayi olarak girin.' },
  { key: 'barcode', label: 'Barkod (13 hane)', required: false, helpText: 'Istege baglidir. Bos birakirsaniz 8 ile baslayan benzersiz 13 haneli barkod otomatik uretilir. Kendiniz girecekseniz sistem genelinde benzersiz olmalidir.' },
  { key: 'variantColor', label: 'Varyant Rengi', required: false, helpText: 'Ayni urun icindeki varyasyon icin renk girin. Bos birakabilirsiniz.' },
  { key: 'variantMaterial', label: 'Varyant Materyali', required: false, helpText: 'Ayni urun icindeki varyasyon icin materyal girin. Bos birakabilirsiniz.' },
  { key: 'variantSize', label: 'Beden', required: false, helpText: 'Beden veya olcu varyasyonunu girin. Bos birakabilirsiniz.' },
  { key: 'variantCustomOptionName', label: 'Ek Ozellik Adi', required: false, helpText: 'Varyasyon icin ek ozellik adini girin; deger girildiyse bu alan da doldurulmalidir.' },
  { key: 'variantCustomOptionValue', label: 'Ek Ozellik Degeri', required: false, helpText: 'Ek ozelligin secilen degerini girin; ad girildiyse bu alan da doldurulmalidir.' },
  { key: 'sku', label: 'SKU', required: false, helpText: 'Saticinin urunu kendi sisteminde tanimak icin belirledigi istege bagli koddur; varyant iliskilendirmesinde kullanilmaz.' },
  { key: 'shortDescription', label: 'Kisa Aciklama', required: false, helpText: 'Kisa urun aciklamasini en fazla 500 karakter olarak girin.' },
  { key: 'description', label: 'Aciklama', required: false, helpText: 'Urun aciklamasini en fazla 5000 karakter olarak girin.' },
  { key: 'story', label: 'Hikaye', required: false, helpText: 'Urun hikayesini en fazla 5000 karakter olarak girin.' },
  { key: 'careInstructions', label: 'Bakim Notu', required: false, helpText: 'Bakim bilgisini en fazla 5000 karakter olarak girin.' },
  { key: 'compareAtPrice', label: 'Liste Fiyati (ustu cizili)', required: false, helpText: 'Varsa satis fiyatindan yuksek liste fiyatini TL olarak girin.' },
  { key: 'weight', label: 'Agirlik (kg)', required: false, helpText: 'Varsa urun agirligini kilogram olarak sifirdan buyuk girin.' },
  { key: 'dimensionWidth', label: 'En (cm)', required: false, helpText: 'Istege bagli. Urun enini santimetre olarak girin. Girilirse urun sayfasinda gosterilir.' },
  { key: 'dimensionLength', label: 'Boy (cm)', required: false, helpText: 'Istege bagli. Urun boyunu santimetre olarak girin. Girilirse urun sayfasinda gosterilir.' },
  { key: 'dimensionHeight', label: 'Yukseklik (cm)', required: false, helpText: 'Istege bagli. Urun yuksekligini santimetre olarak girin. Girilirse urun sayfasinda gosterilir.' },
  ...Array.from({ length: BULK_PRODUCT_IMAGE_COLUMN_COUNT }, (_, index) => ({
    key: `image${index + 1}` as const,
    label: `Gorsel ${index + 1}`,
    required: false,
    helpText: 'Bu alana ilgili gorselinizin medya kutuphanesindeki baglantisini girebilirsiniz. Her gorsel icin ayri bir Gorsel sutununa baglanti girin.\n\nIsterseniz gorselleri urun olusturulduktan sonra Urun Duzenle bolumunden ekleyebilirsiniz.',
  })),
] as const

export type BulkProductColumnKey = (typeof BULK_PRODUCT_COLUMN_CONFIG)[number]['key']
type BulkImportMappedColumnKey = BulkProductColumnKey | 'rootCategorySlug'

export const BULK_PRODUCT_HEADERS = BULK_PRODUCT_COLUMN_CONFIG.map((column) => column.key)
export const BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG = BULK_PRODUCT_COLUMN_CONFIG
export const BULK_PRODUCT_TEMPLATE_HEADERS = BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.map((column) => column.label)

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

// Legacy exports used this heading before Model Kodu was introduced.
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Urun Grup Kodu'), 'modelCode')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ürün Grup Kodu'), 'modelCode')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Eski Fiyat'), 'compareAtPrice')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Urun Rengi'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Urun Rengi*'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Urun Renk'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Urun Renk*'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Renk 1'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Renk 1*'), 'productColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Renk 2'), 'secondColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ikincil Renk'), 'secondColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Materyal'), 'productMaterial')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Materyal*'), 'productMaterial')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Renk'), 'variantColor')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ana Kategori*'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ana Kategori'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('rootCategorySlug'), 'rootCategorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori*'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori Slug*'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Kategori Slug'), 'categorySlug')
TURKISH_TO_INTERNAL_HEADER_MAP.set(normalizeHeaderKey('Ürün Grup Kodu'), 'modelCode')
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
  modelCode: 'SEHPA-001',
  name: 'Dogal Mese Orta Sehpa',
  categorySlug: 'Mobilya / Sehpa Modelleri / Orta Sehpa',
  productColor: 'Ceviz',
  secondColor: '',
  productMaterial: 'Masif Ahsap',
  price: 3490,
  fulfillmentDays: 7,
  stockQuantity: 8,
  barcode: '8691234567890',
  variantColor: 'Ceviz',
  variantMaterial: '',
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
  dimensionWidth: 100,
  dimensionLength: 30,
  dimensionHeight: 45,
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
  modelCode: z.string().trim().min(1, 'Model Kodu zorunludur').max(120),
  name: z.string().trim().min(3, 'Urun adi en az 3 karakter olmali').max(200),
  rootCategorySlug: optionalString.pipe(z.string().max(120).optional()),
  categorySlug: z.string().trim().min(1, 'Kategori zorunludur'),
  productColor: z.string().trim().min(1, 'Urun rengi zorunludur').max(80),
  secondColor: optionalString.pipe(z.string().max(80).optional()),
  productMaterial: z.string().trim().min(1, 'Materyal zorunludur').max(80),
  price: z.number().positive('Fiyat 0dan buyuk olmali'),
  fulfillmentDays: z.number().int('Sevk suresi tam sayi olmali').min(1, 'Sevk suresi en az 1 is gunu olmali').max(90, 'Sevk suresi en fazla 90 is gunu olmali'),
  stockQuantity: z.number().int('Stok tam sayi olmali').min(0, 'Stok negatif olamaz'),
  barcode: barcodeSchema,
  variantColor: optionalString.pipe(z.string().max(80).optional()),
  variantMaterial: optionalString.pipe(z.string().max(80).optional()),
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
  dimensionLength: z.number().positive('Boy 0dan buyuk olmali').optional(),
  dimensionWidth: z.number().positive('En 0dan buyuk olmali').optional(),
  dimensionHeight: z.number().positive('Yukseklik 0dan buyuk olmali').optional(),
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

/**
 * Converts preview rows back to the wire format accepted by the bulk API.
 * Image URLs are intentionally expanded into image1..image8 so a second
 * server-side normalization pass cannot discard them.
 */
export function serializeBulkProductImportRowsForApi(rows: BulkProductImportRow[]) {
  return rows.map(({ imageUrls, ...row }) => ({
    ...row,
    ...Object.fromEntries(
      BULK_PRODUCT_IMAGE_KEYS.map((key, index) => [key, imageUrls[index] ?? '']),
    ),
  }))
}

export interface BulkProductRowResult {
  rowNumber: number
  raw: Record<string, unknown>
  data?: BulkProductImportRow
  errors: string[]
}

export function buildBulkProductGroupKey(row: BulkProductImportRow) {
  const category = row.categorySlug.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase()
  const modelCode = row.modelCode.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase()
  return `model:${category}::${modelCode}`
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
  const requiredKeys = BULK_PRODUCT_COLUMN_CONFIG
    .filter((column) => 'required' in column && column.required)
    .map((column) => column.key)
  const missing = BULK_PRODUCT_COLUMN_CONFIG
    .filter((column) =>
      requiredKeys.includes(column.key) &&
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

  // Renk 1 kolonu 'Urun Rengi*'ndan 'Renk 1*'e yeniden adlandirildi. Eski indirilmis
  // sablonlar hala 'Urun Rengi*' basligiyla gelir; bunlari da gecerli say (parse
  // TURKISH_TO_INTERNAL_HEADER_MAP ile zaten productColor'a esler).
  const hasProductColorHeader =
    normalizedHeaders.has(normalizeHeaderKey('Renk 1*')) ||
    normalizedHeaders.has(normalizeHeaderKey('Renk 1')) ||
    normalizedHeaders.has(normalizeHeaderKey('productColor')) ||
    normalizedHeaders.has(normalizeHeaderKey('Urun Rengi*')) ||
    normalizedHeaders.has(normalizeHeaderKey('Urun Rengi'))
  if (hasProductColorHeader) {
    const idx = missing.findIndex((label) => normalizeHeaderKey(label) === normalizeHeaderKey('Renk 1*'))
    if (idx !== -1) missing.splice(idx, 1)
  }

  return missing
}

export function normalizeBulkProductRow(
  raw: Record<string, unknown>,
  rowNumber: number,
): BulkProductRowResult {
  const mapped = mapRawRowToInternalKeys(raw)
  const prepared = {
    modelCode: String(mapped.modelCode ?? '').trim(),
    name: String(mapped.name ?? '').trim(),
    rootCategorySlug: mapped.rootCategorySlug
      ? normalizeRootCategoryValue(String(mapped.rootCategorySlug))
      : undefined,
    categorySlug: normalizeCategoryValue(mapped.categorySlug),
    productColor: mapped.productColor,
    secondColor: mapped.secondColor,
    productMaterial: mapped.productMaterial,
    price: parseOptionalNumber(mapped.price),
    fulfillmentDays: parseOptionalNumber(mapped.fulfillmentDays),
    stockQuantity: parseOptionalNumber(mapped.stockQuantity),
    barcode: String(mapped.barcode ?? '').trim(),
    variantColor: mapped.variantColor,
    variantMaterial: mapped.variantMaterial,
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
    dimensionLength: parseOptionalNumber(mapped.dimensionLength),
    dimensionWidth: parseOptionalNumber(mapped.dimensionWidth),
    dimensionHeight: parseOptionalNumber(mapped.dimensionHeight),
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
      parsed.data.variantMaterial ||
      parsed.data.variantSize ||
      parsed.data.variantCustomOptionName ||
      parsed.data.variantCustomOptionValue,
  )

  return {
    rowNumber,
    raw,
    data: {
      modelCode: parsed.data.modelCode,
      name: parsed.data.name,
      rootCategorySlug: parsed.data.rootCategorySlug,
      categorySlug: parsed.data.categorySlug,
      productColor: parsed.data.productColor,
      secondColor: parsed.data.secondColor,
      productMaterial: parsed.data.productMaterial,
      price: parsed.data.price,
      fulfillmentDays: parsed.data.fulfillmentDays,
      stockQuantity: parsed.data.stockQuantity,
      barcode: parsed.data.barcode,
      variantColor: parsed.data.variantColor,
      variantMaterial: parsed.data.variantMaterial,
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
      dimensionLength: parsed.data.dimensionLength,
      dimensionWidth: parsed.data.dimensionWidth,
      dimensionHeight: parsed.data.dimensionHeight,
      imageUrls,
      hasVariant,
    },
    errors: [],
  }
}
