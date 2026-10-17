import { validateVariantDescriptor } from '@hanuja/api/services/category-schema.service'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import {
  buildBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRowsByScope,
  findBulkCategoryReferenceRowBySlug,
  looksLikeCategorySlug,
  normalizeCategorySlugValue,
  normalizeRootCategoryValue,
  resolveBulkCategoryRealSlug,
} from '@/lib/bulk-category-options'
import {
  buildBulkProductGroupKey,
  MAX_BULK_IMPORT_ROWS,
  normalizeBulkProductRow,
  type BulkProductImportRow,
} from '@/lib/bulk-product-import'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'
import { createBulkValidationError, type BulkValidationError } from '@/lib/bulk-validation-error'
import {
  BULK_IMPORT_TRANSACTION_MAX_WAIT_MS,
  BULK_IMPORT_TRANSACTION_TIMEOUT_MS,
} from '@/lib/bulk-import-transaction'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { recordPriceChanges } from '@hanuja/api/services/price-history.service'
import {
  isBarcodeConflict,
  syncVariantBarcodeReservation,
} from '@hanuja/api/domain/barcode-registry'
import { generateUniqueProductBarcode } from '@hanuja/api/domain/barcode-generate'
import { requireModelCode } from '@hanuja/api/domain/model-code'
import { enqueueProductSync } from '@hanuja/api/jobs/search-index-sync.job'
import {
  resolveCategorySchema,
  validateSharedAttributes,
  normalizedProductProperties,
  normalizedVariantProperties,
} from '@hanuja/api/services/category-schema.service'
import {
  variantPropertyKey,
  propertyLabel,
  type ProductProperties,
  type ResolvedCategorySchema,
} from '@hanuja/api/domain/category-schema'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

type AttributeOption = {
  id: string
  type: 'color' | 'material'
  label: string
  slug: string
  sortOrder: number
}

type ResolvedBulkProductImportRow = BulkProductImportRow & {
  productColorOptionId: string | null
  // Renk 2 (opsiyonel): girildiyse çözümlenmiş option id, yoksa null.
  productSecondColorOptionId: string | null
  productMaterialOptionId: string | null
  variantProperties?: ProductProperties
  variantLabel?: string
}

function variantName(row: BulkProductImportRow) {
  const parts: string[] = []
  if (row.variantSize)
    parts.push(
      `${(row as ResolvedBulkProductImportRow).variantLabel ?? 'Beden'}: ${row.variantSize}`,
    )
  if (row.variantCustomOptionName && row.variantCustomOptionValue) {
    parts.push(`${row.variantCustomOptionName}: ${row.variantCustomOptionValue}`)
  }
  return parts.join(' / ') || row.barcode
}

function variantOptions(row: BulkProductImportRow) {
  validateVariantDescriptor(
    row.variantCustomOptionName,
    (row as ResolvedBulkProductImportRow).variantLabel,
  )
  const options: Record<string, string> = {}
  if (row.variantSize)
    options[(row as ResolvedBulkProductImportRow).variantLabel ?? 'Beden'] = row.variantSize
  if (row.variantCustomOptionName && row.variantCustomOptionValue) {
    options[row.variantCustomOptionName] = row.variantCustomOptionValue
  }
  return options
}

function hasDetailVariant(row: BulkProductImportRow) {
  return Boolean(row.variantSize || row.variantCustomOptionName || row.variantCustomOptionValue)
}

function buildVisualVariantKey(row: ResolvedBulkProductImportRow) {
  return [
    row.productColorOptionId,
    row.productMaterialOptionId,
    normalizeAttributeValue(row.productColor),
    normalizeAttributeValue(row.productMaterial),
  ].join('::')
}

