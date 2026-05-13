import type { Metadata } from 'next'
import { cache } from 'react'
import { Breadcrumb } from '@hanuja/ui'
import { CategoryFilters, type FilterSeller, type FilterSubcategory } from './_components/category-filters'
import { CategorySort } from './_components/category-sort'
import { CategoryPageBody } from './_components/category-page-body'
import { buildCategoryMetadata, buildBreadcrumbStructuredData, JsonLd } from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { isVirtualCollection, VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const revalidate = 1800

const PAGE_SIZE = 20

interface CategoryPageProps {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<{
    sayfa?: string
    siralama?: string
    /** Legacy format: "500-1500" or "3000+" */
    fiyat?: string
    fiyatMin?: string
    fiyatMax?: string
    stokta?: string
    /** Seller slug */
    tasarimci?: string
    /** Subcategory slug */
    alt?: string
    indirimli?: string
  }>
}

/** Parse fiyat params: new fiyatMin/fiyatMax take priority; legacy fiyat as fallback */
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

function collectCategoryIds(
  rootIds: string[],
  categories: Array<{ id: string; parentId: string | null }>,
) {
  const collected = new Set<string>(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const c of categories) {
      if (c.parentId && collected.has(c.parentId) && !collected.has(c.id)) {
        collected.add(c.id)
        changed = true
      }
    }
  }
  return Array.from(collected)
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
    price:
      typeof product.price === 'object' ? product.price.toNumber() : Number(product.price),
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
  const sp = await searchParams

  const currentPage = Math.max(1, Number(sp.sayfa ?? '1'))
  const currentSort = sp.siralama as 'newest' | 'price-asc' | 'price-desc' | undefined
  const inStockOnly = sp.stokta === '1'
  const onSaleOnly = sp.indirimli === '1'
  const activeSeller = sp.tasarimci
  const activeSubcategory = sp.alt
  const priceRange = parsePriceParams({
    ...(sp.fiyatMin !== undefined ? { fiyatMin: sp.fiyatMin } : {}),
    ...(sp.fiyatMax !== undefined ? { fiyatMax: sp.fiyatMax } : {}),
    ...(sp.fiyat !== undefined ? { fiyat: sp.fiyat } : {}),
  })
  const categoryPath = slug.join('/')

  // Resolve seller slug → id
  let sellerId: string | undefined
  if (activeSeller) {
    const prisma = createPrismaForRoute()
    const sellerRepo = createSellerRepository(prisma)
    const seller = await sellerRepo.findBySlug(activeSeller)
    if (seller) sellerId = seller.id
  }

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const allCategories = await getAllCategories()
  const firstSlug = slug[0] ?? ''

  // Resolve alt subcategory → descendant IDs
  let altCategoryIds: string[] | undefined
  if (activeSubcategory) {
    const sub = allCategories.find((c) => c.slug === activeSubcategory)
    if (sub) altCategoryIds = collectCategoryIds([sub.id], allCategories)
  }

  const listOpts = {
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    ...(currentSort !== undefined ? { sortBy: currentSort } : {}),
    ...priceRange,
    ...(inStockOnly ? { inStockOnly: true as const } : {}),
    ...(onSaleOnly ? { onSaleOnly: true as const } : {}),
    ...(sellerId !== undefined ? { sellerId } : {}),
  }

  // ── Virtual collection ──────────────────────────────────────────────────────
  if (slug.length === 1 && isVirtualCollection(firstSlug)) {
    const aggregateSlugs = VIRTUAL_COLLECTION_MAP[firstSlug]
    const rootIds = allCategories
      .filter((c) => (aggregateSlugs as readonly string[]).includes(c.slug))
      .map((c) => c.id)
    const baseCategoryIds = collectCategoryIds(rootIds, allCategories)
    const categoryIds = altCategoryIds ?? baseCategoryIds

    const [products, total, sellers] = await Promise.all([
      svc.listPublished({ categoryIds, ...listOpts }),
      svc.countPublished({ categoryIds, ...priceRange, ...(inStockOnly ? { inStockOnly: true as const } : {}), ...(onSaleOnly ? { onSaleOnly: true as const } : {}), ...(sellerId !== undefined ? { sellerId } : {}) }),
      svc.getSellersByCategory(baseCategoryIds),
    ])

    const subcategories: FilterSubcategory[] = allCategories
      .filter((c) => rootIds.includes(c.parentId ?? ''))
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name }))

    const labelMap: Record<string, string> = { mobilya: 'Mobilya', aydinlatma: 'Aydınlatma', aksesuar: 'Aksesuar' }
    const categoryLabel = labelMap[firstSlug] ?? firstSlug
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
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
        products={products.map(toGridProduct as never)}
        totalProducts={total}
        categoryPath={categoryPath}
        currentPage={currentPage}
        totalPages={totalPages}
        {...(priceRange.minPrice !== undefined ? { minPrice: priceRange.minPrice } : {})}
        {...(priceRange.maxPrice !== undefined ? { maxPrice: priceRange.maxPrice } : {})}
        inStockOnly={inStockOnly}
        sellers={sellers as FilterSeller[]}
        subcategories={subcategories}
        {...(activeSeller !== undefined ? { activeSeller } : {})}
        {...(activeSubcategory !== undefined ? { activeSubcategory } : {})}
        onSaleOnly={onSaleOnly}
        {...(currentSort !== undefined ? { currentSort } : {})}
      />
    )
  }

  // ── Regular category ────────────────────────────────────────────────────────
  const lastSlug = slug[slug.length - 1] ?? ''
  const category = await getCategoryBySlug(lastSlug)
  if (!category) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <p style={{ color: 'var(--color-muted-fg)' }}>Kategori bulunamadı.</p>
      </div>
    )
  }

  const baseCategoryIds = collectCategoryIds([category.id], allCategories)
  const categoryIds = altCategoryIds ?? baseCategoryIds

  const [products, total, sellers] = await Promise.all([
    svc.listPublished({ categoryIds, ...listOpts }),
    svc.countPublished({ categoryIds, ...priceRange, ...(inStockOnly ? { inStockOnly: true as const } : {}), ...(onSaleOnly ? { onSaleOnly: true as const } : {}), ...(sellerId !== undefined ? { sellerId } : {}) }),
    svc.getSellersByCategory(baseCategoryIds),
  ])

  const subcategories: FilterSubcategory[] = allCategories
    .filter((c) => c.parentId === category.id)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name }))

  const categoryLabel = category.name
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
      products={products.map(toGridProduct as never)}
      totalProducts={total}
      categoryPath={categoryPath}
      currentPage={currentPage}
      totalPages={totalPages}
      {...(priceRange.minPrice !== undefined ? { minPrice: priceRange.minPrice } : {})}
      {...(priceRange.maxPrice !== undefined ? { maxPrice: priceRange.maxPrice } : {})}
      inStockOnly={inStockOnly}
      onSaleOnly={onSaleOnly}
      sellers={sellers as FilterSeller[]}
      subcategories={subcategories}
      {...(activeSeller !== undefined ? { activeSeller } : {})}
      {...(activeSubcategory !== undefined ? { activeSubcategory } : {})}
      {...(currentSort !== undefined ? { currentSort } : {})}
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
  categoryPath: string
  currentPage: number
  totalPages: number
  minPrice?: number
  maxPrice?: number
  inStockOnly: boolean
  sellers: FilterSeller[]
  subcategories: FilterSubcategory[]
  activeSeller?: string
  activeSubcategory?: string
  onSaleOnly: boolean
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
  minPrice,
  maxPrice,
  inStockOnly,
  onSaleOnly,
  sellers,
  subcategories,
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
            className="text-3xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
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
          currentPage={currentPage}
          totalPages={totalPages}
          categoryPath={categoryPath}
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
