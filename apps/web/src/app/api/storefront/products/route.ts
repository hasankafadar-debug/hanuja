import { NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'
import {
  PAGE_SIZE,
  buildCuratedListOptions,
  parseListingSearchParams,
  resolveListingCategoryIds,
  toGridProduct,
  type ListingSearchParams,
} from '@/lib/product-listing-query'

/**
 * GET /api/storefront/products
 *
 * Load-more feed behind the infinite-scrolling product grids. Accepts the same
 * query params the listing pages read, plus `kategori=<slug/path>` to scope to a
 * category (omit it for the /urunler scope). Page 1 is still server-rendered by
 * the page itself; this route only serves pages 2..N.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const raw: ListingSearchParams = {
    ...(searchParams.get('sayfa') !== null ? { sayfa: searchParams.get('sayfa')! } : {}),
    ...(searchParams.get('siralama') !== null ? { siralama: searchParams.get('siralama')! } : {}),
    ...(searchParams.get('fiyat') !== null ? { fiyat: searchParams.get('fiyat')! } : {}),
    ...(searchParams.get('fiyatMin') !== null ? { fiyatMin: searchParams.get('fiyatMin')! } : {}),
    ...(searchParams.get('fiyatMax') !== null ? { fiyatMax: searchParams.get('fiyatMax')! } : {}),
    ...(searchParams.get('stokta') !== null ? { stokta: searchParams.get('stokta')! } : {}),
    ...(searchParams.get('tasarimci') !== null ? { tasarimci: searchParams.get('tasarimci')! } : {}),
    ...(searchParams.get('alt') !== null ? { alt: searchParams.get('alt')! } : {}),
    ...(searchParams.get('indirimli') !== null ? { indirimli: searchParams.get('indirimli')! } : {}),
    ...(searchParams.get('vitrin') !== null ? { vitrin: searchParams.get('vitrin')! } : {}),
  }

  const filters = parseListingSearchParams(raw)
  const slugParts = (searchParams.get('kategori') ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  const prisma = createPrismaForRoute()
  const svc = createCatalogService({ prisma })
  const allCategories = await getCustomerVisibleCategories()

  // Resolve the page category the same way the page does, so an empty or
  // non-visible category yields the same (empty) result on both paths.
  let resolvedCategoryId: string | undefined
  if (slugParts.length > 0) {
    const lastSlug = slugParts[slugParts.length - 1] ?? ''
    const category = await svc.getCategoryBySlug(lastSlug)
    if (category) resolvedCategoryId = category.id
  }

  let sellerId: string | undefined
  if (filters.sellerSlug) {
    const sellerRepo = createSellerRepository(prisma)
    const seller = await sellerRepo.findBySlug(filters.sellerSlug)
    if (seller) sellerId = seller.id
  }

  const { categoryIds } = resolveListingCategoryIds({
    slugParts,
    allCategories,
    ...(filters.subcategorySlug !== undefined
      ? { subcategorySlug: filters.subcategorySlug }
      : {}),
    ...(resolvedCategoryId !== undefined ? { resolvedCategoryId } : {}),
  })

  const result = await svc.listPublishedCurated({
    categoryIds,
    ...buildCuratedListOptions(filters, sellerId),
  })

  const products = result.items.map(toGridProduct as never)
  const loadedThroughThisPage = (filters.page - 1) * PAGE_SIZE + products.length

  return NextResponse.json({
    products,
    total: result.total,
    hasMore: loadedThroughThisPage < result.total,
  })
}
