/**
 * Meilisearch client — fetch-based, no SDK dependency.
 *
 * Meilisearch is a READ PROJECTION only.
 * PostgreSQL is the source of truth for all business state.
 * Never trust Meilisearch for finance, order, or payout decisions.
 */

const MEILI_URL = process.env.MEILISEARCH_URL ?? 'http://localhost:7700'
const MEILI_KEY = process.env.MEILISEARCH_MASTER_KEY ?? ''

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${MEILI_KEY}`,
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

  const res = await fetch(`${MEILI_URL}/indexes/${indexName}/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meilisearch search failed [${res.status}]: ${text}`)
  }

  const data = await res.json()
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
  const res = await fetch(`${MEILI_URL}/indexes/${indexName}/settings`, {
    method: 'PATCH',
    headers: headers(),
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
  const res = await fetch(`${MEILI_URL}/indexes`, {
    method: 'POST',
    headers: headers(),
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
  await ensureIndex('products')
  await configureIndex('products', {
    searchableAttributes: ['name', 'description', 'categoryName', 'storeName'],
    filterableAttributes: ['categoryId', 'categorySlug', 'sellerId', 'storeSlug', 'stock'],
    sortableAttributes: ['price', 'name'],
    faceting: {
      maxValuesPerFacet: 100,
    },
  })
}
