import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeText, stableHash } from './normalize'
import { assertSafeExternalUrl, fetchAndCacheImage, readVerifiedCache } from './image'
import type { CachedImage, CanonicalRow, ImportManifest, ManifestItem, NormalizedWorkbook } from './types'

const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000
type Audit = { mode: 'dry-run' | 'apply' | 'verify'; startedAt: string; finishedAt?: string; counts: Record<string, number>; errors: Array<{ sourceRow?: number; message: string }>; created?: Array<{ sourceRow: number; productId: string; mediaKeys: string[] }>; output?: string }

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function keyForPath(parts: string[]) { return parts.map(normalizeText).join(' / ') }
function attributeKey(value: string) { return normalizeText(value) === 'mix color' ? 'mix' : normalizeText(value) }
function auditPath(mode: Audit['mode'], outputDir: string) { return path.resolve(outputDir, `audit-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) }
async function writeAudit(audit: Audit, outputDir: string) { audit.finishedAt = new Date().toISOString(); const target = auditPath(audit.mode, outputDir); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, `${JSON.stringify(audit, null, 2)}\n`); return target }

export async function readNormalized(normalizedPath: string): Promise<NormalizedWorkbook> {
  return JSON.parse(await fs.readFile(normalizedPath, 'utf8')) as NormalizedWorkbook
}

function validateRow(row: CanonicalRow): string[] {
  const errors: string[] = []
  if (!row.modelCode?.trim()) errors.push('Model code is required.')
  if (!row.name || row.name.trim().length < 3) errors.push('Product name must be at least 3 characters.')
  if (!row.canonicalCategoryPath) errors.push(`Source category cannot be mapped: ${row.sourceCategory ?? '(blank)'}`)
  if (!Number.isFinite(row.price) || (row.price ?? 0) <= 0) errors.push('Price must be greater than zero.')
  if (!Number.isInteger(row.fulfillmentDays) || (row.fulfillmentDays ?? 0) < 1) errors.push('Fulfillment days must be a positive integer.')
  if (!Number.isInteger(row.stockQuantity) || (row.stockQuantity ?? -1) < 0) errors.push('Stock must be a non-negative integer.')
  if (row.compareAtPrice !== undefined && row.price !== undefined && row.compareAtPrice <= row.price) errors.push('Compare-at price must be greater than price.')
  if (row.color2 && !row.color1) errors.push('Secondary color requires a primary color.')
  if (row.color1 && row.color2 && attributeKey(row.color1) === attributeKey(row.color2)) errors.push('Secondary color cannot equal primary color.')
  return errors
}

async function loadRuntime() {
  const [{ default: prisma }, catalog, model] = await Promise.all([
    import('../../api/lib/prisma'), import('../../api/services/catalog.service'), import('../../api/domain/model-code'),
  ])
  return { prisma, createCatalogService: catalog.createCatalogService, normalizeModelCode: model.normalizeModelCode }
}

async function buildCategoryMap(prisma: any) {
  const categories = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, parentId: true } })
  const byId = new Map(categories.map((category: any) => [category.id, category]))
  const parents = new Set(categories.filter((category: any) => category.parentId).map((category: any) => category.parentId))
  const result = new Map<string, { id: string; isLeaf: boolean }>()
  for (const category of categories) {
    const parts: string[] = []
    let current: any = category
    while (current) { parts.unshift(current.name); current = current.parentId ? byId.get(current.parentId) : undefined }
    result.set(keyForPath(parts), { id: category.id, isLeaf: !parents.has(category.id) })
  }
  return result
}

async function resolveOptionId(prisma: any, categoryId: string, type: 'color' | 'material', label: string | undefined): Promise<string | undefined> {
  if (!label) return undefined
  const expected = attributeKey(label)
  const find = async (where: Record<string, unknown>) => {
    const candidates = await prisma.productAttributeOption.findMany({ where: { type, isActive: true, ...where }, select: { id: true, label: true } })
    return candidates.filter((candidate: { label: string }) => attributeKey(candidate.label) === expected)
  }
  const local = await find({ categories: { some: { categoryId } } })
  if (local.length === 1) return local[0]!.id
  if (local.length > 1) throw new Error(`${type} option is ambiguous in category: ${label}`)
  const global = await find({})
  if (global.length !== 1) throw new Error(`${type} option could not be uniquely resolved: ${label}`)
  return global[0]!.id
}

async function cacheImages(row: CanonicalRow, cacheDir: string, audit: Audit): Promise<CachedImage[]> {
  const images: CachedImage[] = []
  for (const sourceUrl of row.imageUrls) {
    audit.counts.imageAttempted += 1
    try { images.push(await fetchAndCacheImage(sourceUrl, cacheDir)); audit.counts.imageCreatable += 1 }
    catch (error) { audit.counts.imageFailed += 1; audit.errors.push({ sourceRow: row.sourceRow, message: `${sourceUrl}: ${errorMessage(error)}` }) }
  }
  return images
}

export async function dryRun(params: { normalizedPath: string; sellerSlug: string; displayName?: string; outputDir?: string; cacheDir?: string }) {
  const outputDir = params.outputDir ?? '.tmp/catalog-import/audits'
  const cacheDir = params.cacheDir ?? '.tmp/catalog-import/cache'
  const audit: Audit = { mode: 'dry-run', startedAt: new Date().toISOString(), counts: { rowsRead: 0, creatable: 0, skippedExisting: 0, blocked: 0, imageAttempted: 0, imageCreatable: 0, imageFailed: 0 }, errors: [] }
  const normalized = await readNormalized(params.normalizedPath)
  if (normalized.mapping.blockingErrors.length) throw new Error(`Normalized workbook has blocking mapping errors: ${normalized.mapping.blockingErrors.join(' ')}`)
  audit.counts.rowsRead = normalized.rows.length
  const { prisma, normalizeModelCode } = await loadRuntime()
  try {
    const sellers = await prisma.seller.findMany({ where: { slug: params.sellerSlug, status: 'active', ...(params.displayName ? { displayName: params.displayName } : {}) }, select: { id: true, userId: true, slug: true, displayName: true } })
    if (sellers.length !== 1) throw new Error(`Expected exactly one active seller for ${params.sellerSlug}; found ${sellers.length}.`)
    const seller = sellers[0]!
    const categories = await buildCategoryMap(prisma)
    const categoryIds: Record<string, string> = {}
    const seen = new Set<string>()
    const items: ManifestItem[] = []
    for (const row of normalized.rows) {
      const rowErrors = validateRow(row)
      const category = row.canonicalCategoryPath ? categories.get(keyForPath(row.canonicalCategoryPath)) : undefined
      if (!category || !category.isLeaf) rowErrors.push(`Canonical active leaf category missing: ${row.canonicalCategoryPath?.join(' / ') ?? '(blank)'}`)
      const normalizedModelCode = row.modelCode ? normalizeModelCode(row.modelCode) : ''
      const duplicateKey = category ? `${category.id}:${normalizedModelCode}` : ''
      if (duplicateKey && seen.has(duplicateKey)) rowErrors.push(`Duplicate category/model code in source: ${normalizedModelCode}`)
      if (duplicateKey) seen.add(duplicateKey)
      if (rowErrors.length || !category || !row.canonicalCategoryPath) { audit.counts.blocked += 1; rowErrors.forEach((message) => audit.errors.push({ sourceRow: row.sourceRow, message })); continue }
      try {
        await Promise.all([resolveOptionId(prisma, category.id, 'color', row.color1), resolveOptionId(prisma, category.id, 'color', row.color2), resolveOptionId(prisma, category.id, 'material', row.material)])
      } catch (error) { audit.counts.blocked += 1; audit.errors.push({ sourceRow: row.sourceRow, message: errorMessage(error) }); continue }
      categoryIds[keyForPath(row.canonicalCategoryPath)] = category.id
      const existing = await prisma.product.findFirst({ where: { sellerId: seller.id, categoryId: category.id, modelCode: normalizedModelCode }, select: { id: true } })
      if (existing) { audit.counts.skippedExisting += 1; items.push({ sourceRow: row.sourceRow, normalizedModelCode, categoryPath: row.canonicalCategoryPath, action: 'skip-existing', row, images: [] }); continue }
      const images = await cacheImages(row, cacheDir, audit)
      audit.counts.creatable += 1
      items.push({ sourceRow: row.sourceRow, normalizedModelCode, categoryPath: row.canonicalCategoryPath, action: 'create', row, images })
    }
    const auditFile = await writeAudit(audit, outputDir)
    if (audit.counts.blocked) throw new Error(`Dry-run has ${audit.counts.blocked} blocking row(s). See ${auditFile}`)
    const manifest: ImportManifest = { schemaVersion: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + MANIFEST_TTL_MS).toISOString(), normalizedHash: stableHash({ sourceHash: normalized.sourceHash, rows: normalized.rows }), normalizedPath: path.resolve(params.normalizedPath), seller, categories: categoryIds, items, auditPath: auditFile }
    const manifestPath = path.resolve(outputDir, `manifest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return { manifestPath, auditPath: auditFile, counts: audit.counts }
  } finally { await prisma.$disconnect() }
}

