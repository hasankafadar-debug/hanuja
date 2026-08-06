/**
 * Shared query layer for the storefront product listings (/kategori/... and
 * /urunler).
 *
 * The listing pages render page 1 on the server and the client appends further
 * pages from GET /api/storefront/products. Both paths MUST resolve the same
 * category scope and the same filters, otherwise scrolling would silently mix
 * two different result sets. That parity is the reason this module exists —
 * parsing and scope resolution live here once and are imported by the pages and
 * by the API route.
 */
// Relative imports on purpose: the `@/` alias points at another workspace in
// the shared vitest config, and this module is unit-tested directly.
import { isVirtualCollection, VIRTUAL_COLLECTION_MAP } from '../config/storefront-nav'
import type { StorefrontGridProduct } from '../components/storefront/storefront-product-grid'

export const PAGE_SIZE = 20

export type ListingSort = 'newest' | 'favorited' | 'price-asc' | 'price-desc'

const SORT_VALUES: readonly ListingSort[] = ['newest', 'favorited', 'price-asc', 'price-desc']

/** Raw storefront query string, as Next hands it to the page. */
export interface ListingSearchParams {
  sayfa?: string
  siralama?: string
  /** Legacy format: "500-1500" or "3000+" */
  fiyat?: string
  fiyatMin?: string
  fiyatMax?: string
  stokta?: string
  /** Seller slug */
  tasarimci?: string
  /** Deepest selected category slug */
  alt?: string
  indirimli?: string
  /** Curated shelf on /urunler: favorited | newest | discounts */
  vitrin?: string
}

/** Normalized filters — the single shape both the page and the API route use. */
export interface ListingFilters {
  page: number
  sort?: ListingSort
  minPrice?: number
  maxPrice?: number
  inStockOnly: boolean
  onSaleOnly: boolean
  sellerSlug?: string
  subcategorySlug?: string
  vitrin?: string
}

export interface ListingCategoryNode {
  id: string
  slug: string
  name: string
  parentId: string | null
}

export interface ListingCategoryRef {
  id: string
  slug: string
  name: string
}

/** Parse fiyat params: new fiyatMin/fiyatMax take priority; legacy fiyat as fallback */
export function parsePriceParams(p: {
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

export function parseListingSearchParams(sp: ListingSearchParams): ListingFilters {
  const requestedSort = SORT_VALUES.find((value) => value === sp.siralama)
  const vitrin = sp.vitrin
  // /urunler shelves imply a sort/filter; /kategori never carries vitrin.
  const sort = requestedSort ?? (vitrin === 'favorited' ? 'favorited' : undefined)
  const priceRange = parsePriceParams({
    ...(sp.fiyatMin !== undefined ? { fiyatMin: sp.fiyatMin } : {}),
    ...(sp.fiyatMax !== undefined ? { fiyatMax: sp.fiyatMax } : {}),
    ...(sp.fiyat !== undefined ? { fiyat: sp.fiyat } : {}),
  })

  return {
    page: Math.max(1, Number(sp.sayfa ?? '1') || 1),
    ...(sort !== undefined ? { sort } : {}),
    ...priceRange,
    inStockOnly: sp.stokta === '1',
    onSaleOnly: sp.indirimli === '1' || vitrin === 'discounts',
    ...(sp.tasarimci !== undefined ? { sellerSlug: sp.tasarimci } : {}),
    ...(sp.alt !== undefined ? { subcategorySlug: sp.alt } : {}),
    ...(vitrin !== undefined ? { vitrin } : {}),
  }
}

/** Options accepted by catalogService.listPublishedCurated, minus categoryIds. */
export function buildCuratedListOptions(
  filters: ListingFilters,
  sellerId: string | undefined,
  page = filters.page,
) {
  return {
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    ...(filters.sort !== undefined ? { sortBy: filters.sort } : {}),
    ...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {}),
    ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
    ...(filters.inStockOnly ? { inStockOnly: true as const } : {}),
    ...(filters.onSaleOnly ? { onSaleOnly: true as const } : {}),
    ...(sellerId !== undefined ? { sellerId } : {}),
  }
}

/** Expand root ids to include every descendant present in `categories`. */
export function collectCategoryIds(
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

/**
 * Ids whose direct children make up the top level of the category filter.
 *
 * - `/urunler` → empty, meaning "root categories" (parentId === null)
 * - virtual collection → its member category ids
 * - regular category → the page category id
 */
export function resolveScopeParentIds(params: {
  slugParts: string[]
  allCategories: ListingCategoryNode[]
  resolvedCategoryId?: string | undefined
}): string[] {
  const { slugParts, allCategories, resolvedCategoryId } = params
  if (slugParts.length === 0) return []

  const firstSlug = slugParts[0] ?? ''
  if (slugParts.length === 1 && isVirtualCollection(firstSlug)) {
    const memberSlugs = VIRTUAL_COLLECTION_MAP[firstSlug] as readonly string[]
    return allCategories.filter((c) => memberSlugs.includes(c.slug)).map((c) => c.id)
  }

  const lastSlug = slugParts[slugParts.length - 1] ?? ''
  const categoryId =
    resolvedCategoryId ?? allCategories.find((c) => c.slug === lastSlug)?.id
  return categoryId ? [categoryId] : []
}

/**
 * Category ids the listing query runs against.
 *
 * `baseCategoryIds` is the untouched page scope (used for the seller facet, which
 * must not shrink as the shopper drills down). `categoryIds` narrows to the
 * selected `alt` subtree when one is active.
 */
export function resolveListingCategoryIds(params: {
  slugParts: string[]
  allCategories: ListingCategoryNode[]
  subcategorySlug?: string | undefined
  resolvedCategoryId?: string | undefined
}): { baseCategoryIds: string[]; categoryIds: string[] } {
  const { slugParts, allCategories, subcategorySlug } = params

  const baseCategoryIds =
    slugParts.length === 0
      ? allCategories.map((c) => c.id)
      : collectCategoryIds(
          resolveScopeParentIds({
            slugParts,
            allCategories,
            ...(params.resolvedCategoryId !== undefined
              ? { resolvedCategoryId: params.resolvedCategoryId }
              : {}),
          }),
          allCategories,
        )

  let categoryIds = baseCategoryIds
  if (subcategorySlug) {
    const sub = allCategories.find((c) => c.slug === subcategorySlug)
    if (sub) categoryIds = collectCategoryIds([sub.id], allCategories)
  }

  return { baseCategoryIds, categoryIds }
}

/**
 * Progressive category drill-down for the filter panel.
 *
 * `trail` is the path from the page scope down to the selected node (so the
 * shopper can step back up), `children` are the next level to choose from. When
 * the selected node is a leaf, `children` is empty and only the trail shows.
 */
export function resolveCategoryDrilldown(params: {
  slugParts: string[]
  allCategories: ListingCategoryNode[]
  subcategorySlug?: string | undefined
  resolvedCategoryId?: string | undefined
}): { trail: ListingCategoryRef[]; children: ListingCategoryRef[] } {
  const { allCategories, subcategorySlug } = params
  const scopeParentIds = resolveScopeParentIds({
    slugParts: params.slugParts,
    allCategories,
    ...(params.resolvedCategoryId !== undefined
      ? { resolvedCategoryId: params.resolvedCategoryId }
      : {}),
  })
  const scopeParentIdSet = new Set(scopeParentIds)

  const toRef = (c: ListingCategoryNode): ListingCategoryRef => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
  })

  const selected = subcategorySlug
    ? allCategories.find((c) => c.slug === subcategorySlug)
    : undefined

  if (!selected) {
    const children =
      params.slugParts.length === 0
        ? allCategories.filter((c) => c.parentId === null)
        : allCategories.filter((c) => c.parentId !== null && scopeParentIdSet.has(c.parentId))
    return { trail: [], children: children.map(toRef) }
  }

  const byId = new Map(allCategories.map((c) => [c.id, c]))
  const trail: ListingCategoryRef[] = []
  let current: ListingCategoryNode | undefined = selected
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    trail.unshift(toRef(current))
    const parentId: string | null = current.parentId
    if (!parentId || scopeParentIdSet.has(parentId)) break
    current = byId.get(parentId)
  }

  const children = allCategories.filter((c) => c.parentId === selected.id)
  return { trail, children: children.map(toRef) }
}

