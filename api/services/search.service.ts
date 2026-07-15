import { PrismaClient } from '@prisma/client'
import {
  PRODUCT_SEARCH_ATTRIBUTES,
  PRODUCT_SEARCH_FACETS,
  PRODUCT_SEARCH_INDEX,
  type ProductSearchHit,
  type ProductSearchParams,
  type ProductSearchResponse,
  buildProductSearchFilter,
  mapProductSearchSortToCatalogSort,
  mapProductToSearchHit,
} from '../domain/search'
import { searchIndex } from '../lib/meilisearch'
import { createCatalogService } from './catalog.service'
import { buildPublicProductWhere } from '../domain/product-visibility'

export function createSearchService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const catalog = createCatalogService({ prisma })

  async function searchProducts(params: ProductSearchParams): Promise<ProductSearchResponse> {
    const { q, categorySlug, page = 1, limit = 20, sort } = params
    const normalizedQuery = q.trim()
    if (!normalizedQuery) {
      return {
        hits: [],
        totalHits: 0,
        page,
        limit,
        totalPages: 0,
        processingTimeMs: 0,
        query: normalizedQuery,
      }
    }

    const offset = (page - 1) * limit
    const filter = buildProductSearchFilter(categorySlug)
    const sortTokens = sort ? [sort] : undefined

    try {
      const result = await searchIndex<ProductSearchHit>({
        q: normalizedQuery,
        indexName: PRODUCT_SEARCH_INDEX,
        ...(filter ? { filter } : {}),
        ...(sortTokens ? { sort: sortTokens } : {}),
        limit,
        offset,
        facets: [...PRODUCT_SEARCH_FACETS],
        attributesToRetrieve: [...PRODUCT_SEARCH_ATTRIBUTES],
      })

      if (result.totalHits > 0) {
        const visibleRows = await prisma.product.findMany({
          where: buildPublicProductWhere({ id: { in: result.hits.map((hit) => hit.id) } }),
          select: { id: true },
        })
        const visibleIds = new Set(visibleRows.map((row) => row.id))
        if (visibleIds.size !== result.hits.length) {
          throw new Error('Search projection contains non-public products')
        }
        const response = {
          hits: result.hits,
          totalHits: result.totalHits,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(result.totalHits / limit)),
          ...(result.facetDistribution ? { facets: result.facetDistribution } : {}),
          processingTimeMs: result.processingTimeMs,
          query: normalizedQuery,
        }
        void recordSiteSearchQuery({
          query: normalizedQuery,
          ...(categorySlug ? { categorySlug } : {}),
          resultCount: result.totalHits,
        })
        return response
      }
    } catch {
      // Search projection is unavailable; fall back to PostgreSQL below.
    }

    const fallback = await catalog.searchPublished({
      q: normalizedQuery,
      ...(categorySlug ? { categorySlug } : {}),
      sortBy: mapProductSearchSortToCatalogSort(sort),
      skip: offset,
      take: limit,
    })

    const response = {
      hits: fallback.items.map(mapProductToSearchHit),
      totalHits: fallback.total,
      page,
      limit,
      totalPages: fallback.total > 0 ? Math.ceil(fallback.total / limit) : 1,
      processingTimeMs: 0,
      query: normalizedQuery,
    }
    void recordSiteSearchQuery({
      query: normalizedQuery,
      ...(categorySlug ? { categorySlug } : {}),
      resultCount: fallback.total,
    })
    return response
  }

  async function recordSiteSearchQuery(params: {
    query: string
    categorySlug?: string
    resultCount: number
  }) {
    try {
      await prisma.siteSearchQuery.create({
        data: {
          query: params.query,
          normalizedQuery: params.query.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' '),
          ...(params.categorySlug ? { categorySlug: params.categorySlug } : {}),
          resultCount: params.resultCount,
        },
      })
    } catch (error) {
      console.error('[search] Failed to record site search query:', error)
    }
  }

  return { searchProducts }
}
