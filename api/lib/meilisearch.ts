/**
 * Meilisearch client — fetch-based, no SDK dependency.
 *
 * Meilisearch is a READ PROJECTION only.
 * PostgreSQL is the source of truth for all business state.
 * Never trust Meilisearch for finance, order, or payout decisions.
 */

import { PRODUCT_SEARCH_INDEX, PRODUCT_SEARCH_SETTINGS } from '../domain/search'

export function getMeilisearchConfig() {
  const baseUrl =
    process.env.MEILISEARCH_URL ??
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('MEILISEARCH_URL is required in production')
        })()
      : 'http://localhost:7700')
  const apiKey = process.env.MEILISEARCH_ADMIN_KEY ?? ''

  return { baseUrl, apiKey }
}

export function buildMeilisearchHeaders(apiKey = getMeilisearchConfig().apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export interface SearchParams {
  q: string
  indexName: string
  filter?: string
  facets?: string[]
  sort?: string[]
  limit?: number
  offset?: number
  attributesToRetrieve?: string[]
}

export interface SearchResult<T = Record<string, unknown>> {
  hits: T[]
  totalHits: number
  limit: number
  offset: number
  facetDistribution?: Record<string, Record<string, number>>
  facetStats?: Record<string, { min: number; max: number }>
  processingTimeMs: number
}

export async function searchIndex<T = Record<string, unknown>>(
  params: SearchParams,
): Promise<SearchResult<T>> {
  const { baseUrl, apiKey } = getMeilisearchConfig()
  const {
    indexName,
    q,
    filter,
    facets,
    sort,
    limit = 20,
    offset = 0,
    attributesToRetrieve,
  } = params

  const body: Record<string, unknown> = {
    q,
    limit,
    offset,
  }
  if (filter) body.filter = filter
  if (facets) body.facets = facets
  if (sort) body.sort = sort
  if (attributesToRetrieve) body.attributesToRetrieve = attributesToRetrieve

  const res = await fetch(`${baseUrl}/indexes/${indexName}/search`, {
    method: 'POST',
    headers: buildMeilisearchHeaders(apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meilisearch search failed [${res.status}]: ${text}`)
  }

  const data = (await res.json()) as {
    hits?: T[]
    estimatedTotalHits?: number
    totalHits?: number
    limit?: number
    offset?: number
    facetDistribution?: Record<string, Record<string, number>>
    facetStats?: Record<string, { min: number; max: number }>
    processingTimeMs?: number
  }
  return {
    hits: data.hits ?? [],
    totalHits: data.estimatedTotalHits ?? data.totalHits ?? 0,
    limit: data.limit ?? limit,
    offset: data.offset ?? offset,
    ...(data.facetDistribution !== undefined ? { facetDistribution: data.facetDistribution } : {}),
    processingTimeMs: data.processingTimeMs ?? 0,
    ...(data.facetStats ? { facetStats: data.facetStats } : {}),
  }
}

export async function configureIndex(
  indexName: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const { baseUrl, apiKey } = getMeilisearchConfig()
  const res = await fetch(`${baseUrl}/indexes/${indexName}/settings`, {
    method: 'PATCH',
    headers: buildMeilisearchHeaders(apiKey),
    body: JSON.stringify(settings),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meilisearch configureIndex failed [${res.status}]: ${text}`)
  }
}

/**
 * Ensure index exists. Creates it if missing (idempotent).
 */
export async function ensureIndex(
  indexName: string,
  primaryKey = 'id',
  config = getMeilisearchConfig(),
): Promise<void> {
  const { baseUrl, apiKey } = config
  const existing = await fetch(`${baseUrl}/indexes/${indexName}`, {
    headers: buildMeilisearchHeaders(apiKey),
  })
  if (existing.ok) return
  if (existing.status !== 404)
    throw new Error(`Meilisearch index lookup failed: ${existing.status}`)
  const res = await fetch(`${baseUrl}/indexes`, {
    method: 'POST',
    headers: buildMeilisearchHeaders(apiKey),
    body: JSON.stringify({ uid: indexName, primaryKey }),
  })

  if (!res.ok && res.status !== 409) {
    const text = await res.text()
    throw new Error(`Meilisearch ensureIndex failed [${res.status}]: ${text}`)
  }
  if (res.ok) {
    const task = (await res.json()) as { taskUid: number }
    await waitForMeilisearchTask(baseUrl, apiKey, task.taskUid, ['index_already_exists'])
  }
}

/**
 * Configure the products index with correct searchable/filterable/sortable attributes.
 * Call once on startup or via admin reindex action.
 */
export async function configureProductsIndex(): Promise<void> {
  const { baseUrl, apiKey } = getMeilisearchConfig()
  const { ensureDynamicSearchSettings } = await import('../jobs/search-index-sync.job')
  await ensureDynamicSearchSettings(baseUrl, apiKey, PRODUCT_SEARCH_INDEX, true)
}

export async function waitForMeilisearchTask(
  baseUrl: string,
  apiKey: string,
  taskUid: number,
  acceptedErrors: string[] = [],
) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/tasks/${taskUid}`, {
      headers: buildMeilisearchHeaders(apiKey),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Meilisearch task lookup failed: ${response.status}`)
    const task = (await response.json()) as {
      status: string
      error?: { message?: string; code?: string }
    }
    if (
      task.status === 'succeeded' ||
      (task.status === 'failed' && acceptedErrors.includes(task.error?.code ?? ''))
    )
      return
    if (['failed', 'canceled'].includes(task.status))
      throw new Error(task.error?.message ?? 'Meilisearch task failed')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Meilisearch task timed out')
}
