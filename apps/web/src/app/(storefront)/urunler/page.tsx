import type { Metadata } from 'next'
import { Breadcrumb } from '@hanuja/ui'
import { buildBreadcrumbStructuredData, buildCategoryMetadata, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { CategoryFilters, type FilterSeller } from '../kategori/[...slug]/_components/category-filters'
import { CategoryPageBody } from '../kategori/[...slug]/_components/category-page-body'
import { CategorySort } from '../kategori/[...slug]/_components/category-sort'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'
import {
  PAGE_SIZE,
  buildCuratedListOptions,
  buildListingQueryString,
  buildPaginationHrefs,
  parseListingSearchParams,
  resolveCategoryDrilldown,
  resolveListingCategoryIds,
  toGridProduct,
  type ListingSearchParams,
} from '@/lib/product-listing-query'

export const revalidate = 300

interface ProductsPageProps {
  searchParams: Promise<ListingSearchParams>
}

function getPageTitle(vitrin?: string) {
  if (vitrin === 'favorited') return 'En Çok Favorilenenler'
  if (vitrin === 'newest') return 'Yeni Tasarımlar'
  if (vitrin === 'discounts') return 'İndirimli Ürünler'
  return 'Ürünler'
}

export async function generateMetadata(): Promise<Metadata> {
  return buildCategoryMetadata({ label: 'Ürünler', slugParts: ['urunler'] })
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const sp = await searchParams
  const filters = parseListingSearchParams(sp)
  const listingQuery = buildListingQueryString(filters)
  const subcategoryOpt =
    filters.subcategorySlug !== undefined ? { subcategorySlug: filters.subcategorySlug } : {}

  const prisma = createPrismaForRoute()
  const svc = createCatalogService({ prisma })
  const sellerRepo = createSellerRepository(prisma)
  const allCategories = await getCustomerVisibleCategories()

  let sellerId: string | undefined
  if (filters.sellerSlug) {
    const seller = await sellerRepo.findBySlug(filters.sellerSlug)
    if (seller) sellerId = seller.id
  }

  // Empty slugParts = the whole visible catalog; `alt` narrows it to a subtree.
  const { baseCategoryIds, categoryIds } = resolveListingCategoryIds({
    slugParts: [],
    allCategories,
    ...subcategoryOpt,
  })

  const [catalogResult, sellers] = await Promise.all([
    svc.listPublishedCurated({
      categoryIds,
      ...buildCuratedListOptions(filters, sellerId),
    }),
    svc.getSellersByCategory(baseCategoryIds),
  ])

  const drilldown = resolveCategoryDrilldown({
    slugParts: [],
    allCategories,
    ...subcategoryOpt,
  })

  const pageTitle = getPageTitle(filters.vitrin)
  const totalPages = Math.max(1, Math.ceil(catalogResult.total / PAGE_SIZE))
  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    { name: pageTitle, url: '/urunler' },
  ])
  const breadcrumbs = [{ label: 'Ana Sayfa', href: '/' }, { label: pageTitle }]
  const activeFilterCount = [
    filters.minPrice !== undefined,
    filters.maxPrice !== undefined,
    filters.inStockOnly,
    filters.onSaleOnly,
    filters.sellerSlug !== undefined,
    filters.subcategorySlug !== undefined,
  ].filter(Boolean).length

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <JsonLd data={breadcrumbJsonLd} />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb items={breadcrumbs} className="mb-6" />

        <div className="mb-6">
          <h1
            className="text-3xl font-medium"
            style={{ fontFamily: 'var(--font-display)', color: '#3d3529' }}
          >
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {catalogResult.total} ürün listeleniyor
          </p>
        </div>

        <CategoryPageBody
          activeFilterCount={activeFilterCount}
          products={catalogResult.items.map(toGridProduct as never)}
          totalProducts={catalogResult.total}
          listingQuery={listingQuery}
          initialPage={filters.page}
          paginationHrefs={buildPaginationHrefs({
            basePath: '/urunler',
            search: sp,
            totalPages,
          })}
          pageSize={PAGE_SIZE}
          filterContent={
            <CategoryFilters
              {...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {})}
              {...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {})}
              inStockOnly={filters.inStockOnly}
              onSaleOnly={filters.onSaleOnly}
              {...(filters.sellerSlug !== undefined ? { activeSeller: filters.sellerSlug } : {})}
              {...(filters.subcategorySlug !== undefined
                ? { activeSubcategory: filters.subcategorySlug }
                : {})}
              sellers={sellers as FilterSeller[]}
              subcategories={drilldown.children}
              categoryTrail={drilldown.trail}
            />
          }
          sortContent={
            <CategorySort
              totalProducts={catalogResult.total}
              currentSort={filters.sort ?? 'newest'}
            />
          }
        />
      </div>
    </div>
  )
}
