import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { buildStoreMetadata, buildLocalBusinessStructuredData, JsonLd } from '@hanuja/seo'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import StorefrontProductGrid, { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

async function getStoreData(slug: string) {
  const prisma = createPrismaForRoute()
  const sellerRepo = createSellerRepository(prisma)
  const catalogService = createCatalogService({ prisma })

  const seller = await sellerRepo.findBySlugWithProfile(slug)
  if (!seller) return null

  const products = await catalogService.listPublished({ sellerId: seller.id, skip: 0, take: 24 })

  return { seller, products }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await getStoreData(slug)
  const name = data?.seller.displayName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return buildStoreMetadata({ name, slug })
}

export default async function StoreDetailPage({ params }: Props) {
  const { slug } = await params
  const data = await getStoreData(slug)

  if (!data) notFound()

  const { seller, products } = data
  const storeName = seller.displayName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const bio = seller.profile?.bio ?? null

  const city = seller.profile?.city ?? undefined

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
        className="h-48 w-full flex items-end"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        <div className="mx-auto w-full max-w-7xl px-4 pb-0 sm:px-6 lg:px-8">
          <div className="relative -mb-10 flex items-end gap-4">
            <div
              className="h-20 w-20 rounded-2xl border-4 flex items-center justify-center font-semibold text-xl shrink-0"
              style={{
                backgroundColor: seller.profile?.logoUrl ? undefined : 'var(--color-accent)',
                backgroundImage: seller.profile?.logoUrl ? `url(${seller.profile.logoUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderColor: 'var(--color-surface)',
                color: 'white',
              }}
            >
              {!seller.profile?.logoUrl && storeName.charAt(0)}
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
                <span>{products.length} ürün</span>
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
            <StorefrontProductGrid
              gridClassName="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4"
              products={products.map<StorefrontGridProduct>((product) => ({
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
            />
          )}
        </div>
      </div>
    </div>
  )
}
