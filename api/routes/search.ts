/**
 * Search route handlers - Meilisearch-backed product search with PG fallback.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { PRODUCT_SEARCH_SORT_VALUES } from '../domain/search'
import { createPrismaForRoute } from '../lib/prisma'
import { ok, handleError } from '../lib/response'
import { createSearchService } from '../services/search.service'
import { parsePropertyFilters } from '../domain/property-filters'

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  categorySlug: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(PRODUCT_SEARCH_SORT_VALUES).optional(),
})

// GET /api/search?q=&categorySlug=&page=&limit=&sort=
export async function searchProducts(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const raw = Object.fromEntries(url.searchParams.entries())
    const params = searchQuerySchema.parse(raw)
    const service = createSearchService({ prisma: createPrismaForRoute() })
    const result = await service.searchProducts({
      q: params.q,
      page: params.page,
      limit: params.limit,
      propertyFilters: parsePropertyFilters(url.searchParams),
      includePropertyFacets: true,
      inStockOnly: url.searchParams.get('stokta') === 'true',
      ...(params.categorySlug ? { categorySlug: params.categorySlug } : {}),
      ...(params.sort ? { sort: params.sort } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
