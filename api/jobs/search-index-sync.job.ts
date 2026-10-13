/**
 * Search Index Sync Job — syncs published products to Meilisearch.
 *
 * IMPORTANT: Meilisearch is a read projection only.
 * PostgreSQL remains the source of truth.
 * Unpublished or non-public products must NOT be indexed.
 *
 * See: architecture rules — search must not be source of truth.
 */
import type { Prisma } from '@prisma/client'
import { Worker, Job } from 'bullmq'
import {
  PRODUCT_SEARCH_INDEX,
  PRODUCT_SEARCH_SETTINGS,
  mapProductToSearchHit,
} from '../domain/search'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { getMeilisearchConfig, waitForMeilisearchTask, ensureIndex } from '../lib/meilisearch'
import { loadCategorySchemas } from '../services/category-schema.service'
import { filterValuesForProduct } from '../domain/property-filters'
import { propertyLabel, type ProductProperties } from '../domain/category-schema'
import { prisma } from '../lib/prisma'
import { buildPublicProductWhere } from '../domain/product-visibility'

export interface SearchIndexSyncJobData {
  type: 'product' | 'category' | 'store' | 'dirty'
  entityId?: string
  operation: 'upsert' | 'delete'
}

const SEARCH_SYNC_BATCH_SIZE = 250

type PublishedProductScope = {
  productId?: string
  categoryId?: string
  sellerId?: string
}

