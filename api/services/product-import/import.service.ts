import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createCatalogService } from '../catalog.service'
import { createMediaService } from '../media.service'
import { generateImportBarcode } from './barcode'
import { HipiconAdapter } from './adapters/hipicon.adapter'
import type { ImportAdapter, ScrapedProduct } from './adapters/import-adapter'
import { resolveImportCategory, type CategoryNode } from './category-resolver'
import { normalizeSlug, buildSlugWithSuffix } from '../../domain/slug'

const adapters: ImportAdapter[] = [new HipiconAdapter()]
const MAX_BARCODE_ATTEMPTS = 50

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
  | { externalId: string; categoryId: string; barcode?: string | null; stockQuantity: number }
  | { externalId: string; autoCreateUnder: { parentId: string; leafName: string }; barcode?: string | null; stockQuantity: number }

export function createProductImportService({ prisma }: { prisma: PrismaClient }) {
  function resolveAdapter(url: string) {
    const adapter = adapters.find((candidate) => candidate.supports(url))
    if (!adapter) {
      throw new Error('Desteklenmeyen platform. Simdilik yalnizca Hipicon magaza URLleri destekleniyor.')
    }
    return adapter
  }

  async function preview(url: string, sellerNumber: number) {
    const adapter = resolveAdapter(url)
    const result = await adapter.fetchProducts(url)

    const allCategories = await prisma.category.findMany({
      select: { id: true, name: true, parentId: true, isActive: true },
    })
    const activeCategories: CategoryNode[] = allCategories
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))

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

      const proposedBarcode = generateImportBarcode({
        raw: item.barcode,
        sellerNumber,
        seed: `${sellerNumber}:${item.externalId}:product:${item.name}`,
        attempt: 0,
      })

      const enriched: ScrapedProduct = {
        ...item,
        proposedBarcode,
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

    async function isBarcodeAvailable(barcode: string) {
      if (usedBarcodes.has(barcode)) return false
      const [existingProduct, existingVariant] = await Promise.all([
        prisma.product.findFirst({ where: { barcode }, select: { id: true } }),
        prisma.productVariant.findFirst({ where: { barcode }, select: { id: true } }),
      ])
      return !existingProduct && !existingVariant
    }

    async function allocateBarcode(raw: string | null | undefined, seed: string) {
      for (let attempt = 0; attempt < MAX_BARCODE_ATTEMPTS; attempt += 1) {
        const barcode = generateImportBarcode({
          raw,
          sellerNumber: params.sellerNumber,
          seed,
          attempt,
        })
        if (await isBarcodeAvailable(barcode)) {
          usedBarcodes.add(barcode)
          return barcode
        }
      }

      throw new Error('Secilen urunler icin benzersiz barkod uretilemedi. Lutfen tekrar deneyin.')
    }

    async function allocateBarcodeWithOverride(
      override: string | null | undefined,
      fallbackRaw: string | null | undefined,
      seed: string,
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
      return allocateBarcode(fallbackRaw, seed)
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
      stockQuantity: number
      productBarcode: string | null
      variantBarcodes: string[]
    }> = []

    for (const { item, selection } of selectedItems) {
      const variants = item.variants ?? []
      const overrideBarcode = 'barcode' in selection ? selection.barcode?.trim() || null : null
      const productSeed = `${params.sellerId}:${item.externalId}:product:${item.name}`
      const categoryId = resolveCategoryId(selection)

      imports.push({
        item,
        categoryId,
        stockQuantity: selection.stockQuantity,
        productBarcode:
          variants.length > 0
            ? null
            : await allocateBarcodeWithOverride(overrideBarcode, item.barcode, productSeed),
        variantBarcodes:
          variants.length > 0
            ? await Promise.all(
                variants.map((variant, index) =>
                  allocateBarcode(
                    variant.barcode ?? item.barcode,
                    `${params.sellerId}:${item.externalId}:variant:${index}:${variant.name}`,
                  ),
                ),
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
          stockQuantity: importItem.stockQuantity,
          barcode: importItem.productBarcode,
          sku: item.sku ?? null,
        })

        if (item.variants && item.variants.length > 0) {
          await tx.productVariant.createMany({
            data: item.variants.map((variant, index) => ({
              productId: createdProduct.id,
              name: variant.name,
              options: {},
              barcode:
                importItem.variantBarcodes[index] ??
                generateImportBarcode({
                  sellerNumber: params.sellerNumber,
                  seed: `${params.sellerId}:${item.externalId}:variant:${index}:${variant.name}`,
                }),
              price: new Decimal(variant.price ?? item.price),
              stockQuantity: variant.stockQuantity ?? importItem.stockQuantity,
            })),
          })
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
