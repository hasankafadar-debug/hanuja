import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumb } from '@hanuja/ui'
import { CategoryFilters, type FilterSeller, type FilterSubcategory } from './_components/category-filters'
import { CategorySort } from './_components/category-sort'
import { CategoryPageBody } from './_components/category-page-body'
import { buildCategoryMetadata, buildBreadcrumbStructuredData, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { isVirtualCollection, VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'
import { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'
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

export const revalidate = 1800

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<ListingSearchParams>
}

function buildBreadcrumbs(slugParts: string[], category: { name: string } | null) {
  const items: { label: string; href?: string }[] = [{ label: 'Ana Sayfa', href: '/' }]
  let accumulated = ''
  for (let i = 0; i < slugParts.length; i++) {
    const part = slugParts[i]!
    accumulated = accumulated ? `${accumulated}/${part}` : part
    const isLast = i === slugParts.length - 1
    const label =
      isLast && category
        ? category.name
        : part.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    if (isLast) items.push({ label })
    else items.push({ label, href: `/kategori/${accumulated}` })
  }
  return items
}

async function getCategoryBySlug(lastSlug: string) {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  return svc.getCategoryBySlug(lastSlug)
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params
  const firstSlug = slug[0] ?? 'kategori'
  if (slug.length === 1 && isVirtualCollection(firstSlug)) {
    const labelMap: Record<string, string> = {
      mobilya: 'Mobilya',
      aydinlatma: 'Aydınlatma',
      aksesuar: 'Aksesuar',
    }
    const label = labelMap[firstSlug] ?? firstSlug
    try {
      const visibleCategories = await getCustomerVisibleCategories()
      const visibleSlugs = new Set(visibleCategories.map((c) => c.slug))
      const hasVisibleMember = VIRTUAL_COLLECTION_MAP[firstSlug].some((memberSlug) =>
        visibleSlugs.has(memberSlug),
      )
      return buildCategoryMetadata({
        label,
        slugParts: slug,
        ...(hasVisibleMember ? {} : { noindex: true }),
      })
    } catch {
      // Transient DB failure must not cache a deindex directive for 30 min.
      return buildCategoryMetadata({ label, slugParts: slug })
    }
  }
  const lastSlug = slug[slug.length - 1] ?? 'kategori'
  try {
    const [category, visibleCategories] = await Promise.all([
      getCategoryBySlug(lastSlug),
      getCustomerVisibleCategories(),
    ])
    const label =
      category?.name ??
      lastSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    // Empty (or unknown) categories are noindex,follow; they become indexable
    // automatically once a published product lands in the subtree.
    const isCustomerVisible =
      category !== null && visibleCategories.some((c) => c.id === category.id)
    return buildCategoryMetadata({
      label,
      slugParts: slug,
      ...(isCustomerVisible ? {} : { noindex: true }),
    })
  } catch {
    // Transient DB failure must not cache a deindex directive for 30 min.
    return buildCategoryMetadata({ label: lastSlug, slugParts: slug })
  }
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params
  const sp = await searchParams

  const filters = parseListingSearchParams(sp)
  const categoryPath = slug.join('/')
  const listingQuery = buildListingQueryString(filters, categoryPath)
  const subcategoryOpt =
    filters.subcategorySlug !== undefined ? { subcategorySlug: filters.subcategorySlug } : {}

  // Resolve seller slug → id
  let sellerId: string | undefined
  if (filters.sellerSlug) {
    const prisma = createPrismaForRoute()
    const sellerRepo = createSellerRepository(prisma)
    const seller = await sellerRepo.findBySlug(filters.sellerSlug)
    if (seller) sellerId = seller.id
  }

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  // Customer-visible tree only; invisible descendants have zero published
  // products by definition, so excluding them does not change listings.
  const allCategories = await getCustomerVisibleCategories()
  const firstSlug = slug[0] ?? ''

  // ── Virtual collection ──────────────────────────────────────────────────────
  if (slug.length === 1 && isVirtualCollection(firstSlug)) {
    const { baseCategoryIds, categoryIds } = resolveListingCategoryIds({
      slugParts: slug,
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
      slugParts: slug,
      allCategories,
      ...subcategoryOpt,
    })

    const labelMap: Record<string, string> = { mobilya: 'Mobilya', aydinlatma: 'Aydınlatma', aksesuar: 'Aksesuar' }
    const categoryLabel = labelMap[firstSlug] ?? firstSlug
    const totalPages = Math.max(1, Math.ceil(catalogResult.total / PAGE_SIZE))
    const breadcrumbs = [{ label: 'Ana Sayfa', href: '/' }, { label: categoryLabel }]
    const breadcrumbJsonLd = buildBreadcrumbStructuredData([
      { name: 'Ana Sayfa', url: '/' },
      { name: categoryLabel, url: `/kategori/${firstSlug}` },
    ])

    return (
      <CategoryLayout
        breadcrumbJsonLd={breadcrumbJsonLd}
        breadcrumbs={breadcrumbs}
        categoryLabel={categoryLabel}
        products={catalogResult.items.map(toGridProduct as never)}
        totalProducts={catalogResult.total}
        listingQuery={listingQuery}
        initialPage={filters.page}
        paginationHrefs={buildPaginationHrefs({
          basePath: `/kategori/${categoryPath}`,
          search: sp,
          totalPages,
        })}
        {...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {})}
        {...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {})}
        inStockOnly={filters.inStockOnly}
        sellers={sellers as FilterSeller[]}
        subcategories={drilldown.children}
        categoryTrail={drilldown.trail}
        {...(filters.sellerSlug !== undefined ? { activeSeller: filters.sellerSlug } : {})}
        {...(filters.subcategorySlug !== undefined
          ? { activeSubcategory: filters.subcategorySlug }
          : {})}
        onSaleOnly={filters.onSaleOnly}
        {...(filters.sort !== undefined ? { currentSort: filters.sort } : {})}
      />
    )
  }

  // ── Regular category ────────────────────────────────────────────────────────
  const lastSlug = slug[slug.length - 1] ?? ''
  const category = await getCategoryBySlug(lastSlug)
  if (!category) {
    // Unknown slug must be a real 404 — the previous soft-200 page was an
    // indexable soft-404. Existing-but-empty categories still render below.
    notFound()
  }

  const { baseCategoryIds, categoryIds } = resolveListingCategoryIds({
    slugParts: slug,
    allCategories,
    resolvedCategoryId: category.id,
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
    slugParts: slug,
    allCategories,
    resolvedCategoryId: category.id,
    ...subcategoryOpt,
  })

  const categoryLabel = category.name
  const breadcrumbs = buildBreadcrumbs(slug, category)
  const totalPages = Math.max(1, Math.ceil(catalogResult.total / PAGE_SIZE))

  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    ...breadcrumbs.slice(1).map((b) => ({ name: b.label, url: b.href ?? '#' })),
  ])

  return (
    <CategoryLayout
      breadcrumbJsonLd={breadcrumbJsonLd}
      breadcrumbs={breadcrumbs}
      categoryLabel={categoryLabel}
      products={catalogResult.items.map(toGridProduct as never)}
      totalProducts={catalogResult.total}
      listingQuery={listingQuery}
      initialPage={filters.page}
      paginationHrefs={buildPaginationHrefs({
        basePath: `/kategori/${categoryPath}`,
        search: sp,
        totalPages,
      })}
      {...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {})}
      {...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {})}
      inStockOnly={filters.inStockOnly}
      onSaleOnly={filters.onSaleOnly}
      sellers={sellers as FilterSeller[]}
      subcategories={drilldown.children}
      categoryTrail={drilldown.trail}
      {...(filters.sellerSlug !== undefined ? { activeSeller: filters.sellerSlug } : {})}
      {...(filters.subcategorySlug !== undefined
        ? { activeSubcategory: filters.subcategorySlug }
        : {})}
      {...(filters.sort !== undefined ? { currentSort: filters.sort } : {})}
    />
  )
}

