import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Breadcrumb, Button, Input } from '@hanuja/ui'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { searchIndex } from '@hanuja/api/lib/meilisearch'

interface Props {
  searchParams: Promise<Record<string, string>>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const q = params.q ?? ''
  return {
    title: q ? `"${q}" için arama sonuçları — Hanuja` : 'Ürün Ara — Hanuja',
    description: q
      ? `"${q}" arama sonuçları. Hanuja'da binlerce ürün arasından en iyisini bul.`
      : "Hanuja'da ürün ara.",
    robots: { index: false },
  }
}

interface SearchHit {
  id: string
  slug: string
  name: string
  price: number
  categoryName: string
  categorySlug: string
  storeSlug: string
  storeName: string
  imageUrl: string | null
  stock: number
}

interface SearchResponse {
  hits: SearchHit[]
  totalHits: number
  page: number
  limit: number
  totalPages: number
  facets?: Record<string, Record<string, number>>
  processingTimeMs: number
  query: string
}

const LIMIT = 20

const SORT_OPTIONS = [
  { value: '', label: 'Önerilen' },
  { value: 'price:asc', label: 'Fiyat: Düşükten Yükseğe' },
  { value: 'price:desc', label: 'Fiyat: Yüksekten Düşüğe' },
  { value: 'name:asc', label: 'İsim: A-Z' },
]

async function fetchSearchResults(params: Record<string, string>): Promise<SearchResponse | null> {
  const q = params.q?.trim()
  if (!q) return null

  const page = Math.max(1, Number(params.page ?? 1))
  const offset = (page - 1) * LIMIT
  const filter = params.categorySlug ? `categorySlug = "${params.categorySlug}"` : undefined
  const sort = params.sort && params.sort !== '' ? [params.sort] : undefined

  try {
    const result = await searchIndex<SearchHit>({
      indexName: 'products',
      q,
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
      limit: LIMIT,
      offset,
      facets: ['categorySlug', 'categoryName'],
      attributesToRetrieve: [
        'id', 'slug', 'name', 'price',
        'categoryName', 'categorySlug',
        'storeSlug', 'storeName',
        'imageUrl', 'stock',
      ],
    })

    return {
      hits: result.hits,
      totalHits: result.totalHits,
      page,
      limit: LIMIT,
      totalPages: Math.ceil(result.totalHits / LIMIT),
      ...(result.facetDistribution ? { facets: result.facetDistribution } : {}),
      processingTimeMs: result.processingTimeMs,
      query: q,
    }
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
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: 'Ana Sayfa', href: '/' },
            { label: 'Arama', href: '/arama' },
            ...(q ? [{ label: `"${q}"` }] : []),
          ]}
          className="mb-6"
        />

        {/* Search Bar */}
        <div className="mb-8">
          <form method="GET" action="/arama" className="flex gap-2 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
          <div className="text-center py-20 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Aramak istediğiniz ürünü yazın</p>
          </div>
        )}

        {q && !results && (
          <div className="text-center py-20 text-muted-foreground">
            <p>Arama sırasında bir hata oluştu. Lütfen tekrar deneyin.</p>
          </div>
        )}

        {results && (
          <div className="flex gap-8">
            {/* Facets / Filters Sidebar */}
            {results.facets && Object.keys(results.facets).length > 0 && (
              <aside className="w-56 flex-shrink-0 hidden lg:block">
                <div className="sticky top-4">
                  <div className="flex items-center gap-2 mb-4">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="font-medium text-sm">Filtrele</span>
                  </div>

                  {results.facets.categorySlug && (
                    <div className="mb-6">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                                className={`flex items-center justify-between text-sm py-1 px-2 rounded transition-colors ${
                                  isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted'
                                }`}
                              >
                                <span className="truncate">{slug.replace(/-/g, ' ')}</span>
                                <span className="text-xs opacity-70 ml-1">{count}</span>
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

            {/* Results */}
            <div className="flex-1 min-w-0">
              {/* Results header */}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
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

                {/* Sort */}
                <div className="flex items-center gap-2">
                  {currentCategory && (
                    <Link
                      href={buildSearchUrl(q, { ...params, categorySlug: undefined })}
                      className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
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
                      onChange={(e) => (e.target.form as HTMLFormElement)?.submit()}
                      className="text-xs border border-border rounded px-2 py-1 bg-background"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </form>
                </div>
              </div>

              {/* Empty state */}
              {results.totalHits === 0 && (
                <div className="text-center py-20">
                  <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                  <p className="text-lg font-medium mb-2">Sonuç bulunamadı</p>
                  <p className="text-muted-foreground text-sm mb-6">
                    Farklı anahtar kelimeler deneyin veya filtreleri kaldırın
                  </p>
                  {currentCategory && (
                    <Button variant="outline" asChild>
                      <Link href={buildSearchUrl(q, { q })}>Filtreyi kaldır</Link>
                    </Button>
                  )}
                </div>
              )}

              {/* Product Grid */}
              {results.hits.length > 0 && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {results.hits.map((hit) => (
                      <SearchProductCard key={hit.id} hit={hit} />
                    ))}
                  </div>

                  {/* Pagination */}
                  {results.totalPages > 1 && (
                    <div className="flex justify-center gap-2 mt-8">
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

function SearchProductCard({ hit }: { hit: SearchHit }) {
  const isOutOfStock = hit.stock === 0
  return (
    <Link href={`/urun/${hit.slug}`} className="group block">
      <div className="aspect-square bg-muted rounded-lg overflow-hidden mb-3">
        {hit.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.imageUrl}
            alt={hit.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <span className="text-xs">Görsel yok</span>
          </div>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-0.5 truncate">{hit.storeName}</p>
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
          {hit.name}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-base font-semibold">
            {hit.price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}
          </span>
          {isOutOfStock && (
            <Badge variant="secondary" className="text-xs">
              Stok yok
            </Badge>
          )}
        </div>
      </div>
    </Link>
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