async function loadManifest(manifestPath: string) { return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ImportManifest }
export function manifestGuardErrors(manifest: ImportManifest, params: { confirmStore: string; normalizedHash: string; now?: Date }): string[] {
  const now = params.now ?? new Date()
  const errors: string[] = []
  if (new Date(manifest.expiresAt).getTime() <= now.getTime()) errors.push('Manifest expired; run dry-run again.')
  if (manifest.seller.slug !== params.confirmStore) errors.push('The --confirm-store value does not match the manifest seller.')
  if (manifest.normalizedHash !== params.normalizedHash) errors.push('Normalized workbook hash changed; run dry-run again.')
  return errors
}
async function refreshImage(image: CachedImage, cacheDir: string) {
  try { return { body: await readVerifiedCache(image), image } }
  catch {
    const fresh = await fetchAndCacheImage(image.sourceUrl, cacheDir)
    if (fresh.sha256 !== image.sha256 || fresh.mimeType !== image.mimeType || fresh.sizeBytes !== image.sizeBytes) throw new Error('Cached image changed at source; run dry-run again.')
    return { body: await readVerifiedCache(fresh), image: fresh }
  }
}

export async function applyManifest(params: { manifestPath: string; confirmStore: string; outputDir?: string; cacheDir?: string }) {
  const outputDir = params.outputDir ?? '.tmp/catalog-import/audits'; const cacheDir = params.cacheDir ?? '.tmp/catalog-import/cache'
  const audit: Audit = { mode: 'apply', startedAt: new Date().toISOString(), counts: { created: 0, skippedExisting: 0, productFailed: 0, imageCreated: 0, imageFailed: 0 }, errors: [], created: [] }
  const manifest = await loadManifest(params.manifestPath)
  const normalized = await readNormalized(manifest.normalizedPath)
  const guards = manifestGuardErrors(manifest, { confirmStore: params.confirmStore, normalizedHash: stableHash({ sourceHash: normalized.sourceHash, rows: normalized.rows }) })
  if (guards.length) throw new Error(guards.join(' '))
  const runtime = await loadRuntime(); const { prisma } = runtime
  const { uploadObject, deleteObject } = await import('../../api/lib/r2')
  try {
    const seller = await prisma.seller.findUnique({ where: { id: manifest.seller.id }, select: { id: true, userId: true, slug: true, status: true } })
    if (!seller || seller.status !== 'active' || seller.slug !== manifest.seller.slug) throw new Error('Seller changed; run dry-run again.')
    const categoryMap = await buildCategoryMap(prisma)
    for (const item of manifest.items) {
      if (item.action === 'skip-existing') {
        const categoryId = manifest.categories[keyForPath(item.categoryPath)]
        const existing = categoryId && await prisma.product.findFirst({ where: { sellerId: seller.id, categoryId, modelCode: item.normalizedModelCode }, select: { id: true } })
        if (!existing) throw new Error(`Existing product changed for source row ${item.sourceRow}; run dry-run again.`)
        audit.counts.skippedExisting += 1; continue
      }
      const categoryId = manifest.categories[keyForPath(item.categoryPath)]
      const category = categoryId && categoryMap.get(keyForPath(item.categoryPath))
      if (!category || category.id !== categoryId || !category.isLeaf) { audit.counts.productFailed += 1; audit.errors.push({ sourceRow: item.sourceRow, message: 'Category path changed; run dry-run again.' }); continue }
      const existing = await prisma.product.findFirst({ where: { sellerId: seller.id, categoryId, modelCode: item.normalizedModelCode }, select: { id: true } })
      if (existing) { audit.counts.skippedExisting += 1; continue }
      try {
        const [color1, color2, material] = await Promise.all([resolveOptionId(prisma, categoryId, 'color', item.row.color1), resolveOptionId(prisma, categoryId, 'color', item.row.color2), resolveOptionId(prisma, categoryId, 'material', item.row.material)])
        const product = await prisma.$transaction(async (tx: any) => {
          const catalog = runtime.createCatalogService({ prisma: tx })
          const created = await catalog.createProduct({ sellerId: seller.id, categoryId, name: item.row.name!, description: item.row.description ?? '', shortDescription: item.row.shortDescription ?? null, story: item.row.story ?? null, careInstructions: item.row.careInstructions ?? null, price: new (await import('@prisma/client/runtime/client')).Decimal(item.row.price!), compareAtPrice: item.row.compareAtPrice === undefined ? null : new (await import('@prisma/client/runtime/client')).Decimal(item.row.compareAtPrice), fulfillmentDays: item.row.fulfillmentDays!, stockQuantity: item.row.stockQuantity!, sku: item.row.sku ?? null, modelCode: item.normalizedModelCode, barcode: item.row.barcode ?? null, autoGenerateBarcodeWhenMissing: true, weight: item.row.weight === undefined ? null : new (await import('@prisma/client/runtime/client')).Decimal(item.row.weight), dimensionWidth: item.row.dimensionWidth === undefined ? null : new (await import('@prisma/client/runtime/client')).Decimal(item.row.dimensionWidth), dimensionLength: item.row.dimensionLength === undefined ? null : new (await import('@prisma/client/runtime/client')).Decimal(item.row.dimensionLength), dimensionHeight: item.row.dimensionHeight === undefined ? null : new (await import('@prisma/client/runtime/client')).Decimal(item.row.dimensionHeight) })
          const attributes = [...(color1 ? [{ productId: created.id, optionId: color1, sortOrder: 0 }] : []), ...(color2 ? [{ productId: created.id, optionId: color2, sortOrder: 1 }] : []), ...(material ? [{ productId: created.id, optionId: material, sortOrder: 0 }] : [])]
          if (attributes.length) await tx.productAttributeValue.createMany({ data: attributes })
          return created
        })
        audit.counts.created += 1
        const mediaKeys: string[] = []
        for (const image of item.images) {
          let uploaded: { key: string; publicUrl: string } | undefined; let assetId: string | undefined
          try {
            const cached = await refreshImage(image, cacheDir); uploaded = await uploadObject({ folder: 'products', ownerId: seller.userId, mimeType: cached.image.mimeType, body: cached.body })
            const asset = await prisma.mediaAsset.create({ data: { type: 'product_image', url: uploaded.publicUrl, key: uploaded.key, folder: 'products', status: 'ready', originalName: `${item.normalizedModelCode}-${audit.counts.imageCreated + 1}`, mimeType: cached.image.mimeType, sizeBytes: cached.image.sizeBytes, uploadedBy: seller.userId } }); assetId = asset.id
            const count = await prisma.productImage.count({ where: { productId: product.id } }); await prisma.productImage.create({ data: { productId: product.id, url: asset.url, sortOrder: count, isPrimary: count === 0 } }); audit.counts.imageCreated += 1; mediaKeys.push(uploaded.key)
          } catch (error) {
            if (assetId) await prisma.mediaAsset.delete({ where: { id: assetId } }).catch(() => undefined)
            if (uploaded) await deleteObject(uploaded.key).catch(() => undefined)
            audit.counts.imageFailed += 1; audit.errors.push({ sourceRow: item.sourceRow, message: `${image.sourceUrl}: ${errorMessage(error)}` })
          }
        }
        audit.created!.push({ sourceRow: item.sourceRow, productId: product.id, mediaKeys })
      } catch (error) { audit.counts.productFailed += 1; audit.errors.push({ sourceRow: item.sourceRow, message: errorMessage(error) }) }
    }
  } finally { audit.output = await writeAudit(audit, outputDir); await prisma.$disconnect() }
  return { auditPath: audit.output!, counts: audit.counts }
}

