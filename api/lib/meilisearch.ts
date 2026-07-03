/**
 * Meilisearch client — fetch-based, no SDK dependency.
 *
 * Meilisearch is a READ PROJECTION only.
 * PostgreSQL is the source of truth for all business state.
 * Never trust Meilisearch for finance, order, or payout decisions.
 */

import {
  PRODUCT_SEARCH_INDEX,
  PRODUCT_SEARCH_SETTINGS,
} from '../domain/search'

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
  processingTimeMs: number
}

export async function searchIndex<T = Record<string, unknown>>(
  params: SearchParams,
): Promise<SearchResult<T>> {
  const { baseUrl, apiKey } = getMeilisearchConfig()
  const { indexName, q, filter, facets, sort, limit = 20, offset = 0, attributesToRetrieve } = params

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
    processingTimeMs?: number
  }
  return {
    hits: data.hits ?? [],
    totalHits: data.estimatedTotalHits ?? data.totalHits ?? 0,
    limit: data.limit ?? limit,
    offset: data.offset ?? offset,
    facetDistribution: data.facetDistribution,
    processingTimeMs: data.processingTimeMs ?? 0,
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
export async function ensureIndex(indexName: string, primaryKey = 'id'): Promise<void> {
  const { baseUrl, apiKey } = getMeilisearchConfig()
  const res = await fetch(`${baseUrl}/indexes`, {
    method: 'POST',
    headers: buildMeilisearchHeaders(apiKey),
    body: JSON.stringify({ uid: indexName, primaryKey }),
  })

  // 409 = already exists — that's fine
  if (!res.ok && res.status !== 409) {
    const text = await res.text()
    throw new Error(`Meilisearch ensureIndex failed [${res.status}]: ${text}`)
  }
}

/**
 * Configure the products index with correct searchable/filterable/sortable attributes.
 * Call once on startup or via admin reindex action.
 */
export async function configureProductsIndex(): Promise<void> {
  await ensureIndex(PRODUCT_SEARCH_INDEX)
  await configureIndex(PRODUCT_SEARCH_INDEX, PRODUCT_SEARCH_SETTINGS)
}
