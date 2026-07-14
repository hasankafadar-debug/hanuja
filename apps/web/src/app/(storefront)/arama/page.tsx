import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumb, Button, Input } from '@hanuja/ui'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import {
  PRODUCT_SEARCH_SORT_VALUES,
  type ProductSearchResponse,
  type ProductSearchSort,
} from '@hanuja/api/domain/search'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSearchService } from '@hanuja/api/services/search.service'
import StorefrontProductGrid, { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

interface Props {
  searchParams: Promise<Record<string, string>>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const q = params.q ?? ''
  return {
    title: q ? `"${q}" için arama sonuçları` : 'Ürün Ara',
    description: q
      ? `"${q}" arama sonuçları. Hanuja'da binlerce ürün arasından en iyisini bul.`
      : "Hanuja'da ürün ara.",
    robots: { index: false },
  }
}

const LIMIT = 20

const SORT_OPTIONS = [
  { value: '', label: 'Önerilen' },
  { value: 'price:asc', label: 'Fiyat: Düşükten Yükseğe' },
  { value: 'price:desc', label: 'Fiyat: Yüksekten Düşüğe' },
  { value: 'name:asc', label: 'İsim: A-Z' },
] as const satisfies ReadonlyArray<{ value: '' | ProductSearchSort; label: string }>

function isProductSearchSort(value: string | undefined): value is ProductSearchSort {
  return Boolean(value && PRODUCT_SEARCH_SORT_VALUES.includes(value as ProductSearchSort))
}

async function fetchSearchResults(
  params: Record<string, string>,
): Promise<ProductSearchResponse | null> {
  const q = params.q?.trim()
  if (!q) return null

  try {
    const service = createSearchService({ prisma: createPrismaForRoute() })
    return await service.searchProducts({
      q,
      ...(params.categorySlug ? { categorySlug: params.categorySlug } : {}),
      page: Math.max(1, Number(params.page ?? 1)),
      limit: LIMIT,
      ...(isProductSearchSort(params.sort) ? { sort: params.sort } : {}),
    })
  } catch {
    return null
  }
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams
  const q = params.q ?? ''
  const currentSort = params.sort ?? ''
  const currentCategory = params.categorySlug ?? ''

  const results = await fetchSearchResults(params)

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Breadcrumb
          items={[
            { label: 'Ana Sayfa', href: '/' },
            { label: 'Arama', href: '/arama' },
            ...(q ? [{ label: `"${q}"` }] : []),
          ]}
          className="mb-6"
        />

        <div className="mb-8">
          <form method="GET" action="/arama" className="flex max-w-2xl gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Ne aramak istiyorsunuz?"
                className="pl-10"
              />
            </div>
            <Button type="submit">Ara</Button>
          </form>
        </div>

        {!q && (
          <div className="py-20 text-center text-muted-foreground">
            <Search className="mx-auto mb-4 h-12 w-12 opacity-30" />
            <p className="text-lg">Aramak istediğiniz ürünü yazın</p>
          </div>
        )}

        {q && !results && (
          <div className="py-20 text-center text-muted-foreground">
            <p>Arama sırasında bir hata oluştu. Lütfen tekrar deneyin.</p>
          </div>
        )}

        {results && (
          <div className="flex gap-8">
            {results.facets && Object.keys(results.facets).length > 0 && (
              <aside className="hidden w-56 flex-shrink-0 lg:block">
                <div className="sticky top-4">
                  <div className="mb-4 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="text-sm font-medium">Filtrele</span>
                  </div>

                  {results.facets.categorySlug && (
                    <div className="mb-6">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Kategori
                      </p>
                      <ul className="space-y-1">
                        {Object.entries(results.facets.categorySlug).map(([slug, count]) => {
                          const isActive = currentCategory === slug
                          const href = isActive
                            ? buildSearchUrl(q, { ...params, categorySlug: undefined })
                            : buildSearchUrl(q, { ...params, categorySlug: slug, page: undefined })
                          return (
                            <li key={slug}>
                              <Link
                                href={href}
                                className={`flex items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                                  isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'
                                }`}
                              >
                                <span className="truncate">{slug.replace(/-/g, ' ')}</span>
                                <span className="ml-1 text-xs opacity-70">{count}</span>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </aside>
            )}

            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  {results.totalHits > 0 ? (
                    <>
                      <span className="font-medium text-foreground">{results.totalHits}</span>{' '}
                      sonuç bulundu
                      {q && (
                        <>
                          {' '}
                          &ldquo;<span className="font-medium text-foreground">{q}</span>&rdquo; için
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      &ldquo;<span className="font-medium">{q}</span>&rdquo; için sonuç bulunamadı
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {currentCategory && (
                    <Link
                      href={buildSearchUrl(q, { ...params, categorySlug: undefined })}
                      className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
                    >
                      {currentCategory.replace(/-/g, ' ')}
                      <X className="h-3 w-3" />
                    </Link>
                  )}
                  <form method="GET" action="/arama" className="flex items-center gap-1">
                    <input type="hidden" name="q" value={q} />
                    {currentCategory && (
                      <input type="hidden" name="categorySlug" value={currentCategory} />
                    )}
                    <select
                      name="sort"
                      defaultValue={currentSort}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline" size="sm">
                      Uygula
                    </Button>
                  </form>
                </div>
              </div>

              {results.totalHits === 0 && (
                <div className="py-20 text-center">
                  <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-30" />
                  <p className="mb-2 text-lg font-medium">Sonuç bulunamadı</p>
                  <p className="mb-6 text-sm text-muted-foreground">
                    Farklı anahtar kelimeler deneyin veya filtreleri kaldırın
                  </p>
                  {currentCategory && (
                    <Button variant="outline" asChild>
                      <Link href={buildSearchUrl(q, { q })}>Filtreyi kaldır</Link>
                    </Button>
                  )}
                </div>
              )}

              {results.hits.length > 0 && (
                <>
                  <StorefrontProductGrid
                    gridClassName="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
                    products={results.hits.map<StorefrontGridProduct>((hit) => ({
                      id: hit.id,
                      title: hit.name,
                      slug: hit.slug,
                      price: hit.price,
                      imageUrl: hit.imageUrl,
                      imageUrls: hit.imageUrls ?? [],
                      sellerName: hit.storeName,
                      sellerSlug: hit.storeSlug,
                    }))}
                  />

                  {results.totalPages > 1 && (
                    <div className="mt-8 flex justify-center gap-2">
                      {results.page > 1 && (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={buildSearchUrl(q, {
                              ...params,
                              page: String(results.page - 1),
                            })}
                          >
                            Önceki
                          </Link>
                        </Button>
                      )}

                      {Array.from({ length: Math.min(results.totalPages, 5) }, (_, i) => {
                        const pageNum = i + 1
                        const isActive = pageNum === results.page
                        return (
                          <Button
                            key={pageNum}
                            variant={isActive ? 'default' : 'outline'}
                            size="sm"
                            asChild
                          >
                            <Link href={buildSearchUrl(q, { ...params, page: String(pageNum) })}>
                              {pageNum}
                            </Link>
                          </Button>
                        )
                      })}

                      {results.page < results.totalPages && (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={buildSearchUrl(q, {
                              ...params,
                              page: String(results.page + 1),
                            })}
                          >
                            Sonraki
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function buildSearchUrl(q: string, params: Record<string, string | undefined>): string {
  const url = new URL('/arama', 'http://x')
  if (q) url.searchParams.set('q', q)
  for (const [key, val] of Object.entries(params)) {
    if (key === 'q') continue
    if (val) url.searchParams.set(key, val)
  }
  return url.pathname + (url.search ? url.search : '')
}
