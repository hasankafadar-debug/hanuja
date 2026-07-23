import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createCatalogService } from '../catalog.service'
import { createMediaService } from '../media.service'
import { HipiconAdapter } from './adapters/hipicon.adapter'
import type { ImportAdapter, ScrapedProduct } from './adapters/import-adapter'
import { resolveImportCategory, type CategoryNode } from './category-resolver'
import { normalizeSlug, buildSlugWithSuffix } from '../../domain/slug'
import { requireModelCode } from '../../domain/model-code'
import { syncVariantBarcodeReservation } from '../../domain/barcode-registry'
import { generateUniqueProductBarcode } from '../../domain/barcode-generate'

const adapters: ImportAdapter[] = [new HipiconAdapter()]

type AttributeOption = {
  id: string
  type: 'color' | 'material'
  label: string
  slug: string
  sortOrder: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RejectedImportItem {
  externalId: string
  name: string
  reason: string
  categoryName?: string
}

export type CommitSelection =
  | {
      externalId: string
      categoryId: string
      colorOptionId: string
      materialOptionId: string
      barcode?: string | null
      modelCode: string
      fulfillmentDays: number
      stockQuantity: number
    }
  | {
      externalId: string
      autoCreateUnder: { parentId: string; leafName: string }
      colorOptionId: string
      materialOptionId: string
      barcode?: string | null
      modelCode: string
      fulfillmentDays: number
      stockQuantity: number
    }

function normalizeAttributeValue(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function collectAttributeCandidates(item: ScrapedProduct) {
  const candidates = [
    item.name,
    item.shortDescription,
    item.description,
    item.story,
    item.careInstructions,
    item.sku,
    ...((item.variants ?? []).map((variant) => variant.name)),
  ]

  return Array.from(
    new Set(
      candidates
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(normalizeAttributeValue),
    ),
  )
}

function getCategoryAttributeOptions(params: {
  categoryId: string
  type: 'color' | 'material'
  optionsByCategoryId: Map<string, AttributeOption[]>
  fallbackOptions: Record<'color' | 'material', AttributeOption[]>
}) {
  const categoryOptions = params.optionsByCategoryId.get(params.categoryId) ?? []
  const scopedOptions = categoryOptions.filter((option) => option.type === params.type)
  return scopedOptions.length > 0 ? scopedOptions : params.fallbackOptions[params.type]
}

function detectAttributeOption(params: {
  item: ScrapedProduct
  categoryId: string
  type: 'color' | 'material'
  optionsByCategoryId: Map<string, AttributeOption[]>
  fallbackOptions: Record<'color' | 'material', AttributeOption[]>
}) {
  const candidates = collectAttributeCandidates(params.item)
  if (candidates.length === 0) return null

  const matches = getCategoryAttributeOptions(params).filter((option) => {
    const label = normalizeAttributeValue(option.label)
    const slug = normalizeAttributeValue(option.slug)
    return candidates.some((candidate) => {
      const haystack = ` ${candidate} `
      return haystack.includes(` ${label} `) || haystack.includes(` ${slug} `)
    })
  })

  if (matches.length !== 1) return null
  return matches[0] ?? null
}

export function createProductImportService({ prisma }: { prisma: PrismaClient }) {
  function resolveAdapter(url: string) {
    const adapter = adapters.find((candidate) => candidate.supports(url))
    if (!adapter) {
      throw new Error('Desteklenmeyen platform. Simdilik yalnizca Hipicon magaza URLleri destekleniyor.')
    }
    return adapter
  }

  async function preview(url: string, _sellerNumber: number) {
    const adapter = resolveAdapter(url)
    const result = await adapter.fetchProducts(url)

    const [allCategories, allAttributeOptions, categoriesWithAttributes] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true, parentId: true, isActive: true },
      }),
      prisma.productAttributeOption.findMany({
        where: { isActive: true },
        select: { id: true, type: true, label: true, slug: true, sortOrder: true },
        orderBy: { label: 'asc' },
      }) as Promise<AttributeOption[]>,
      prisma.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          attributeOptions: {
            select: {
              option: {
                select: { id: true, type: true, label: true, slug: true, sortOrder: true },
              },
            },
          },
        },
      }) as Promise<Array<{ id: string; attributeOptions: Array<{ option: AttributeOption }> }>>,
    ])
    const activeCategories: CategoryNode[] = allCategories
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))
    const fallbackAttributeOptions = {
      color: allAttributeOptions.filter((option) => option.type === 'color'),
      material: allAttributeOptions.filter((option) => option.type === 'material'),
    }
    const attributeOptionsByCategoryId = new Map(
      categoriesWithAttributes.map((category) => [
        category.id,
        category.attributeOptions.map((item) => item.option),
      ]),
    )

    const filteredItems: ScrapedProduct[] = []
    const rejected: RejectedImportItem[] = []

    for (const item of result.items) {
      const path = item.categoryPath ?? []
      const decision = resolveImportCategory({ hipiconPath: path, categories: activeCategories })

      if (decision.kind === 'rejected') {
        rejected.push({
          externalId: item.externalId,
          name: item.name,
          reason: decision.reason,
          ...(item.suggestedCategoryName ? { categoryName: item.suggestedCategoryName } : {}),
        })
        continue
      }

      // Barcode is optional: only propose a scraped, full 13-digit barcode.
      // A blank proposal means the seller can leave it empty and the commit
      // will auto-generate an "8"-prefixed EAN-13.
      const scrapedDigits = item.barcode?.replace(/\D/g, '') ?? ''
      const proposedBarcode = scrapedDigits.length === 13 ? scrapedDigits : ''

      const detectedCategoryId =
        decision.kind === 'matched' ? decision.categoryId : decision.parentId
      const detectedColorOption = detectAttributeOption({
        item,
        categoryId: detectedCategoryId,
        type: 'color',
        optionsByCategoryId: attributeOptionsByCategoryId,
        fallbackOptions: fallbackAttributeOptions,
      })
      const detectedMaterialOption = detectAttributeOption({
        item,
        categoryId: detectedCategoryId,
        type: 'material',
        optionsByCategoryId: attributeOptionsByCategoryId,
        fallbackOptions: fallbackAttributeOptions,
      })

      const enriched: ScrapedProduct = {
        ...item,
        proposedBarcode,
        ...(detectedColorOption ? { detectedColorOptionId: detectedColorOption.id } : {}),
        ...(detectedMaterialOption ? { detectedMaterialOptionId: detectedMaterialOption.id } : {}),
        ...(decision.kind === 'matched' ? { resolvedCategoryId: decision.categoryId } as unknown as object : {}),
        ...(decision.kind === 'auto_create_leaf'
          ? { resolvedCategoryProposal: decision } as unknown as object
          : {}),
      }

      filteredItems.push(enriched)
    }

    return {
      adapter: adapter.name,
      items: filteredItems,
      rejected,
      fetchedCount: filteredItems.length,
      totalCount: result.totalCount,
      isPartial: result.isPartial,
      ...(result.warning ? { warning: result.warning } : {}),
    }
  }

  async function commit(params: {
    sellerId: string
    sellerNumber: number
    ownerId: string
    items: ScrapedProduct[]
    selections: CommitSelection[]
  }) {
    const selectionMap = new Map(params.selections.map((selection) => [selection.externalId, selection]))
    const selectedItems = params.items.flatMap((item) => {
      const selection = selectionMap.get(item.externalId)
      return selection ? [{ item, selection }] : []
    })
    const usedBarcodes = new Set<string>()
    const [allAttributeOptions, categoriesWithAttributes] = await Promise.all([
      prisma.productAttributeOption.findMany({
        where: { isActive: true },
        select: { id: true, type: true, label: true, slug: true, sortOrder: true },
      }) as Promise<AttributeOption[]>,
      prisma.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          attributeOptions: {
            select: {
              option: {
                select: { id: true, type: true, label: true, slug: true, sortOrder: true },
              },
            },
          },
        },
      }) as Promise<Array<{ id: string; attributeOptions: Array<{ option: AttributeOption }> }>>,
    ])
    const fallbackAttributeOptions = {
      color: allAttributeOptions.filter((option) => option.type === 'color'),
      material: allAttributeOptions.filter((option) => option.type === 'material'),
    }
    const attributeOptionsByCategoryId = new Map(
      categoriesWithAttributes.map((category) => [
        category.id,
        category.attributeOptions.map((item) => item.option),
      ]),
    )
    const attributeOptionById = new Map(allAttributeOptions.map((option) => [option.id, option]))

    function validateAttributeSelection(params: {
      categoryId: string
      optionId: string
      type: 'color' | 'material'
    }) {
      const option = attributeOptionById.get(params.optionId)
      if (!option || option.type !== params.type) {
        throw new Error(`Gecersiz ${params.type === 'color' ? 'renk' : 'materyal'} secimi.`)
      }

      const validOptions = getCategoryAttributeOptions({
        categoryId: params.categoryId,
        type: params.type,
        optionsByCategoryId: attributeOptionsByCategoryId,
        fallbackOptions: fallbackAttributeOptions,
      })

      if (!validOptions.some((candidate) => candidate.id === params.optionId)) {
        throw new Error(`Secilen kategori icin gecersiz ${params.type === 'color' ? 'renk' : 'materyal'} secimi.`)
      }

      return option
    }

    async function isBarcodeAvailable(barcode: string) {
      if (usedBarcodes.has(barcode)) return false
      const existing = await prisma.barcodeRegistry.findUnique({
        where: { barcode },
        select: { barcode: true },
      })
      return !existing
    }

    async function allocateBarcode(raw: string | null | undefined) {
      // Keep a scraped/entered full 13-digit barcode when it is still free;
      // otherwise auto-generate an "8"-prefixed EAN-13.
      const digits = raw?.replace(/\D/g, '') ?? ''
      if (digits.length === 13 && (await isBarcodeAvailable(digits))) {
        usedBarcodes.add(digits)
        return digits
      }
      return generateUniqueProductBarcode(prisma, { used: usedBarcodes })
    }

    async function allocateBarcodeWithOverride(
      override: string | null | undefined,
      fallbackRaw: string | null | undefined,
    ) {
      if (override?.trim()) {
        // Caller provided an explicit barcode — no fallback allowed; fail loudly on conflict
        const available = await isBarcodeAvailable(override.trim())
        if (!available) {
          throw new Error(`Bu barkod zaten kullanımda: ${override.trim()}`)
        }
        usedBarcodes.add(override.trim())
        return override.trim()
      }
      return allocateBarcode(fallbackRaw)
    }

    // --- Resolve auto-create categories (deduplicated, one transaction) ---
    const autoCreateRequests = new Map<string, string>() // key: `${parentId}::${leafName}` => resolved categoryId
    for (const { selection } of selectedItems) {
      if ('autoCreateUnder' in selection) {
        const key = `${selection.autoCreateUnder.parentId}::${selection.autoCreateUnder.leafName}`
        autoCreateRequests.set(key, '') // placeholder
      }
    }

    if (autoCreateRequests.size > 0) {
      for (const key of autoCreateRequests.keys()) {
        const [parentId, leafName] = key.split('::')
        if (!parentId || !leafName) continue

        // Check if it already exists (idempotent)
        const existing = await prisma.category.findFirst({
          where: { parentId, name: leafName },
          select: { id: true },
        })

        if (existing) {
          autoCreateRequests.set(key, existing.id)
          continue
        }

        const parent = await prisma.category.findUnique({
          where: { id: parentId },
          select: { slug: true, isActive: true },
        })

        if (!parent?.isActive) {
          throw new Error(`Kategori oluşturulamadı: üst kategori aktif değil (${parentId})`)
        }

        const baseSlug = normalizeSlug(`${parent.slug}-${leafName}`)
        const existingSlugs = await prisma.category.findMany({
          where: { slug: { startsWith: baseSlug } },
          select: { slug: true },
        })
        const existingSlugSet = new Set(existingSlugs.map((c) => c.slug))
        let suffix = 1
        let slug = buildSlugWithSuffix(baseSlug, suffix)
        while (existingSlugSet.has(slug)) {
          suffix += 1
          slug = buildSlugWithSuffix(baseSlug, suffix)
        }

        const created = await prisma.category.create({
          data: {
            name: leafName,
            slug,
            parentId,
            isActive: true,
            createdViaImportBy: params.sellerId,
            createdViaImportAt: new Date(),
          },
          select: { id: true },
        })
        autoCreateRequests.set(key, created.id)
      }
    }

    function resolveCategoryId(selection: CommitSelection): string {
      if ('categoryId' in selection) return selection.categoryId
      const key = `${selection.autoCreateUnder.parentId}::${selection.autoCreateUnder.leafName}`
      const id = autoCreateRequests.get(key)
      if (!id) throw new Error('Kategori çözümlenemedi: ' + key)
      return id
    }

    const imports: Array<{
      item: ScrapedProduct
      categoryId: string
      fulfillmentDays: number
      stockQuantity: number
      colorOptionId: string
      materialOptionId: string
      modelCode: string
      productBarcode: string | null
      variantBarcodes: string[]
    }> = []

    for (const { item, selection } of selectedItems) {
      const variants = item.variants ?? []
      const overrideBarcode = 'barcode' in selection ? selection.barcode?.trim() || null : null
      const categoryId = resolveCategoryId(selection)
      validateAttributeSelection({
        categoryId,
        optionId: selection.colorOptionId,
        type: 'color',
      })
      validateAttributeSelection({
        categoryId,
        optionId: selection.materialOptionId,
        type: 'material',
      })

      imports.push({
        item,
        categoryId,
        fulfillmentDays: selection.fulfillmentDays,
        stockQuantity: selection.stockQuantity,
        colorOptionId: selection.colorOptionId,
        materialOptionId: selection.materialOptionId,
        modelCode: requireModelCode(selection.modelCode),
        productBarcode:
          variants.length > 0
            ? null
            : await allocateBarcodeWithOverride(overrideBarcode, item.barcode),
        variantBarcodes:
          variants.length > 0
            ? await Promise.all(
                variants.map((variant) => allocateBarcode(variant.barcode ?? item.barcode)),
              )
            : [],
      })
    }

    const mediaService = createMediaService({ prisma })
    const created: Array<{ id: string; name: string; barcode: string | null }> = []

    for (const importItem of imports) {
      const { item } = importItem
      const product = await prisma.$transaction(async (tx) => {
        const catalog = createCatalogService({ prisma: tx as unknown as PrismaClient })
        const createdProduct = await catalog.createProduct({
          sellerId: params.sellerId,
          categoryId: importItem.categoryId,
          name: item.name,
          description: item.description ?? '',
          shortDescription: item.shortDescription ?? null,
          story: item.story ?? null,
          careInstructions: item.careInstructions ?? null,
          price: new Decimal(item.price),
          compareAtPrice: item.compareAtPrice ? new Decimal(item.compareAtPrice) : null,
          fulfillmentDays: importItem.fulfillmentDays,
          stockQuantity: importItem.stockQuantity,
          barcode: importItem.productBarcode,
          sku: item.sku ?? null,
          modelCode: importItem.modelCode,
        })

        await tx.productAttributeValue.createMany({
          data: [
            { productId: createdProduct.id, optionId: importItem.colorOptionId },
            { productId: createdProduct.id, optionId: importItem.materialOptionId },
          ],
          skipDuplicates: true,
        })

        if (item.variants && item.variants.length > 0) {
          for (const [index, variant] of item.variants.entries()) {
            const variantBarcode =
              importItem.variantBarcodes[index] ??
              (await generateUniqueProductBarcode(tx as unknown as PrismaClient))
            const createdVariant = await tx.productVariant.create({
              data: {
              productId: createdProduct.id,
              name: variant.name,
              options: {},
              barcode: variantBarcode,
              price: new Decimal(variant.price ?? item.price),
              stockQuantity: variant.stockQuantity ?? importItem.stockQuantity,
              },
            })
            await syncVariantBarcodeReservation(tx, createdVariant.id, createdVariant.barcode)
          }
        }

        return createdProduct
      })

      const mirroredImages: string[] = []
      for (const imageUrl of item.imageUrls.slice(0, 8)) {
        try {
          const asset = await mediaService.mirrorExternalImage({
            ownerId: params.ownerId,
            sourceUrl: imageUrl,
            folder: 'products',
            originalName: `${item.name}.jpg`,
          })
          mirroredImages.push(asset.url)
          await sleep(1000)
        } catch (error) {
          console.warn('[product-import] image mirror failed', { imageUrl, error })
        }
      }

      if (mirroredImages.length > 0) {
        await prisma.productImage.createMany({
          data: mirroredImages.map((url, index) => ({
            productId: product.id,
            url,
            sortOrder: index,
            isPrimary: index === 0,
          })),
        })
      }

      created.push({ id: product.id, name: product.name, barcode: importItem.productBarcode })
    }

    return created
  }

  return { resolveAdapter, preview, commit }
}