async function listPublishedProductDocuments(
  scope: PublishedProductScope,
  db: Prisma.TransactionClient = prisma,
) {
  const schemas = await loadCategorySchemas(db)
  const categories = await db.category.findMany({
    select: { id: true, name: true, slug: true, parentId: true },
  })
  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const documents: ReturnType<typeof mapProductToSearchHit>[] = []
  let cursor: string | undefined

  while (true) {
    const products = await db.product.findMany({
      where: buildPublicProductWhere({
        ...(scope.productId ? { id: scope.productId } : {}),
        ...(scope.categoryId ? { categoryId: scope.categoryId } : {}),
        ...(scope.sellerId ? { sellerId: scope.sellerId } : {}),
      }),
      include: {
        images: {
          take: 4,
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
        category: { select: { slug: true, name: true } },
        variants: true,
        attributeValues: { include: { option: true } },
        seller: { select: { slug: true, displayName: true } },
      },
      orderBy: { id: 'asc' },
      take: SEARCH_SYNC_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    if (products.length === 0) break

    for (const product of products) {
      const schema = product.categoryId ? schemas.get(product.categoryId) : null
      const path: Array<{ slug: string; name: string }> = []
      let category = product.categoryId ? categoryMap.get(product.categoryId) : undefined
      const seen = new Set<string>()
      while (category && !seen.has(category.id)) {
        seen.add(category.id)
        path.unshift(category)
        category = category.parentId ? categoryMap.get(category.parentId) : undefined
      }
      const values = schema ? filterValuesForProduct(product, schema) : {}
      const text = schema
        ? schema.definitions
            .map((d) =>
              propertyLabel(d, ((product.properties ?? {}) as ProductProperties)[d.key] ?? null),
            )
            .filter(Boolean)
        : []
      if (values.cinsiyet?.includes('unisex')) text.push('Kadın', 'Erkek', 'Kız')
      if (
        values.cinsiyet?.includes('kadin') &&
        values.yas_grubu?.some((v) => ['cocuk', 'bebek'].includes(String(v)))
      )
        text.push('Kız')
      documents.push(
        mapProductToSearchHit({
          ...product,
          filterProperties: values,
          stockVariantKeys: schema
            ? schema.config.variantKey === 'net_icerik'
              ? schema.config.contentKeys
              : schema.config.variantKey &&
                  schema.definitions.find((d) => d.key === schema.config.variantKey)?.kind !==
                    'text'
                ? [schema.config.variantKey]
                : []
            : [],
          categoryPathSlugs: path.map((c) => c.slug),
          categoryPathLabels: path.map((c) => c.name),
          propertySearchText: text,
        }),
      )
    }
    cursor = products[products.length - 1]?.id

    if (scope.productId) break
  }

  return documents
}

async function syncProductDocuments(
  meiliUrl: string,
  meiliKey: string,
  params: { entityId?: string; operation: 'upsert' | 'delete' },
  db: Prisma.TransactionClient = prisma,
) {
  const { entityId, operation } = params

  if (operation === 'delete' && entityId) {
    await deleteFromIndex(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, entityId)
    return
  }

  const documents = await listPublishedProductDocuments(
    {
      ...(entityId ? { productId: entityId } : {}),
    },
    db,
  )

  if (documents.length > 0) {
    await upsertDocuments(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, documents)
    return
  }

  if (entityId) {
    await deleteFromIndex(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, entityId)
  }
}

export async function processSearchIndexSync(job: Job<SearchIndexSyncJobData>) {
  const { type, entityId } = job.data

  const { baseUrl: meiliUrl, apiKey: meiliKey } = getMeilisearchConfig()
  await ensureDynamicSearchSettings(meiliUrl, meiliKey)
  if (type === 'dirty') {
    const dirty = await prisma.searchIndexDirtyProduct.findMany({
      orderBy: { updatedAt: 'asc' },
      take: 100,
    })
    for (const row of dirty) await syncDurableProduct(meiliUrl, meiliKey, row.productId)
    return
  }
  if (type === 'product' && entityId) {
    await syncDurableProduct(meiliUrl, meiliKey, entityId)
    return
  }
  if (type === 'product' && !entityId) {
    await rebuildProductSearchIndex(meiliUrl, meiliKey)
    return
  }
  if (type === 'category' || type === 'store') {
    const products = await prisma.product.findMany({
      where: type === 'store' && entityId ? { sellerId: entityId } : {},
      select: { id: true },
    })
    for (const product of products) await syncDurableProduct(meiliUrl, meiliKey, product.id)
    return
  }
}

async function upsertDocuments(
  baseUrl: string,
  apiKey: string,
  index: string,
  documents: object[],
) {
  const res = await fetch(`${baseUrl}/indexes/${index}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(documents),
  })

  if (!res.ok) {
    throw new Error(`Meilisearch upsert failed: ${res.status} ${await res.text()}`)
  }
  const task = (await res.json()) as { taskUid: number }
  await waitForMeilisearchTask(baseUrl, apiKey, task.taskUid)
}

async function deleteFromIndex(baseUrl: string, apiKey: string, index: string, id: string) {
  const res = await fetch(`${baseUrl}/indexes/${index}/documents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok && res.status !== 404) {
    throw new Error(`Meilisearch delete failed: ${res.status}`)
  }
  if (res.ok) {
    const task = (await res.json()) as { taskUid: number }
    await waitForMeilisearchTask(baseUrl, apiKey, task.taskUid)
  }
}

// ── Convenience enqueue helper (used by catalog service) ───────────────────

/**
 * Enqueue a search index sync job for a single product or a full re-index.
 * Import this in catalog.service.ts — do NOT import the Worker class there.
 */
export async function enqueueProductSync(
  params:
    | { operation: 'upsert'; entityId: string }
    | { operation: 'delete'; entityId: string }
    | { operation: 'upsert'; entityId?: undefined },
) {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `product-${params.operation}-${params.entityId ?? 'all'}`,
    { type: 'product', operation: params.operation, entityId: params.entityId },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  )
}

/** Post-commit wake-up; database dirty revisions remain the durable backstop. */
export async function enqueueDirtyProductSync() {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    'product-dirty',
    { type: 'dirty', operation: 'upsert' },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 10,
      removeOnFail: 20,
    },
  )
}

export async function enqueueCategorySync(params: { entityId: string }) {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `category-upsert-${params.entityId}`,
    { type: 'category', operation: 'upsert', entityId: params.entityId },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  )
}

export async function enqueueStoreSync(params: {
  entityId: string
  operation?: 'upsert' | 'delete'
}) {
  const operation = params.operation ?? 'upsert'
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `store-${operation}-${params.entityId}`,
    { type: 'store', operation, entityId: params.entityId },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  )
}

