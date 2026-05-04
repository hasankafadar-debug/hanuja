import type { Metadata } from 'next'
import { cache } from 'react'
import { Breadcrumb, EmptyState } from '@hanuja/ui'
import { Package } from 'lucide-react'
import { CategoryPagination } from './_components/category-pagination'
import { CategoryFilters } from './_components/category-filters'
import { CategorySort } from './_components/category-sort'
import { buildCategoryMetadata, buildBreadcrumbStructuredData, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { isVirtualCollection, VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import StorefrontProductGrid, { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const revalidate = 1800

const PAGE_SIZE = 20

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<{
    sayfa?: string
    siralama?: string
    fiyat?: string
    stokta?: string
  }>
}

/** Parse fiyat param (e.g. "500-1500" or "3000+") into min/max numbers */
function parsePriceRange(fiyat?: string): { minPrice?: number; maxPrice?: number } {
  if (!fiyat) return {}
  if (fiyat === '3000+') return { minPrice: 3000 }
  const parts = fiyat.split('-')
  const min = Number(parts[0])
  const max = Number(parts[1])
  return {
    ...(Number.isFinite(min) ? { minPrice: min } : {}),
    ...(Number.isFinite(max) && max > 0 ? { maxPrice: max } : {}),
  }
}

/**
 * Resolves a virtual collection slug to all descendant category IDs.
 * A virtual collection aggregates two category sub-trees (ev + ofis).
 */
async function getVirtualCollectionProducts(
  collectionSlug: string,
  page: number,
  options: {
    sortBy?: 'newest' | 'price-asc' | 'price-desc'
    minPrice?: number
    maxPrice?: number
    inStockOnly?: boolean
  },
) {
  if (!isVirtualCollection(collectionSlug)) return null

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const allCategories = await getAllCategories()

  const aggregateSlugs = VIRTUAL_COLLECTION_MAP[collectionSlug]
  const rootIds = allCategories
    .filter((c) => (aggregateSlugs as readonly string[]).includes(c.slug))
    .map((c) => c.id)

  const categoryIds = collectCategoryIds(rootIds, allCategories)
  const skip = (page - 1) * PAGE_SIZE
  const [products, total] = await Promise.all([
    svc.listPublished({
      categoryIds,
      skip,
      take: PAGE_SIZE,
      ...options,
    }),
    svc.countPublished({
      categoryIds,
      ...options,
    }),
  ])

  const labelMap: Record<string, string> = {
    mobilya: 'Mobilya',
    aydinlatma: 'Aydınlatma',
    aksesuar: 'Aksesuar',
  }

  return {
    label: labelMap[collectionSlug] ?? collectionSlug,
    products,
    total,
    isVirtual: true as const,
  }
}

async function getCategoryAndProducts(
  slugParts: string[],
  page: number,
  options: {
    sortBy?: 'newest' | 'price-asc' | 'price-desc'
    minPrice?: number
    maxPrice?: number
    inStockOnly?: boolean
  },
) {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const lastSlug = slugParts[slugParts.length - 1] ?? ''
  const category = await getCategoryBySlug(lastSlug)
  if (!category) return { category: null, products: [], total: 0 }

  const allCategories = await getAllCategories()
  const categoryIds = collectCategoryIds([category.id], allCategories)
  const skip = (page - 1) * PAGE_SIZE
  const [products, total] = await Promise.all([
    svc.listPublished({
      categoryIds,
      skip,
      take: PAGE_SIZE,
      ...options,
    }),
    svc.countPublished({
      categoryIds,
      ...options,
    }),
  ])
  return { category, products, total }
}

function collectCategoryIds(
  rootIds: string[],
  categories: Array<{ id: string; parentId: string | null }>,
) {
  const collected = new Set<string>(rootIds)
  let changed = true

  while (changed) {
    changed = false
    for (const category of categories) {
      if (category.parentId && collected.has(category.parentId) && !collected.has(category.id)) {
        collected.add(category.id)
        changed = true
      }
    }
  }

  return Array.from(collected)
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
    if (isLast) {
      items.push({ label })
    } else {
      items.push({ label, href: `/kategori/${accumulated}` })
    }
  }
  return items
}

const getCategoryBySlug = cache(async (lastSlug: string) => {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  return svc.getCategoryBySlug(lastSlug)
})

const getAllCategories = cache(async () => {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  return svc.listAllCategories()
})

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params
  const firstSlug = slug[0] ?? 'kategori'

  // Virtual collections have no DB entry — derive label from config.
  if (slug.length === 1 && isVirtualCollection(firstSlug)) {
    const labelMap: Record<string, string> = {
      mobilya: 'Mobilya',
      aydinlatma: 'Aydınlatma',
      aksesuar: 'Aksesuar',
    }
    return buildCategoryMetadata({ label: labelMap[firstSlug] ?? firstSlug, slugParts: slug })
  }

  const lastSlug = slug[slug.length - 1] ?? 'kategori'
  try {
    const category = await getCategoryBySlug(lastSlug)
    const label =
      category?.name ??
      lastSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    return buildCategoryMetadata({ label, slugParts: slug })
  } catch {
    return buildCategoryMetadata({ label: lastSlug, slugParts: slug })
  }
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params
  const resolvedSearch = await searchParams

  const currentPage = Math.max(1, Number(resolvedSearch.sayfa ?? '1'))
  const currentSort = resolvedSearch.siralama as 'newest' | 'price-asc' | 'price-desc' | undefined
  const activePriceRange = resolvedSearch.fiyat
  const inStockOnly = resolvedSearch.stokta === '1'

  const priceRange = parsePriceRange(activePriceRange)
  const categoryPath = slug.join('/')

  const filterOptions = {
    ...(currentSort !== undefined ? { sortBy: currentSort } : {}),
    ...priceRange,
    ...(inStockOnly ? { inStockOnly: true } : {}),
  }

  // Virtual collection: aggregate products from multiple sub-trees.
  const firstSlug = slug[0] ?? ''
  if (slug.length === 1 && isVirtualCollection(firstSlug)) {
    const result = await getVirtualCollectionProducts(firstSlug, currentPage, filterOptions)
    const products = result?.products ?? []
    const categoryLabel = result?.label ?? firstSlug
    const total = result?.total ?? 0
    const breadcrumbs = [{ label: 'Ana Sayfa', href: '/' }, { label: categoryLabel }]
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const breadcrumbJsonLd = buildBreadcrumbStructuredData([
      { name: 'Ana Sayfa', url: '/' },
      { name: categoryLabel, url: `/kategori/${firstSlug}` },
    ])

    return (
      <CategoryLayout
        breadcrumbJsonLd={breadcrumbJsonLd}
        breadcrumbs={breadcrumbs}
        categoryLabel={categoryLabel}
        products={products}
        totalProducts={total}
        categoryPath={categoryPath}
        currentPage={currentPage}
        totalPages={totalPages}
        {...(activePriceRange !== undefined ? { activePriceRange } : {})}
        inStockOnly={inStockOnly}
        {...(currentSort !== undefined ? { currentSort } : {})}
      />
    )
  }

  const { category, products, total } = await getCategoryAndProducts(slug, currentPage, filterOptions)

  const categoryLabel = category?.name ?? slug[slug.length - 1] ?? 'Kategori'
  const breadcrumbs = buildBreadcrumbs(slug, category)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    ...breadcrumbs.slice(1).map((b) => ({ name: b.label, url: b.href ?? '#' })),
  ])

  return (
    <CategoryLayout
      breadcrumbJsonLd={breadcrumbJsonLd}
      breadcrumbs={breadcrumbs}
      categoryLabel={categoryLabel}
      products={products}
      totalProducts={total}
      categoryPath={categoryPath}
      currentPage={currentPage}
      totalPages={totalPages}
      {...(activePriceRange !== undefined ? { activePriceRange } : {})}
      inStockOnly={inStockOnly}
      {...(currentSort !== undefined ? { currentSort } : {})}
    />
  )
}

