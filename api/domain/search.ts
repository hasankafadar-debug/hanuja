export const PRODUCT_SEARCH_INDEX = 'products'

export const PRODUCT_SEARCH_SORT_VALUES = ['price:asc', 'price:desc', 'name:asc'] as const

export type ProductSearchSort = (typeof PRODUCT_SEARCH_SORT_VALUES)[number]

export const PRODUCT_SEARCH_ATTRIBUTES = [
  'id',
  'slug',
  'name',
  'description',
  'price',
  'categoryId',
  'categorySlug',
  'categoryName',
  'sellerId',
  'storeSlug',
  'storeName',
  'imageUrl',
  'imageUrls',
  'stock',
] as const

export const PRODUCT_SEARCH_FACETS = ['categorySlug', 'categoryName'] as const

export const PRODUCT_SEARCH_SETTINGS = {
  searchableAttributes: ['name', 'description', 'categoryName', 'storeName'],
  filterableAttributes: ['categoryId', 'categorySlug', 'sellerId', 'storeSlug', 'stock'],
  sortableAttributes: ['price', 'name'],
  faceting: {
    maxValuesPerFacet: 100,
  },
} as const

export interface ProductSearchHit {
  id: string
  slug: string
  name: string
  description: string
  price: number
  categoryId: string | null
  categorySlug: string
  categoryName: string
  sellerId: string
  storeSlug: string
  storeName: string
  imageUrl: string | null
  imageUrls?: string[]
  stock: number
}

export interface ProductSearchParams {
  q: string
  categorySlug?: string
  page?: number
  limit?: number
  sort?: ProductSearchSort
}

export interface ProductSearchResponse {
  hits: ProductSearchHit[]
  totalHits: number
  page: number
  limit: number
  totalPages: number
  facets?: Record<string, Record<string, number>>
  processingTimeMs: number
  query: string
}

export function buildProductSearchFilter(categorySlug?: string): string | undefined {
  return categorySlug ? `categorySlug = "${categorySlug}"` : undefined
}

export function mapProductSearchSortToCatalogSort(
  sort?: ProductSearchSort,
): 'newest' | 'price-asc' | 'price-desc' | 'name-asc' {
  if (sort === 'price:asc') return 'price-asc'
  if (sort === 'price:desc') return 'price-desc'
  if (sort === 'name:asc') return 'name-asc'
  return 'newest'
}

export function mapProductToSearchHit(product: {
  id: string
  slug: string
  name: string
  description: string | null
  price: { toNumber(): number } | number
  categoryId: string | null
  sellerId: string
  stockQuantity: number
  images?: Array<{ url: string }>
  category?: { slug: string; name: string } | null
  seller?: { slug: string | null; displayName: string | null } | null
}): ProductSearchHit {
  const price =
    typeof product.price === 'number'
      ? product.price
      : product.price.toNumber()

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? '',
    price,
    categoryId: product.categoryId,
    categorySlug: product.category?.slug ?? '',
    categoryName: product.category?.name ?? '',
    sellerId: product.sellerId,
    storeSlug: product.seller?.slug ?? '',
    storeName: product.seller?.displayName ?? product.seller?.slug ?? '',
    imageUrl: product.images?.[0]?.url ?? null,
    imageUrls: product.images?.map((image) => image.url).slice(0, 4) ?? [],
    stock: product.stockQuantity,
  }
}
