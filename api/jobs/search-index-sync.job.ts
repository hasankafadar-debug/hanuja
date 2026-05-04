/**
 * Search Index Sync Job — syncs published products to Meilisearch.
 *
 * IMPORTANT: Meilisearch is a read projection only.
 * PostgreSQL remains the source of truth.
 * Unpublished or non-public products must NOT be indexed.
 *
 * See: architecture rules — search must not be source of truth.
 */
import { Worker, Job } from 'bullmq'
import { PRODUCT_SEARCH_INDEX, mapProductToSearchHit } from '../domain/search'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { getMeilisearchConfig } from '../lib/meilisearch'
import { prisma } from '../lib/prisma'

export interface SearchIndexSyncJobData {
  type: 'product' | 'category' | 'store'
  entityId?: string
  operation: 'upsert' | 'delete'
}

const SEARCH_SYNC_BATCH_SIZE = 250

type PublishedProductScope = {
  productId?: string
  categoryId?: string
  sellerId?: string
}

async function listPublishedProductDocuments(scope: PublishedProductScope) {
  const documents: ReturnType<typeof mapProductToSearchHit>[] = []
  let cursor: string | undefined

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        status: 'published',
        ...(scope.productId ? { id: scope.productId } : {}),
        ...(scope.categoryId ? { categoryId: scope.categoryId } : {}),
        ...(scope.sellerId ? { sellerId: scope.sellerId } : {}),
      },
      include: {
        images: {
          take: 4,
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
        category: { select: { slug: true, name: true } },
        seller: { select: { slug: true, displayName: true } },
      },
      orderBy: { id: 'asc' },
      take: SEARCH_SYNC_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    if (products.length === 0) break

    documents.push(...products.map(mapProductToSearchHit))
    cursor = products[products.length - 1]?.id

    if (scope.productId) break
  }

  return documents
}

async function syncProductDocuments(
  meiliUrl: string,
  meiliKey: string,
  params: { entityId?: string; operation: 'upsert' | 'delete' },
) {
  const { entityId, operation } = params

  if (operation === 'delete' && entityId) {
    await deleteFromIndex(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, entityId)
    return
  }

  if (!entityId) {
    await clearIndex(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX)
  }

  const documents = await listPublishedProductDocuments({
    ...(entityId ? { productId: entityId } : {}),
  })

  if (documents.length > 0) {
    await upsertDocuments(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, documents)
    return
  }

  if (entityId) {
    await deleteFromIndex(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, entityId)
  }
}

async function syncScopedProductDocuments(
  meiliUrl: string,
  meiliKey: string,
  scope: PublishedProductScope,
) {
  const documents = await listPublishedProductDocuments(scope)
  if (documents.length === 0) return
  await upsertDocuments(meiliUrl, meiliKey, PRODUCT_SEARCH_INDEX, documents)
}

export async function processSearchIndexSync(job: Job<SearchIndexSyncJobData>) {
  const { type, entityId, operation } = job.data

  const { baseUrl: meiliUrl, apiKey: meiliKey } = getMeilisearchConfig()

  if (type === 'product') {
    await syncProductDocuments(meiliUrl, meiliKey, {
      operation,
      ...(entityId ? { entityId } : {}),
    })
  }

  if (type === 'category') {
    await syncScopedProductDocuments(meiliUrl, meiliKey, {
      ...(entityId ? { categoryId: entityId } : {}),
    })
  }

  if (type === 'store') {
    await syncScopedProductDocuments(meiliUrl, meiliKey, {
      ...(entityId ? { sellerId: entityId } : {}),
    })
  }

  console.log(
    `[search-index-sync] type=${type} operation=${operation} count=${entityId ? 1 : 'batch'}`,
  )
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
}

async function deleteFromIndex(
  baseUrl: string,
  apiKey: string,
  index: string,
  id: string,
) {
  const res = await fetch(`${baseUrl}/indexes/${index}/documents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok && res.status !== 404) {
    throw new Error(`Meilisearch delete failed: ${res.status}`)
  }
}

async function clearIndex(
  baseUrl: string,
  apiKey: string,
  index: string,
) {
  const res = await fetch(`${baseUrl}/indexes/${index}/documents`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    throw new Error(`Meilisearch clear failed: ${res.status}`)
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

export async function enqueueCategorySync(params: { entityId: string }) {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `category-upsert-${params.entityId}`,
    { type: 'category', operation: 'upsert', entityId: params.entityId },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  )
}

export async function enqueueStoreSync(params: { entityId: string }) {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `store-upsert-${params.entityId}`,
    { type: 'store', operation: 'upsert', entityId: params.entityId },
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