export async function verifyManifest(params: { manifestPath: string; outputDir?: string }) {
  const outputDir = params.outputDir ?? '.tmp/catalog-import/audits'; const audit: Audit = { mode: 'verify', startedAt: new Date().toISOString(), counts: { productsVerified: 0, mediaVerified: 0, failures: 0 }, errors: [] }; const manifest = await loadManifest(params.manifestPath)
  const { prisma } = await loadRuntime(); const { objectExists } = await import('../../api/lib/r2')
  try {
    const productRows = manifest.items.filter((item) => item.action === 'create')
    let cdnSamplesRemaining = 3
    for (const item of productRows) {
      const categoryId = manifest.categories[keyForPath(item.categoryPath)]; const product = await prisma.product.findFirst({ where: { sellerId: manifest.seller.id, categoryId, modelCode: item.normalizedModelCode }, include: { images: true } })
      if (!product) { audit.counts.failures += 1; audit.errors.push({ sourceRow: item.sourceRow, message: 'Product not found.' }); continue }
      audit.counts.productsVerified += 1
      for (const image of product.images) {
        const asset = await prisma.mediaAsset.findFirst({ where: { url: image.url, uploadedBy: manifest.seller.userId }, select: { key: true } })
        if (!asset?.key || !(await objectExists(asset.key))) { audit.counts.failures += 1; audit.errors.push({ sourceRow: item.sourceRow, message: `R2 object missing for ${image.url}` }) } else {
          audit.counts.mediaVerified += 1
          if (cdnSamplesRemaining > 0) {
            cdnSamplesRemaining -= 1
            try { const url = await assertSafeExternalUrl(image.url); const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`) }
            catch (error) { audit.counts.failures += 1; audit.errors.push({ sourceRow: item.sourceRow, message: `CDN sample failed: ${errorMessage(error)}` }) }
          }
        }
      }
    }
  } finally { audit.output = await writeAudit(audit, outputDir); await prisma.$disconnect() }
  return { auditPath: audit.output!, counts: audit.counts }
}
