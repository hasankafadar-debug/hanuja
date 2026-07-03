import type { Metadata } from 'next'
import { Breadcrumb } from '@hanuja/ui'
import { buildBreadcrumbStructuredData, buildCategoryMetadata, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { CategoryFilters, type FilterSeller } from '../kategori/[...slug]/_components/category-filters'
import { CategoryPageBody } from '../kategori/[...slug]/_components/category-page-body'
import { CategorySort } from '../kategori/[...slug]/_components/category-sort'
import { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const revalidate = 300

const PAGE_SIZE = 20

interface ProductsPageProps {
  searchParams: Promise<{
    sayfa?: string
    siralama?: string
    fiyat?: string
    fiyatMin?: string
    fiyatMax?: string
    stokta?: string
    tasarimci?: string
    indirimli?: string
    vitrin?: string
  }>
}

function parsePriceParams(p: {
  fiyatMin?: string
  fiyatMax?: string
  fiyat?: string
}): { minPrice?: number; maxPrice?: number } {
  if (p.fiyatMin !== undefined || p.fiyatMax !== undefined) {
    const min = Number(p.fiyatMin)
    const max = Number(p.fiyatMax)
    return {
      ...(Number.isFinite(min) && min > 0 ? { minPrice: min } : {}),
      ...(Number.isFinite(max) && max > 0 ? { maxPrice: max } : {}),
    }
  }
  if (!p.fiyat) return {}
  if (p.fiyat === '3000+') return { minPrice: 3000 }
  const parts = p.fiyat.split('-')
  const min = Number(parts[0])
  const max = Number(parts[1])
  return {
    ...(Number.isFinite(min) ? { minPrice: min } : {}),
    ...(Number.isFinite(max) && max > 0 ? { maxPrice: max } : {}),
  }
}

function toGridProduct(
  product: {
    id: string
    name: string
    slug: string
    price: { toNumber(): number } | number
    compareAtPrice?: { toNumber(): number } | number | null
    images: Array<{ url: string }>
    seller: { displayName: string; slug: string } | null
  },
): StorefrontGridProduct {
  return {
    id: product.id,
    title: product.name,
    slug: product.slug,
    price: typeof product.price === 'object' ? product.price.toNumber() : Number(product.price),
    comparePrice:
      product.compareAtPrice && typeof product.compareAtPrice === 'object'
        ? product.compareAtPrice.toNumber()
        : (product.compareAtPrice ?? null),
    imageUrl: product.images?.[0]?.url ?? null,
    imageUrls: product.images?.map((img) => img.url) ?? [],
    ...(product.seller
      ? { sellerName: product.seller.displayName, sellerSlug: product.seller.slug }
      : {}),
  }
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
  const currentPage = Math.max(1, Number(sp.sayfa ?? '1'))
  const activeVitrin = sp.vitrin
  const requestedSort = sp.siralama as 'newest' | 'favorited' | 'price-asc' | 'price-desc' | undefined
  const currentSort =
    requestedSort ?? (activeVitrin === 'favorited' ? 'favorited' : 'newest')
  const inStockOnly = sp.stokta === '1'
  const onSaleOnly = sp.indirimli === '1' || activeVitrin === 'discounts'
  const activeSeller = sp.tasarimci
  const priceRange = parsePriceParams({
    ...(sp.fiyatMin !== undefined ? { fiyatMin: sp.fiyatMin } : {}),
    ...(sp.fiyatMax !== undefined ? { fiyatMax: sp.fiyatMax } : {}),
    ...(sp.fiyat !== undefined ? { fiyat: sp.fiyat } : {}),
  })

  const prisma = createPrismaForRoute()
  const svc = createCatalogService({ prisma })
  const sellerRepo = createSellerRepository(prisma)
  const allCategories = await svc.listAllCategories()

  let sellerId: string | undefined
  if (activeSeller) {
    const seller = await sellerRepo.findBySlug(activeSeller)
    if (seller) sellerId = seller.id
  }

  const categoryIds = allCategories.map((category) => category.id)
  const [catalogResult, sellers] = await Promise.all([
    svc.listPublishedCurated({
      categoryIds,
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      sortBy: currentSort,
      ...priceRange,
      ...(inStockOnly ? { inStockOnly: true as const } : {}),
      ...(onSaleOnly ? { onSaleOnly: true as const } : {}),
      ...(sellerId ? { sellerId } : {}),
    }),
    svc.getSellersByCategory(categoryIds),
  ])

  const pageTitle = getPageTitle(activeVitrin)
  const totalPages = Math.max(1, Math.ceil(catalogResult.total / PAGE_SIZE))
  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    { name: pageTitle, url: '/urunler' },
  ])
  const breadcrumbs = [{ label: 'Ana Sayfa', href: '/' }, { label: pageTitle }]
  const activeFilterCount = [
    priceRange.minPrice !== undefined,
    priceRange.maxPrice !== undefined,
    inStockOnly,
    onSaleOnly,
    activeSeller !== undefined,
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
          currentPage={currentPage}
          totalPages={totalPages}
          categoryPath="urunler"
          paginationBasePath="/urunler"
          filterContent={
            <CategoryFilters
              {...(priceRange.minPrice !== undefined ? { minPrice: priceRange.minPrice } : {})}
              {...(priceRange.maxPrice !== undefined ? { maxPrice: priceRange.maxPrice } : {})}
              inStockOnly={inStockOnly}
              onSaleOnly={onSaleOnly}
              {...(activeSeller !== undefined ? { activeSeller } : {})}
              sellers={sellers as FilterSeller[]}
              subcategories={[]}
            />
          }
          sortContent={<CategorySort totalProducts={catalogResult.total} currentSort={currentSort} />}
        />
      </div>
    </div>
  )
}