function normalizeAttributeValue(value: string | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getCategoryAttributeOptions(params: {
  categorySlug: string
  type: 'color' | 'material'
  optionsByCategorySlug: Map<string, AttributeOption[]>
  fallbackOptions: Record<'color' | 'material', AttributeOption[]>
}) {
  const categoryOptions = params.optionsByCategorySlug.get(params.categorySlug) ?? []
  const scopedOptions = categoryOptions.filter((option) => option.type === params.type)
  return scopedOptions.length > 0 ? scopedOptions : params.fallbackOptions[params.type]
}

function resolveAttributeOption(params: {
  categorySlug: string
  type: 'color' | 'material'
  value: string
  optionsByCategorySlug: Map<string, AttributeOption[]>
  fallbackOptions: Record<'color' | 'material', AttributeOption[]>
}) {
  const normalizedValue = normalizeAttributeValue(params.value)
  const options = getCategoryAttributeOptions(params)

  return (
    options.find(
      (option) =>
        normalizeAttributeValue(option.label) === normalizedValue ||
        normalizeAttributeValue(option.slug) === normalizedValue,
    ) ?? null
  )
}

function collectAllowedLegacyCategorySlugs(
  allCategories: Array<{ id: string; slug: string; parentId: string | null }>,
  parentCategorySlug: string,
) {
  const selected = allCategories.find((category) => category.slug === parentCategorySlug)
  if (!selected) return null

  const childrenByParent = new Map<string | null, typeof allCategories>()
  for (const category of allCategories) {
    const children = childrenByParent.get(category.parentId) ?? []
    children.push(category)
    childrenByParent.set(category.parentId, children)
  }

  const allowedCategorySlugs = new Set<string>()

  const collect = (id: string) => {
    const category = allCategories.find((item) => item.id === id)
    if (category) allowedCategorySlugs.add(category.slug)
    for (const child of childrenByParent.get(id) ?? []) collect(child.id)
  }

  collect(selected.id)
  return allowedCategorySlugs
}

function resolveCategorySlug(params: {
  row: BulkProductImportRow
  referenceRows: ReturnType<typeof buildBulkCategoryReferenceRows>
  realCategorySlugs: Set<string>
  selectedRootCategorySlug?: string | undefined
  selectedScopeCategorySlug?: string | undefined
  allowedCategorySlugs?: Set<string> | null | undefined
}) {
  const {
    row,
    referenceRows,
    realCategorySlugs,
    selectedRootCategorySlug,
    selectedScopeCategorySlug,
    allowedCategorySlugs,
  } = params

  const activeRootCategorySlug = selectedRootCategorySlug || row.rootCategorySlug
  const normalizedSelectedScope = selectedScopeCategorySlug
    ? normalizeCategorySlugValue(selectedScopeCategorySlug)
    : ''

  if (looksLikeCategorySlug(row.categorySlug)) {
    const legacySlug = normalizeCategorySlugValue(row.categorySlug)
    const legacyMatch = findBulkCategoryReferenceRowBySlug(referenceRows, legacySlug)

    if (
      legacyMatch &&
      (!activeRootCategorySlug ||
        normalizeRootCategoryValue(legacyMatch.rootSlug) ===
          normalizeRootCategoryValue(activeRootCategorySlug)) &&
      (!normalizedSelectedScope || legacyMatch.pathSlugs.includes(normalizedSelectedScope)) &&
      (!allowedCategorySlugs || allowedCategorySlugs.has(legacySlug))
    ) {
      return legacySlug
    }

    if (
      !activeRootCategorySlug &&
      !normalizedSelectedScope &&
      !allowedCategorySlugs &&
      realCategorySlugs.has(legacySlug)
    ) {
      return legacySlug
    }
  }

  if (activeRootCategorySlug) {
    const resolved = resolveBulkCategoryRealSlug(
      referenceRows,
      activeRootCategorySlug,
      row.categorySlug,
      selectedScopeCategorySlug,
    )
    if (resolved && (!allowedCategorySlugs || allowedCategorySlugs.has(resolved))) {
      return resolved
    }
  }

  if (row.rootCategorySlug) {
    const resolved = resolveBulkCategoryRealSlug(
      referenceRows,
      row.rootCategorySlug,
      row.categorySlug,
    )
    if (resolved && (!allowedCategorySlugs || allowedCategorySlugs.has(resolved))) {
      return resolved
    }
  }

  return null
}

async function handleBulkProducts(req: NextRequest, validateOnly = false) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Tasarımcı hesabi bulunamadi.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    rows?: unknown[]
    parentCategorySlug?: string
    templateCategoryKey?: string
    rootCategorySlug?: string
    scopeCategorySlug?: string
  }
  const rows = Array.isArray(body.rows) ? body.rows : []
  const parentCategorySlug =
    typeof body.parentCategorySlug === 'string' ? body.parentCategorySlug.trim() : ''
  const templateCategoryKey =
    typeof body.templateCategoryKey === 'string' ? body.templateCategoryKey.trim() : ''
  const rootCategorySlug =
    typeof body.rootCategorySlug === 'string' ? body.rootCategorySlug.trim() : ''
  const scopeCategorySlug =
    typeof body.scopeCategorySlug === 'string' ? body.scopeCategorySlug.trim() : ''

  if ((rootCategorySlug && !scopeCategorySlug) || (!rootCategorySlug && scopeCategorySlug)) {
    return NextResponse.json(
      { error: 'Ice aktarma icin hem alan hem kategori secilmelidir.' },
      { status: 400 },
    )
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Ice aktarilacak satir bulunamadi.' }, { status: 400 })
  }

  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Bir seferde en fazla ${MAX_BULK_IMPORT_ROWS} satir yukleyebilirsiniz.` },
      { status: 400 },
    )
  }

  // index + 2: row 1 = header in Excel, so first data row is row 2
  const normalizedRows = rows.map((row, index) =>
    normalizeBulkProductRow(row as Record<string, unknown>, index + 2),
  )
  const validationErrors = normalizedRows.flatMap((row) =>
    row.errors.map((message) =>
      createBulkValidationError(row.rowNumber, 'row', 'invalid_row', message),
    ),
  )

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: 'Bazi satirlar gecersiz.', errors: validationErrors },
      { status: 400 },
    )
  }

  const validEntries: Array<{ rowNumber: number; data: BulkProductImportRow }> =
    normalizedRows.flatMap((row) =>
      row.data ? [{ rowNumber: row.rowNumber, data: row.data }] : [],
    )

  const [allCategories, allAttributeOptions, categoriesWithAttributes] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, parentId: true },
    }),
    prisma.productAttributeOption.findMany({
      where: { isActive: true },
      select: { id: true, type: true, label: true, slug: true, sortOrder: true },
      orderBy: { label: 'asc' },
    }) as Promise<AttributeOption[]>,
    prisma.category.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        attributeOptions: {
          select: {
            option: {
              select: { id: true, type: true, label: true, slug: true, sortOrder: true },
            },
          },
        },
      },
    }) as Promise<
      Array<{
        slug: string
        attributeOptions: Array<{ option: AttributeOption }>
      }>
    >,
  ])
  const categoryMap = new Map(allCategories.map((category) => [category.slug, category.id]))
  const realCategorySlugs = new Set(allCategories.map((category) => category.slug))
  const referenceRows = buildBulkCategoryReferenceRows(allCategories)
  const fallbackAttributeOptions = {
    color: sortAttributeOptions(allAttributeOptions.filter((option) => option.type === 'color')),
    material: sortAttributeOptions(
      allAttributeOptions.filter((option) => option.type === 'material'),
    ),
  }
  const attributeOptionsByCategorySlug = new Map(
    categoriesWithAttributes.map((category) => [
      category.slug,
      sortAttributeOptions(category.attributeOptions.map((item) => item.option)),
    ]),
  )

  let allowedCategorySlugs: Set<string> | null = null
  if (rootCategorySlug && scopeCategorySlug) {
    const scopeRow = findBulkCategoryReferenceRowBySlug(referenceRows, scopeCategorySlug)
    const matchesRoot =
      scopeRow &&
      normalizeRootCategoryValue(scopeRow.rootSlug) === normalizeRootCategoryValue(rootCategorySlug)

    if (!matchesRoot) {
      // Only leaf categories have a reference row; a missing row means an
      // intermediate category was selected.
      return NextResponse.json({ error: 'En alt kategoriyi seçmelisiniz.' }, { status: 400 })
    }

    allowedCategorySlugs = new Set(
      filterBulkCategoryReferenceRowsByScope(
        referenceRows,
        rootCategorySlug,
        scopeCategorySlug,
      ).map((row) => row.realSlug),
    )
  } else if (templateCategoryKey) {
    allowedCategorySlugs = new Set(
      filterBulkCategoryReferenceRows(referenceRows, templateCategoryKey).map(
        (row) => row.realSlug,
      ),
    )
  } else if (parentCategorySlug) {
    allowedCategorySlugs = collectAllowedLegacyCategorySlugs(allCategories, parentCategorySlug)
  }

  if (
    rootCategorySlug &&
    scopeCategorySlug &&
    (!allowedCategorySlugs || allowedCategorySlugs.size === 0)
  ) {
    return NextResponse.json(
      { error: 'Secilen kategori kapsaminda ice aktarilabilir satir bulunamadi.' },
      { status: 400 },
    )
  }

  const resolutionErrors: BulkValidationError[] = []
  const resolvedEntries = validEntries.flatMap((entry) => {
    const resolvedCategorySlug = resolveCategorySlug({
      row: entry.data,
      referenceRows,
      realCategorySlugs,
      selectedRootCategorySlug: rootCategorySlug || undefined,
      selectedScopeCategorySlug: scopeCategorySlug || undefined,
      allowedCategorySlugs,
    })
    if (!resolvedCategorySlug) {
      const message =
        rootCategorySlug && scopeCategorySlug
          ? `Kategori secilen kapsamda bulunamadi: ${entry.data.categorySlug}`
          : `Kategori cozumlenemedi: ${entry.data.categorySlug}. Sablon indirirken alan ve kategori secimini yapin.`

      resolutionErrors.push(
        createBulkValidationError(entry.rowNumber, 'categorySlug', 'category_unresolved', message),
      )
      return []
    }

    return [
      { rowNumber: entry.rowNumber, data: { ...entry.data, categorySlug: resolvedCategorySlug } },
    ]
  })

  if (resolutionErrors.length > 0) {
    return NextResponse.json(
      { error: 'Bazi satirlar kategori olarak eslestirilemedi.', errors: resolutionErrors },
      { status: 400 },
    )
  }

  const attributeErrors: BulkValidationError[] = []
  const resolvedEntriesWithAttributes: Array<{
    rowNumber: number
    data: ResolvedBulkProductImportRow
  }> = resolvedEntries.flatMap((entry) => {
    const productColorRaw = entry.data.productColor?.trim()
    const productColorOption = productColorRaw
      ? resolveAttributeOption({
          categorySlug: entry.data.categorySlug,
          type: 'color',
          value: productColorRaw,
          optionsByCategorySlug: attributeOptionsByCategorySlug,
          fallbackOptions: fallbackAttributeOptions,
        })
      : null
    const productMaterialRaw = entry.data.productMaterial?.trim()
    const productMaterialOption = productMaterialRaw
      ? resolveAttributeOption({
          categorySlug: entry.data.categorySlug,
          type: 'material',
          value: productMaterialRaw,
          optionsByCategorySlug: attributeOptionsByCategorySlug,
          fallbackOptions: fallbackAttributeOptions,
        })
      : null
    // Renk 2 opsiyonel: yalnız doluysa çözümle. Doluysa ve çözülemezse hata.
    const secondColorRaw = entry.data.secondColor?.trim()
    const productSecondColorOption = secondColorRaw
      ? resolveAttributeOption({
          categorySlug: entry.data.categorySlug,
          type: 'color',
          value: secondColorRaw,
          optionsByCategorySlug: attributeOptionsByCategorySlug,
          fallbackOptions: fallbackAttributeOptions,
        })
      : null

    if (productColorRaw && !productColorOption) {
      attributeErrors.push(
        createBulkValidationError(
          entry.rowNumber,
          'productColor',
          'invalid_color',
          `Renk secilen kategori icin gecersiz: ${entry.data.productColor}`,
        ),
      )
    }
    if (secondColorRaw && !productSecondColorOption) {
      attributeErrors.push(
        createBulkValidationError(
          entry.rowNumber,
          'secondColor',
          'invalid_second_color',
          `Renk 2 secilen kategori icin gecersiz: ${secondColorRaw}`,
        ),
      )
    }
    if (
      productSecondColorOption &&
      productColorOption &&
      productSecondColorOption.id === productColorOption.id
    ) {
      attributeErrors.push(
        createBulkValidationError(
          entry.rowNumber,
          'secondColor',
          'duplicate_second_color',
          'Renk 2, Renk 1 ile ayni olamaz.',
        ),
      )
    }
    if (productMaterialRaw && !productMaterialOption) {
      attributeErrors.push(
        createBulkValidationError(
          entry.rowNumber,
          'productMaterial',
          'invalid_material',
          `Materyal secilen kategori icin gecersiz: ${entry.data.productMaterial}`,
        ),
      )
    }

    if (productColorRaw && !productColorOption) return []
    if (productMaterialRaw && !productMaterialOption) return []
    if (secondColorRaw && !productColorOption) return []
    if (secondColorRaw && !productSecondColorOption) return []
    if (productSecondColorOption && productSecondColorOption.id === productColorOption?.id)
      return []

    return [
      {
        rowNumber: entry.rowNumber,
        data: {
          ...entry.data,
          productColorOptionId: productColorOption?.id ?? null,
          productSecondColorOptionId: productSecondColorOption?.id ?? null,
          productMaterialOptionId: productMaterialOption?.id ?? null,
        },
      },
    ]
  })

  if (attributeErrors.length > 0) {
    return NextResponse.json(
      { error: 'Bazi satirlarda renk veya materyal gecersiz.', errors: attributeErrors },
      { status: 400 },
    )
  }

  const validRows = resolvedEntriesWithAttributes.map((entry) => entry.data)

  // Barcode is optional: only seller-entered barcodes are de-duplicated and
  // checked. Blank cells are auto-generated ("8"-prefixed) at commit time.
  const duplicateErrors: BulkValidationError[] = []
  const seenBarcodes = new Set<string>()
  for (const entry of resolvedEntriesWithAttributes) {
    const barcode = entry.data.barcode?.trim()
    if (!barcode) continue
    if (seenBarcodes.has(barcode)) {
      duplicateErrors.push(
        createBulkValidationError(
          entry.rowNumber,
          'barcode',
          'duplicate_in_file',
          `Ayni barkod tekrar ediyor: ${barcode}`,
        ),
      )
    }
    seenBarcodes.add(barcode)
  }

  if (duplicateErrors.length > 0) {
    return NextResponse.json(
      { error: 'Dosya icinde yinelenen barkod bulundu.', errors: duplicateErrors },
      { status: 400 },
    )
  }

  const allBarcodes = validRows
    .map((row) => row.barcode?.trim())
    .filter((barcode): barcode is string => Boolean(barcode))

  const existingReservations = await prisma.barcodeRegistry.findMany({
    where: { barcode: { in: allBarcodes } },
    select: { barcode: true },
  })
  const existingBarcodeSet = new Set(existingReservations.map((item) => item.barcode))

  const errors: BulkValidationError[] = []
  const schemas = new Map<string, ResolvedCategorySchema>()
  const modelGroups = new Map<
    string,
    Array<{ rowNumber: number; data: ResolvedBulkProductImportRow }>
  >()
  for (const entry of resolvedEntriesWithAttributes) {
    const key = buildBulkProductGroupKey(entry.data)
    const group = modelGroups.get(key) ?? []
    group.push(entry)
    modelGroups.set(key, group)
  }

  const importGroups: Array<Array<{ rowNumber: number; data: ResolvedBulkProductImportRow }>> = []
  for (const modelGroup of modelGroups.values()) {
    if (new Set(modelGroup.map(entry => entry.data.brand.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i'))).size > 1) {
      for (const entry of modelGroup) errors.push(createBulkValidationError(entry.rowNumber, 'brand', 'brand_mismatch', 'Aynı ürün grubundaki tüm satırlarda aynı marka olmalıdır.'))
      continue
    }
    const visualGroups = new Map<
      string,
      Array<{ rowNumber: number; data: ResolvedBulkProductImportRow }>
    >()

    for (const entry of modelGroup) {
      const visualKey = buildVisualVariantKey(entry.data)
      const group = visualGroups.get(visualKey) ?? []
      group.push(entry)
      visualGroups.set(visualKey, group)
    }

    for (const group of visualGroups.values()) {
      const first = group[0]
      if (!first) continue

      const data = first.data
      if (allowedCategorySlugs && !allowedCategorySlugs.has(data.categorySlug)) {
        errors.push(
          createBulkValidationError(
            first.rowNumber,
            'categorySlug',
            'category_out_of_scope',
            `Bu kategori secilen sablon kapsaminda degil: ${data.categorySlug}`,
          ),
        )
        continue
      }

      const categoryId = categoryMap.get(data.categorySlug)
      if (!categoryId) {
        errors.push(
          createBulkValidationError(
            first.rowNumber,
            'categorySlug',
            'category_not_found',
            `Kategori bulunamadi: ${data.categorySlug}`,
          ),
        )
        continue
      }

      const groupBarcodes = group.map((entry) => entry.data.barcode)
      try {
        const schema = schemas.get(categoryId) ?? (await resolveCategorySchema(prisma, categoryId))
        schemas.set(categoryId, schema)
        const usesVariants = group.length > 1 || group.some((entry) => hasDetailVariant(entry.data))
        if (usesVariants && !schema.config.variantKey)
          throw new Error(
            'Bu şablonda varyant yok; satırları ayrı Model Kodu ile ürün olarak yükleyin.',
          )
        for (const entry of group) {
          const metadata = entry.data.schemaMetadata
          if (metadata) {
            if (
              metadata.categoryId !== categoryId ||
              metadata.templateCode !== schema.templateCode ||
              metadata.schemaVersion !== schema.schemaVersion
            )
              throw new Error(
                'Şablon güncellendi veya kategori farklı. Bu kategori için yeni şablonu indirin.',
              )
          } else if (
            !['ev', 'ofis'].includes(
              referenceRows.find((r) => r.realSlug === entry.data.categorySlug)?.rootSlug ?? '',
            ) ||
            schema.schemaVersion !== 1
          )
            throw new Error('Bu kategori için güncel şablonu indirin; dosyanın şablon bilgisi yok.')
          if (entry.data.contentUnit !== data.contentUnit)
            throw new Error('Aynı ürünün bütün varyantlarında Net İçerik Birimi aynı olmalıdır.')
          await validateSharedAttributes(prisma, schema, {
            colorOptionId: entry.data.productColorOptionId,
            secondColorOptionId: entry.data.productSecondColorOptionId,
            materialOptionId: entry.data.productMaterialOptionId,
          })
          const key = variantPropertyKey(schema, entry.data.contentUnit)
          entry.data.properties = normalizedProductProperties(
            schema,
            entry.data.properties ?? {},
            {},
            true,
            key,
            usesVariants,
          )
          if (usesVariants && key) {
            entry.data.variantProperties = normalizedVariantProperties(
              schema,
              { [key]: entry.data.variantSize ?? '' },
              entry.data.properties,
              entry.data.contentUnit,
            )
            entry.data.variantLabel = schema.config.variantLabel ?? key
            const definition = schema.definitions.find((d) => d.key === key)!
            entry.data.variantSize = propertyLabel(
              definition,
              entry.data.variantProperties[key] ?? null,
            )
          }
        }
        const common = [
          'name',
          'categorySlug',
          'fulfillmentDays',
          'sku',
          'shortDescription',
          'description',
          'story',
          'careInstructions',
          'weight',
          'dimensionLength',
          'dimensionWidth',
          'dimensionHeight',
          'productColor',
          'secondColor',
          'productMaterial',
        ] as const
        if (group.some((entry) => common.some((key) => entry.data[key] !== data[key])))
          throw new Error('Aynı ürünün varyant satırlarında ortak bilgiler aynı olmalıdır.')
        if (
          group.some(
            (entry) => JSON.stringify(entry.data.properties) !== JSON.stringify(data.properties),
          )
        )
          throw new Error(
            'Aynı ürünün varyant satırlarında ürün özellikleri aynı olmalıdır. Farklı özellikleri ayrı ürün olarak yükleyin.',
          )
      } catch (error) {
        for (const entry of group)
          errors.push(
            createBulkValidationError(
              entry.rowNumber,
              'properties',
              'invalid_properties',
              error instanceof Error ? error.message : 'Özellikler geçersiz.',
            ),
          )
        continue
      }
      const distinctSkus = new Set(group.map((entry) => entry.data.sku?.trim()).filter(Boolean))
      if (distinctSkus.size > 1) {
        for (const entry of group) {
          errors.push(
            createBulkValidationError(
              entry.rowNumber,
              'sku',
              'inconsistent_sku',
              'Aynı ürünün varyant satırlarında SKU değeri aynı olmalıdır.',
            ),
          )
        }
        continue
      }
      const conflictingBarcode = groupBarcodes.find(
        (barcode) => barcode?.trim() && existingBarcodeSet.has(barcode.trim()),
      )
      if (conflictingBarcode) {
        errors.push(
          createBulkValidationError(
            first.rowNumber,
            'barcode',
            'barcode_in_use',
            `Barkod zaten kullaniliyor: ${conflictingBarcode}`,
          ),
        )
        continue
      }
      importGroups.push(group)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Bazı satırlar doğrulanamadı.', imported: 0, failed: errors.length, errors },
      { status: 400 },
    )
  }

  if (validateOnly) {
    return NextResponse.json({ valid: true, errors: [] })
  }

  const publishedProductIds: string[] = []
  const createdProductIds: string[] = []
  // Seeded with seller-entered barcodes so auto-generated ones cannot collide
  // with a still-pending entered barcode inside the same import.
  const usedBarcodes = new Set<string>(allBarcodes)
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const group of importGroups) {
          const first = group[0]
          if (!first) continue
          const data = first.data
          const categoryId = categoryMap.get(data.categorySlug)
          if (!categoryId) throw new Error(`Kategori bulunamadi: ${data.categorySlug}`)
          const usesVariants =
            group.length > 1 || group.some((entry) => hasDetailVariant(entry.data))
          const schema = await resolveCategorySchema(tx, categoryId)
          if (JSON.stringify(schema) !== JSON.stringify(schemas.get(categoryId)))
            throw new Error('Şablon yükleme sırasında değişti. Dosyayı yeniden doğrulayın.')
          for (const entry of group) {
            await validateSharedAttributes(tx, schema, {
              colorOptionId: entry.data.productColorOptionId,
              secondColorOptionId: entry.data.productSecondColorOptionId,
              materialOptionId: entry.data.productMaterialOptionId,
            })
            if (usesVariants)
              entry.data.variantProperties = normalizedVariantProperties(
                schema,
                entry.data.variantProperties ?? {},
                entry.data.properties ?? {},
                entry.data.contentUnit,
              )
          }
          const catalogService = createCatalogService({ prisma: tx as unknown as PrismaClient })
          const product = await catalogService.createProduct({
            sellerId: seller.id,
            categoryId,
            name: data.name,
            brand: data.brand,
            description: data.description ?? '',
            shortDescription: data.shortDescription ?? null,
            story: data.story ?? null,
            careInstructions: data.careInstructions ?? null,
            price: new Decimal(data.price),
            compareAtPrice:
              data.compareAtPrice !== undefined ? new Decimal(data.compareAtPrice) : null,
            fulfillmentDays: data.fulfillmentDays,
            stockQuantity: usesVariants
              ? group.reduce((sum, entry) => sum + entry.data.stockQuantity, 0)
              : data.stockQuantity,
            sku: data.sku ?? null,
            modelCode: requireModelCode(data.modelCode),
            barcode: usesVariants ? null : data.barcode?.trim() || null,
            autoGenerateBarcodeWhenMissing: !usesVariants,
            weight: data.weight !== undefined ? new Decimal(data.weight) : null,
            dimensionLength:
              data.dimensionLength !== undefined ? new Decimal(data.dimensionLength) : null,
            dimensionWidth:
              data.dimensionWidth !== undefined ? new Decimal(data.dimensionWidth) : null,
            dimensionHeight:
              data.dimensionHeight !== undefined ? new Decimal(data.dimensionHeight) : null,
            deferVisibilitySync: true,
            properties: data.properties,
            hasVariants: usesVariants,
            contentUnit: data.contentUnit,
          })
          if (product.status === 'published') publishedProductIds.push(product.id)
          createdProductIds.push(product.id)

          if (usesVariants) {
            for (const entry of group) {
              const variantBarcode =
                entry.data.barcode?.trim() ||
                (await generateUniqueProductBarcode(tx as unknown as PrismaClient, {
                  used: usedBarcodes,
                }))
              const variant = await tx.productVariant.create({
                data: {
                  productId: product.id,
                  name: variantName(entry.data) || variantBarcode,
                  options: variantOptions(entry.data),
                  properties: entry.data.variantProperties ?? {},
                  barcode: variantBarcode,
                  price: new Decimal(entry.data.price),
                  stockQuantity: entry.data.stockQuantity,
                },
              })
              await syncVariantBarcodeReservation(tx, variant.id, variantBarcode)
            }
          }

          const attributeValues = [
            // Renk 1 → sortOrder 0, Renk 2 (varsa) → 1, materyal → 0.
            ...(data.productColorOptionId
              ? [{ productId: product.id, optionId: data.productColorOptionId, sortOrder: 0 }]
              : []),
            ...(data.productSecondColorOptionId
              ? [{ productId: product.id, optionId: data.productSecondColorOptionId, sortOrder: 1 }]
              : []),
            ...(data.productMaterialOptionId
              ? [{ productId: product.id, optionId: data.productMaterialOptionId, sortOrder: 0 }]
              : []),
          ]
          if (attributeValues.length > 0) {
            await tx.productAttributeValue.createMany({
              data: attributeValues,
              skipDuplicates: true,
            })
          }

          if (data.imageUrls.length > 0) {
            await tx.productImage.createMany({
              data: data.imageUrls.map((url, index) => ({
                productId: product.id,
                url,
                sortOrder: index,
                isPrimary: index === 0,
              })),
            })
          }
        }
        // Price history starts with the products (e-mail plan phase 6).
        await recordPriceChanges(tx, { productIds: createdProductIds, source: 'product_write' })
      },
      {
        isolationLevel: 'Serializable',
        maxWait: BULK_IMPORT_TRANSACTION_MAX_WAIT_MS,
        timeout: BULK_IMPORT_TRANSACTION_TIMEOUT_MS,
      },
    )
  } catch (error) {
    const message = isBarcodeConflict(error)
      ? 'Bu barkod başka bir ürün veya varyantta kullanılmıştır.'
      : 'İçe aktarma tamamlanamadı. Lütfen tekrar deneyin.'
    return NextResponse.json(
      {
        error: message,
        imported: 0,
        failed: importGroups.length,
        errors: [createBulkValidationError(0, 'row', 'commit_failed', message)],
      },
      { status: 409 },
    )
  }

  await Promise.all(
    publishedProductIds.map((id) =>
      enqueueProductSync({ operation: 'upsert', entityId: id }).catch((error) =>
        console.error('[bulk-product-import] Search sync enqueue failed:', error),
      ),
    ),
  )

  return NextResponse.json({ imported: importGroups.length, failed: 0, errors: [] })
}

export async function POST(req: NextRequest) {
  return handleBulkProducts(req, req.headers.get('x-hanuja-bulk-validate') === '1')
}
