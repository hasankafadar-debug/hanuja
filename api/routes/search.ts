/**
 * Search route handlers — Meilisearch-powered product search.
 *
 * Meilisearch is a read projection only.
 * All results are from the published-products index — unpublished items never appear.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { searchIndex } from '../lib/meilisearch'

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  categorySlug: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['price:asc', 'price:desc', 'name:asc']).optional(),
})

export interface ProductSearchHit {
  id: string
  slug: string
  name: string
  description: string
  price: number
  categoryId: string
  categorySlug: string
  categoryName: string
  sellerId: string
  storeSlug: string
  storeName: string
  imageUrl: string | null
  stock: number
}

// GET /api/search?q=&categorySlug=&page=&limit=&sort=
export async function searchProducts(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const raw = Object.fromEntries(url.searchParams.entries())
    const params = searchQuerySchema.parse(raw)

    const offset = (params.page - 1) * params.limit
    const filter = params.categorySlug ? `categorySlug = "${params.categorySlug}"` : undefined
    const sort = params.sort ? [params.sort] : undefined

    const result = await searchIndex<ProductSearchHit>({
      indexName: 'products',
      q: params.q,
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
      limit: params.limit,
      offset,
      facets: ['categorySlug', 'categoryName'],
      attributesToRetrieve: [
        'id', 'slug', 'name', 'description', 'price',
        'categoryId', 'categorySlug', 'categoryName',
        'sellerId', 'storeSlug', 'storeName', 'imageUrl', 'stock',
      ],
    })

    return ok({
      hits: result.hits,
      totalHits: result.totalHits,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(result.totalHits / params.limit),
      facets: result.facetDistribution,
      processingTimeMs: result.processingTimeMs,
      query: params.q,
    })
  } catch (err) {
    return handleError(err)
  }
}
