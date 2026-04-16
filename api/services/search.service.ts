/**
 * Search service — orchestrates Meilisearch index operations.
 *
 * Meilisearch is a READ PROJECTION only. PostgreSQL is the source of truth.
 * This service is the single point for:
 *   - product search queries
 *   - single-product reindex
 *   - full catalog reindex (admin-triggered)
 */
import { PrismaClient } from '@prisma/client'
import {
  searchIndex,
  configureProductsIndex,
  ensureIndex,
} from '../lib/meilisearch'

const MEILI_URL = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700'
const MEILI_KEY = process.env['MEILISEARCH_MASTER_KEY'] ?? ''

function meiliHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${MEILI_KEY}`,
  }
}

export interface ProductSearchParams {
  q: string
  categorySlug?: string
  page?: number
  limit?: number
  sort?: 'price:asc' | 'price:desc' | 'name:asc'
}

export interface ProductSearchResult {
  hits: ProductSearchHit[]
  totalHits: number
  page: number
  limit: number
  processingTimeMs: number
}

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

export function createSearchService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps

  async function searchProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
    const { q, categorySlug, page = 1, limit = 20, sort } = params
    const offset = (page - 1) * limit

    const filter = categorySlug ? `categorySlug = "${categorySlug}"` : undefined

    const result = await searchIndex<ProductSearchHit>({
      q,
      indexName: 'products',
      filter,
      sort: sort ? [sort] : undefined,
      limit,
      offset,
    })

    return {
      hits: result.hits,
      totalHits: result.totalHits,
      page,
      limit,
      processingTimeMs: result.processingTimeMs,
    }
  }

  async function reindexProduct(productId: string): Promise<void> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        seller: {
          include: {
            profile: { select: { storeName: true, storeSlug: true } },
          },
        },
        mediaAssets: {
          where: { isPrimary: true },
          select: { url: true },
          take: 1,
        },
      },
    })

    if (!product) {
      // Product was deleted — remove from index
      await removeFromIndex(productId)
      return
    }

    // Only index published, in-stock-eligible products
    if (product.status !== 'PUBLISHED' || product.stock <= 0) {
      await removeFromIndex(productId)
      return
    }

    const doc = {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      categoryId: product.category.id,
      categorySlug: product.category.slug,
      categoryName: product.category.name,
      sellerId: product.sellerId,
      storeSlug: product.seller.profile?.storeSlug ?? '',
      storeName: product.seller.profile?.storeName ?? '',
      imageUrl: product.mediaAssets[0]?.url ?? null,
      stock: product.stock,
    }

    await fetch(`${MEILI_URL}/indexes/products/documents`, {
      method: 'POST',
      headers: meiliHeaders(),
      body: JSON.stringify([doc]),
    })
  }

  async function reindexAll(): Promise<{ queued: number }> {
    await configureProductsIndex()
    await ensureIndex('products')

    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED', stock: { gt: 0 } },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        seller: {
          include: {
            profile: { select: { storeName: true, storeSlug: true } },
          },
        },
        mediaAssets: {
          where: { isPrimary: true },
          select: { url: true },
          take: 1,
        },
      },
    })

    const docs = products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      categoryId: product.category.id,
      categorySlug: product.category.slug,
      categoryName: product.category.name,
      sellerId: product.sellerId,
      storeSlug: product.seller.profile?.storeSlug ?? '',
      storeName: product.seller.profile?.storeName ?? '',
      imageUrl: product.mediaAssets[0]?.url ?? null,
      stock: product.stock,
    }))

    if (docs.length > 0) {
      await fetch(`${MEILI_URL}/indexes/products/documents`, {
        method: 'POST',
        headers: meiliHeaders(),
        body: JSON.stringify(docs),
      })
    }

    return { queued: docs.length }
  }

  async function removeFromIndex(productId: string): Promise<void> {
    await fetch(`${MEILI_URL}/indexes/products/documents/${productId}`, {
      method: 'DELETE',
      headers: meiliHeaders(),
    })
  }

  return { searchProducts, reindexProduct, reindexAll, removeFromIndex }
}