/**
 * Serialized filters the client appends `&sayfa=N` to when loading more.
 * `categoryPath` is the /kategori/... slug path; omit it for /urunler.
 */
export function buildListingQueryString(
  filters: ListingFilters,
  categoryPath?: string,
): string {
  const params = new URLSearchParams()
  if (categoryPath) params.set('kategori', categoryPath)
  if (filters.sort) params.set('siralama', filters.sort)
  if (filters.minPrice !== undefined) params.set('fiyatMin', String(filters.minPrice))
  if (filters.maxPrice !== undefined) params.set('fiyatMax', String(filters.maxPrice))
  if (filters.inStockOnly) params.set('stokta', '1')
  if (filters.onSaleOnly) params.set('indirimli', '1')
  if (filters.sellerSlug) params.set('tasarimci', filters.sellerSlug)
  if (filters.subcategorySlug) params.set('alt', filters.subcategorySlug)
  return params.toString()
}

/**
 * Upper bound on emitted crawl links. At PAGE_SIZE 20 this covers 2000 products
 * per listing, far beyond the current catalog, while keeping the markup bounded
 * for a hypothetical very large category.
 */
const MAX_SEO_PAGE_LINKS = 100

/**
 * Crawlable `?sayfa=N` hrefs for pages 2..N.
 *
 * Infinite scroll is invisible to a crawler — it does not scroll and does not
 * run the IntersectionObserver fetch. These links keep every product reachable
 * from its listing page, preserving the internal linking the SEO rules require
 * (.claude/rules/04-seo-rules.md). They are rendered visually hidden.
 */
export function buildPaginationHrefs(params: {
  basePath: string
  search: ListingSearchParams
  totalPages: number
}): Array<{ page: number; href: string }> {
  const { basePath, search, totalPages } = params
  const base = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (key === 'sayfa') continue
    if (typeof value === 'string' && value !== '') base.set(key, value)
  }

  const lastPage = Math.min(totalPages, MAX_SEO_PAGE_LINKS)
  const hrefs: Array<{ page: number; href: string }> = []
  for (let page = 2; page <= lastPage; page++) {
    const params = new URLSearchParams(base)
    params.set('sayfa', String(page))
    hrefs.push({ page, href: `${basePath}?${params.toString()}` })
  }
  return hrefs
}

export function toGridProduct(product: {
  id: string
  name: string
  slug: string
  price: { toNumber(): number } | number
  compareAtPrice?: { toNumber(): number } | number | null
  images: Array<{ url: string }>
  seller: { displayName: string; slug: string } | null
}): StorefrontGridProduct {
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