// ── Shared layout ────────────────────────────────────────────────────────────

interface CategoryLayoutProps {
  breadcrumbJsonLd: object
  breadcrumbs: Array<{ label: string; href?: string }>
  categoryLabel: string
  products: StorefrontGridProduct[]
  totalProducts: number
  listingQuery: string
  initialPage: number
  paginationHrefs: Array<{ page: number; href: string }>
  minPrice?: number
  maxPrice?: number
  inStockOnly: boolean
  sellers: FilterSeller[]
  subcategories: FilterSubcategory[]
  categoryTrail: FilterSubcategory[]
  activeSeller?: string
  activeSubcategory?: string
  onSaleOnly: boolean
  currentSort?: 'newest' | 'favorited' | 'price-asc' | 'price-desc'
}

function CategoryLayout({
  breadcrumbJsonLd,
  breadcrumbs,
  categoryLabel,
  products,
  totalProducts,
  listingQuery,
  initialPage,
  paginationHrefs,
  minPrice,
  maxPrice,
  inStockOnly,
  onSaleOnly,
  sellers,
  subcategories,
  categoryTrail,
  activeSeller,
  activeSubcategory,
  currentSort,
}: CategoryLayoutProps) {
  const activeFilterCount = [
    minPrice !== undefined,
    maxPrice !== undefined,
    inStockOnly,
    onSaleOnly,
    activeSeller !== undefined,
    activeSubcategory !== undefined,
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
            {categoryLabel}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {totalProducts} ürün listeleniyor
          </p>
        </div>

        <CategoryPageBody
          activeFilterCount={activeFilterCount}
          products={products}
          totalProducts={totalProducts}
          listingQuery={listingQuery}
          initialPage={initialPage}
          paginationHrefs={paginationHrefs}
          pageSize={PAGE_SIZE}
          filterContent={
            <CategoryFilters
              {...(minPrice !== undefined ? { minPrice } : {})}
              {...(maxPrice !== undefined ? { maxPrice } : {})}
              inStockOnly={inStockOnly}
              onSaleOnly={onSaleOnly}
              {...(activeSeller !== undefined ? { activeSeller } : {})}
              {...(activeSubcategory !== undefined ? { activeSubcategory } : {})}
              sellers={sellers}
              subcategories={subcategories}
              categoryTrail={categoryTrail}
            />
          }
          sortContent={
            <CategorySort
              totalProducts={totalProducts}
              {...(currentSort !== undefined ? { currentSort } : {})}
            />
          }
        />
      </div>
    </div>
  )
}
