import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { buildStoreMetadata, buildLocalBusinessStructuredData, JsonLd } from '@hanuja/seo'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { normalizeMediaDisplayUrl } from '@hanuja/ui'
import { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'
import StoreProductsInfiniteGrid from '@/components/storefront/store-products-infinite-grid'

export const dynamic = 'force-dynamic'

const FONT_SIZE_MAP: Record<string, string> = {
  sm: '0.875rem',
  md: '1.125rem',
  lg: '1.5rem',
  xl: '2rem',
}

interface Props {
  params: Promise<{ slug: string }>
}

async function getStoreData(slug: string) {
  const prisma = createPrismaForRoute()
  const sellerRepo = createSellerRepository(prisma)
  const catalogService = createCatalogService({ prisma })

  const seller = await sellerRepo.findBySlugWithProfile(slug)
  if (!seller) return null

  const result = await catalogService.listPublishedWithCursor({ sellerId: seller.id, take: 20 })

  return { seller, products: result.items, nextCursor: result.nextCursor }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await getStoreData(slug)
  const name = data?.seller.displayName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const profile = data?.seller.profile
  const ogImage = profile?.bannerUrl ?? profile?.logoUrl ?? undefined
  return buildStoreMetadata({ name, slug, ...(ogImage ? { imageUrl: ogImage } : {}) })
}

export default async function StoreDetailPage({ params }: Props) {
  const { slug } = await params
  const data = await getStoreData(slug)

  if (!data) notFound()

  const { seller, products, nextCursor } = data
  const storeName = seller.displayName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const bio = seller.profile?.bio ?? null
  const city = seller.profile?.city ?? undefined
  const profile = seller.profile
  const bannerUrl = profile?.bannerUrl ? normalizeMediaDisplayUrl(profile.bannerUrl) : null
  const logoUrl = profile?.logoUrl ? normalizeMediaDisplayUrl(profile.logoUrl) : null

  // Banner stil — öncelik: resim > renk > platform default
  const bannerStyle: React.CSSProperties = bannerUrl
    ? {
        backgroundImage: `url("${bannerUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: profile?.bannerColor ?? 'var(--color-primary)' }

  const storeJsonLd = buildLocalBusinessStructuredData({
    name: storeName,
    slug,
    ...(bio ? { description: bio } : {}),
    ...(city !== undefined ? { city } : {}),
  })

  return (
    <div>
      <JsonLd data={storeJsonLd} />
      {/* Store banner */}
      <div
        className="h-48 w-full flex items-end relative"
        style={bannerStyle}
      >
        {/* Banner üzerinde metin — yalnızca renk modunda gösterilir */}
        {profile?.bannerHeadline && !bannerUrl && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <p
              className="text-center font-semibold"
              style={{
                color: profile.bannerTextColor ?? '#ffffff',
                fontSize: FONT_SIZE_MAP[profile.bannerHeadlineFontSize ?? 'md'] ?? '1.125rem',
              }}
            >
              {profile.bannerHeadline}
            </p>
          </div>
        )}

        <div className="mx-auto w-full max-w-7xl px-4 pb-0 sm:px-6 lg:px-8">
          <div className="relative -mb-10 flex items-end gap-4">
            <div
              className="h-20 w-20 rounded-2xl border-4 flex items-center justify-center font-semibold text-xl shrink-0"
              style={{
                backgroundColor: logoUrl ? undefined : 'var(--color-accent)',
                backgroundImage: logoUrl ? `url("${logoUrl}")` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderColor: 'var(--color-surface)',
                color: 'white',
              }}
            >
              {!logoUrl && storeName.charAt(0)}
            </div>
          </div>
        </div>
      </div>

      {/* Store info */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="pt-14 pb-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1
                className="text-2xl font-semibold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
              >
                {storeName}
              </h1>
              <div className="mt-1 flex items-center gap-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {city && (
                  <>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {city}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{products.length}{nextCursor ? '+' : ''} ürün</span>
              </div>
            </div>
          </div>
          {bio && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {bio}
            </p>
          )}
        </div>

        {/* Products grid */}
        <div className="pb-16">
          <h2 className="mb-6 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ürünler
          </h2>
          {products.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Bu mağazada henüz ürün bulunmuyor.
            </p>
          ) : (
            <StoreProductsInfiniteGrid
              initialProducts={products.map<StorefrontGridProduct>((product) => ({
                id: product.id,
                title: product.name,
                slug: product.slug,
                price: Number(product.price),
                comparePrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
                imageUrl: (product.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null,
                imageUrls: ((product.images as Array<{ url: string }> | undefined) ?? []).map((image) => image.url),
                sellerName: storeName,
                sellerSlug: slug,
              }))}
              initialCursor={nextCursor}
              sellerSlug={slug}
            />
          )}
        </div>
      </div>
    </div>
  )
}
