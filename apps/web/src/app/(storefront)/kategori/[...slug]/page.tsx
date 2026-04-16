import type { Metadata } from 'next'
import { Breadcrumb, ProductCard, EmptyState } from '@hanuja/ui'
import { Package } from 'lucide-react'
import { CategoryPagination } from './_components/category-pagination'
import { CategoryFilters } from './_components/category-filters'
import { CategorySort } from './_components/category-sort'
import { buildCategoryMetadata, buildBreadcrumbStructuredData, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

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
  const category = await svc.getCategoryBySlug(lastSlug)
  if (!category) return { category: null, products: [], total: 0 }

  const skip = (page - 1) * PAGE_SIZE
  const products = await svc.listPublished({
    categoryId: category.id,
    skip,
    take: PAGE_SIZE,
    ...options,
  })
  return { category, products, total: products.length }
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

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params
  const lastSlug = slug[slug.length - 1] ?? 'kategori'
  try {
    const svc = createCatalogService({ prisma: createPrismaForRoute() })
    const category = await svc.getCategoryBySlug(lastSlug)
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

  const { category, products } = await getCategoryAndProducts(slug, currentPage, {
    ...(currentSort !== undefined ? { sortBy: currentSort } : {}),
    ...priceRange,
    ...(inStockOnly ? { inStockOnly: true } : {}),
  })

  const categoryLabel = category?.name ?? slug[slug.length - 1] ?? 'Kategori'
  const breadcrumbs = buildBreadcrumbs(slug, category)
  const totalPages = Math.max(
    1,
    Math.ceil(products.length === PAGE_SIZE ? currentPage + 1 : currentPage),
  )

  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    ...breadcrumbs.slice(1).map((b) => ({ name: b.label, url: b.href ?? '#' })),
  ])

  type ProductRow = {
    id: string
    name: string
    slug: string
    price: { toNumber(): number } | number
    images: Array<{ url: string }>
    seller: { displayName: string; slug: string } | null
  }

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
            {products.length} ürün listeleniyor
          </p>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Filtre sidebar — client component */}
          <CategoryFilters
            {...(activePriceRange !== undefined ? { activePriceRange } : {})}
            inStockOnly={inStockOnly}
          />

          {/* Ürün listesi */}
          <div className="flex-1">
            {/* Sıralama + sayaç — client component */}
            <CategorySort {...(currentSort !== undefined ? { currentSort } : {})} productCount={products.length} />

            {products.length === 0 ? (
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title="Bu kategoride ürün bulunamadı"
                description="Filtrelerinizi değiştirerek tekrar deneyin."
              />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {(products as unknown as ProductRow[]).map((product) => {
                    const price =
                      typeof product.price === 'object'
                        ? product.price.toNumber()
                        : Number(product.price)
                    const imageUrl = product.images?.[0]?.url
                    return (
                      <ProductCard
                        key={product.id}
                        id={product.id}
                        title={product.name}
                        slug={product.slug}
                        price={price}
                        {...(imageUrl ? { imageUrl } : {})}
                        {...(product.seller
                          ? {
                              sellerName: product.seller.displayName,
                              sellerSlug: product.seller.slug,
                            }
                          : {})}
                      />
                    )
                  })}
                </div>
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
