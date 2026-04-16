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
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'

export interface SearchIndexSyncJobData {
  type: 'product' | 'category' | 'store'
  entityId?: string  // Sync single entity — undefined means full re-index
  operation: 'upsert' | 'delete'
}

async function processSearchIndexSync(job: Job<SearchIndexSyncJobData>) {
  const { type, entityId, operation } = job.data

  const meiliUrl = process.env.MEILISEARCH_URL ?? 'http://localhost:7700'
  const meiliKey = process.env.MEILISEARCH_MASTER_KEY ?? ''

  if (type === 'product') {
    if (operation === 'delete' && entityId) {
      await deleteFromIndex(meiliUrl, meiliKey, 'products', entityId)
      return
    }

    // Only index published products — security-critical
    const where = entityId
      ? { id: entityId, status: 'published' as const }
      : { status: 'published' as const }

    const products = await prisma.product.findMany({
      where,
      include: { images: { take: 1 }, category: true, seller: { include: { profile: true } } },
      take: 1000,
    })

    const documents = products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      price: p.price.toNumber(),
      categoryId: p.categoryId,
      categorySlug: p.category?.slug,
      categoryName: p.category?.name,
      sellerId: p.sellerId,
      storeSlug: p.seller?.slug,
      storeName: p.seller?.displayName ?? p.seller?.slug,
      imageUrl: p.images[0]?.url,
      stock: p.stockQuantity,
    }))

    if (documents.length > 0) {
      await upsertDocuments(meiliUrl, meiliKey, 'products', documents)
    }
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

// ── Convenience enqueue helper (used by catalog service) ───────────────────

/**
 * Enqueue a search index sync job for a single product or a full re-index.
 * Import this in catalog.service.ts — do NOT import the Worker class there.
 */
export async function enqueueProductSync(
  params:
    | { operation: 'upsert'; entityId: string }
    | { operation: 'delete'; entityId: string }
    | { operation: 'upsert'; entityId?: undefined }, // full re-index
) {
  const { searchIndexSyncQueue } = await import('../lib/queue')
  await searchIndexSyncQueue.add(
    `product-${params.operation}-${params.entityId ?? 'all'}`,
    { type: 'product', operation: params.operation, entityId: params.entityId },
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