// ── Shared layout ────────────────────────────────────────────────────────────

type ProductRow = {
  id: string
  name: string
  slug: string
  price: { toNumber(): number } | number
  compareAtPrice?: { toNumber(): number } | number | null
  images: Array<{ url: string }>
  seller: { displayName: string; slug: string } | null
}

interface CategoryLayoutProps {
  breadcrumbJsonLd: object
  breadcrumbs: Array<{ label: string; href?: string }>
  categoryLabel: string
  products: unknown[]
  totalProducts: number
  categoryPath: string
  currentPage: number
  totalPages: number
  activePriceRange?: string
  inStockOnly: boolean
  currentSort?: 'newest' | 'price-asc' | 'price-desc'
}

function CategoryLayout({
  breadcrumbJsonLd,
  breadcrumbs,
  categoryLabel,
  products,
  totalProducts,
  categoryPath,
  currentPage,
  totalPages,
  activePriceRange,
  inStockOnly,
  currentSort,
}: CategoryLayoutProps) {
  const rows = products as unknown as ProductRow[]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <JsonLd data={breadcrumbJsonLd} />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb items={breadcrumbs} className="mb-6" />

        <div className="mb-8">
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            {categoryLabel}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {totalProducts} ürün listeleniyor
          </p>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          <CategoryFilters
            {...(activePriceRange !== undefined ? { activePriceRange } : {})}
            inStockOnly={inStockOnly}
          />

          <div className="flex-1">
            <CategorySort
              {...(currentSort !== undefined ? { currentSort } : {})}
              productCount={rows.length}
            />

            {rows.length === 0 ? (
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title="Bu kategoride ürün bulunamadı"
                description="Filtrelerinizi değiştirerek tekrar deneyin."
              />
            ) : (
              <>
                <StorefrontProductGrid
                  gridClassName="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  products={rows.map<StorefrontGridProduct>((product) => ({
                    id: product.id,
                    title: product.name,
                    slug: product.slug,
                    price:
                      typeof product.price === 'object'
                        ? product.price.toNumber()
                        : Number(product.price),
                    comparePrice:
                      product.compareAtPrice && typeof product.compareAtPrice === 'object'
                        ? product.compareAtPrice.toNumber()
                        : (product.compareAtPrice ?? null),
                    imageUrl: product.images?.[0]?.url ?? null,
                    imageUrls: product.images?.map((image) => image.url) ?? [],
                    ...(product.seller
                      ? {
                          sellerName: product.seller.displayName,
                          sellerSlug: product.seller.slug,
                        }
                      : {}),
                  }))}
                />
                <div className="mt-10 flex justify-center">
                  <CategoryPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    categoryPath={categoryPath}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
