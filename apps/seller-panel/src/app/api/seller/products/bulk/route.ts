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
import { createCatalogService } from '@hanuja/api/services/catalog.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function variantName(row: BulkProductImportRow) {
  const parts: string[] = []
  if (row.variantColor) parts.push(`Renk: ${row.variantColor}`)
  if (row.variantSize) parts.push(`Beden: ${row.variantSize}`)
  if (row.variantCustomOptionName && row.variantCustomOptionValue) {
    parts.push(`${row.variantCustomOptionName}: ${row.variantCustomOptionValue}`)
  }
  return parts.join(' / ') || row.barcode
}

function variantOptions(row: BulkProductImportRow) {
  const options: Record<string, string> = {}
  if (row.variantColor) options.Renk = row.variantColor
  if (row.variantSize) options.Beden = row.variantSize
  if (row.variantCustomOptionName && row.variantCustomOptionValue) {
    options[row.variantCustomOptionName] = row.variantCustomOptionValue
  }
  return options
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

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })
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
    row.errors.map((message) => ({ rowNumber: row.rowNumber, message })),
  )

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: 'Bazi satirlar gecersiz.', errors: validationErrors },
      { status: 400 },
    )
  }

  const validEntries: Array<{ rowNumber: number; data: BulkProductImportRow }> = normalizedRows.flatMap((row) =>
    row.data ? [{ rowNumber: row.rowNumber, data: row.data }] : [],
  )

  const allCategories = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, parentId: true },
  })
  const categoryMap = new Map(allCategories.map((category) => [category.slug, category.id]))
  const realCategorySlugs = new Set(allCategories.map((category) => category.slug))
  const referenceRows = buildBulkCategoryReferenceRows(allCategories)

  let allowedCategorySlugs: Set<string> | null = null
  if (rootCategorySlug && scopeCategorySlug) {
    const scopeRow = findBulkCategoryReferenceRowBySlug(referenceRows, scopeCategorySlug)
    const matchesRoot =
      scopeRow &&
      normalizeRootCategoryValue(scopeRow.rootSlug) === normalizeRootCategoryValue(rootCategorySlug)

    if (!matchesRoot) {
      return NextResponse.json(
        { error: 'Secilen Ev/Ofis ve kategori eslesmesi bulunamadi.' },
        { status: 400 },
      )
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
      filterBulkCategoryReferenceRows(referenceRows, templateCategoryKey).map((row) => row.realSlug),
    )
  } else if (parentCategorySlug) {
    allowedCategorySlugs = collectAllowedLegacyCategorySlugs(allCategories, parentCategorySlug)
  }

  if (rootCategorySlug && scopeCategorySlug && (!allowedCategorySlugs || allowedCategorySlugs.size === 0)) {
    return NextResponse.json(
      { error: 'Secilen kategori kapsaminda ice aktarilabilir satir bulunamadi.' },
      { status: 400 },
    )
  }

  const resolutionErrors: Array<{ rowNumber: number; message: string }> = []
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

      resolutionErrors.push({ rowNumber: entry.rowNumber, message })
      return []
    }

    return [{ rowNumber: entry.rowNumber, data: { ...entry.data, categorySlug: resolvedCategorySlug } }]
  })

  if (resolutionErrors.length > 0) {
    return NextResponse.json(
      { error: 'Bazi satirlar kategori olarak eslestirilemedi.', errors: resolutionErrors },
      { status: 400 },
    )
  }

  const validRows = resolvedEntries.map((entry) => entry.data)

  const duplicateErrors: Array<{ rowNumber: number; message: string }> = []
  const seenBarcodes = new Set<string>()
  for (const entry of resolvedEntries) {
    if (seenBarcodes.has(entry.data.barcode)) {
      duplicateErrors.push({ rowNumber: entry.rowNumber, message: `Ayni barkod tekrar ediyor: ${entry.data.barcode}` })
    }
    seenBarcodes.add(entry.data.barcode)
  }

  const grouped = new Map<string, Array<{ rowNumber: number; data: BulkProductImportRow }>>()
  for (const entry of resolvedEntries) {
    const key = entry.data.hasVariant ? buildBulkProductGroupKey(entry.data) : `row:${entry.rowNumber}`
    const group = grouped.get(key) ?? []
    group.push(entry)
    grouped.set(key, group)
  }

  if (duplicateErrors.length > 0) {
    return NextResponse.json(
      { error: 'Dosya icinde yinelenen barkod bulundu.', errors: duplicateErrors },
      { status: 400 },
    )
  }

  const productBarcodesToCreate = validRows.filter((row) => !row.hasVariant).map((row) => row.barcode)
  const allBarcodes = validRows.map((row) => row.barcode)

  const [existingProductBarcodes, existingVariantBarcodes] = await Promise.all([
    prisma.product.findMany({
      where: { barcode: { in: allBarcodes } },
      select: { barcode: true },
    }),
    prisma.productVariant.findMany({
      where: { barcode: { in: allBarcodes } },
      select: { barcode: true },
    }),
  ])

  const existingProductBarcodeSet = new Set(existingProductBarcodes.map((item) => item.barcode).filter(Boolean) as string[])
  const existingVariantBarcodeSet = new Set(existingVariantBarcodes.map((item) => item.barcode))

  const errors: Array<{ rowNumber: number; message: string }> = []
  let imported = 0

  for (const group of grouped.values()) {
    const first = group[0]
    if (!first) continue
    const data = first.data
    const usesVariants = group.length > 1 || group.some((entry) => entry.data.hasVariant)

    if (allowedCategorySlugs && !allowedCategorySlugs.has(data.categorySlug)) {
      errors.push({ rowNumber: first.rowNumber, message: `Bu kategori secilen sablon kapsaminda degil: ${data.categorySlug}` })
      continue
    }

    const categoryId = categoryMap.get(data.categorySlug)
    if (!categoryId) {
      errors.push({ rowNumber: first.rowNumber, message: `Kategori bulunamadi: ${data.categorySlug}` })
      continue
    }

    const groupBarcodes = group.map((entry) => entry.data.barcode)
    const conflictingBarcode = groupBarcodes.find(
      (barcode) =>
        existingProductBarcodeSet.has(barcode) ||
        existingVariantBarcodeSet.has(barcode) ||
        (!usesVariants && !productBarcodesToCreate.includes(barcode)),
    )
    if (conflictingBarcode) {
      errors.push({ rowNumber: first.rowNumber, message: `Barkod zaten kullaniliyor: ${conflictingBarcode}` })
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        const catalogService = createCatalogService({ prisma: tx as unknown as PrismaClient })
        const product = await catalogService.createProduct({
          sellerId: seller.id,
          categoryId,
          name: data.name,
          description: data.description ?? '',
          shortDescription: data.shortDescription ?? null,
          story: data.story ?? null,
          careInstructions: data.careInstructions ?? null,
          price: new Decimal(data.price),
          compareAtPrice: data.compareAtPrice !== undefined ? new Decimal(data.compareAtPrice) : null,
          stockQuantity: usesVariants
            ? group.reduce((sum, entry) => sum + entry.data.stockQuantity, 0)
            : data.stockQuantity,
          sku: data.sku ?? null,
          barcode: usesVariants ? null : data.barcode,
          weight: data.weight !== undefined ? new Decimal(data.weight) : null,
        })

        if (usesVariants) {
          await tx.productVariant.createMany({
            data: group.map((entry) => ({
              productId: product.id,
              name: variantName(entry.data),
              options: variantOptions(entry.data),
              barcode: entry.data.barcode,
              price: new Decimal(entry.data.price),
              stockQuantity: entry.data.stockQuantity,
            })),
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
      })

      imported += 1
      for (const barcode of groupBarcodes) {
        if (usesVariants) existingVariantBarcodeSet.add(barcode)
        else existingProductBarcodeSet.add(barcode)
      }
    } catch (error) {
      errors.push({
        rowNumber: first.rowNumber,
        message: error instanceof Error ? error.message : 'Satir ice aktarilamadi.',
      })
    }
  }

  return NextResponse.json({ imported, failed: errors.length, errors })
}