export function startSearchIndexSyncWorker() {
  const worker = new Worker<SearchIndexSyncJobData>(
    QUEUE_NAMES.SEARCH_INDEX_SYNC,
    processSearchIndexSync,
    { connection: redis, concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[search-index-sync] Job ${job?.id} failed:`, err)
  })

  return worker
}

let settingsFingerprint = ''
export async function ensureDynamicSearchSettings(
  baseUrl: string,
  apiKey: string,
  index = PRODUCT_SEARCH_INDEX,
  force = false,
  db: Prisma.TransactionClient = prisma,
) {
  const fields = await db.catalogField.findMany({
    where: { isActive: true },
    select: { key: true, updatedAt: true },
  })
  const fingerprint = JSON.stringify(fields)
  if (index === PRODUCT_SEARCH_INDEX && !force && fingerprint === settingsFingerprint) return
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  await ensureIndex(index, 'id', { baseUrl, apiKey })
  const response = await fetch(`${baseUrl}/indexes/${index}/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      ...PRODUCT_SEARCH_SETTINGS,
      searchableAttributes: [
        ...PRODUCT_SEARCH_SETTINGS.searchableAttributes,
        'categoryPathLabels',
        'propertySearchText',
      ],
      filterableAttributes: [
        ...PRODUCT_SEARCH_SETTINGS.filterableAttributes,
        'categoryPathSlugs',
        'properties.color',
        'properties.material',
        ...fields.flatMap((f) => [`properties.${f.key}`, `${f.key}_stokta`]),
      ],
      faceting: { maxValuesPerFacet: 1000 },
    }),
  })
  if (!response.ok) throw new Error(`Meilisearch settings failed: ${response.status}`)
  const task = (await response.json()) as { taskUid: number }
  await waitForMeilisearchTask(baseUrl, apiKey, task.taskUid)
  if (index === PRODUCT_SEARCH_INDEX) settingsFingerprint = fingerprint
}

export async function syncDurableProduct(baseUrl: string, apiKey: string, productId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(82910213)`
      const [lock] = await tx.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtext(${productId})::bigint) AS acquired`
      if (!lock?.acquired) return
      const dirty = await tx.searchIndexDirtyProduct.findUnique({
        where: { productId },
      })
      await syncProductDocuments(baseUrl, apiKey, { entityId: productId, operation: 'upsert' }, tx)
      if (dirty)
        await tx.searchIndexDirtyProduct.deleteMany({
          where: { productId, revision: dirty.revision },
        })
    },
    { timeout: 150_000, maxWait: 150_000 },
  )
}

export async function rebuildProductSearchIndex(baseUrl: string, apiKey: string) {
  await ensureDynamicSearchSettings(baseUrl, apiKey)
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(82910213)`
      const index = `products_build_${Date.now()}`,
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }
      try {
        await ensureDynamicSearchSettings(baseUrl, apiKey, index, false, tx)
        const documents = await listPublishedProductDocuments({}, tx)
        for (let offset = 0; offset < documents.length; offset += SEARCH_SYNC_BATCH_SIZE)
          await upsertDocuments(
            baseUrl,
            apiKey,
            index,
            documents.slice(offset, offset + SEARCH_SYNC_BATCH_SIZE),
          )
        const response = await fetch(`${baseUrl}/swap-indexes`, {
          method: 'POST',
          headers,
          body: JSON.stringify([{ indexes: [PRODUCT_SEARCH_INDEX, index] }]),
        })
        if (!response.ok) throw new Error(`Meilisearch index swap failed: ${response.status}`)
        const task = (await response.json()) as { taskUid: number }
        await waitForMeilisearchTask(baseUrl, apiKey, task.taskUid)
      } finally {
        await fetch(`${baseUrl}/indexes/${index}`, {
          method: 'DELETE',
          headers,
        }).catch(() => {})
      }
      // Dirty rows stay pending: edits during the build are replayed after the swap.
    },
    { timeout: 600_000, maxWait: 600_000 },
  )
}
