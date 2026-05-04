import type { Metadata } from 'next'
import Link from 'next/link'
import { HeroSlider, PromoCard } from '@hanuja/ui'
import {
  ArrowRight,
  Sofa,
  Lamp,
  Flower2,
  BriefcaseBusiness,
  House,
  UtensilsCrossed,
  Package,
  Layers,
} from 'lucide-react'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createHomeCmsService } from '@hanuja/api/services/home-cms.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import StorefrontProductGrid, { type StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Hanuja — Ev, Ofis & Yaşam Ürünleri',
  description:
    "Yaşam alanlarınız için seçkin mobilya, dekor, aydınlatma ve ofis ürünleri. Türkiye'nin en iyi tasarım mağazaları tek platformda.",
}

const FEATURED_CATEGORIES = [
  { label: 'Ev', description: 'Eviniz için her şey', href: '/kategori/ev', Icon: House },
  { label: 'Ofis', description: 'Üretken çalışma alanları', href: '/kategori/ofis', Icon: BriefcaseBusiness },
  { label: 'Mobilya', description: 'Masif ahşaptan modern tasarımlara', href: '/kategori/mobilya', Icon: Sofa },
  { label: 'Mutfak & Sofra', description: 'Sofranıza zarafet katın', href: '/kategori/ev-mutfak', Icon: UtensilsCrossed },
  { label: 'Aydınlatma', description: 'Doğru ışık, doğru atmosfer', href: '/kategori/aydinlatma', Icon: Lamp },
  { label: 'Dekorasyon', description: 'Mekanınıza ruh katan objeler', href: '/kategori/ev-dekorasyon', Icon: Flower2 },
  { label: 'Aksesuar', description: 'Tamamlayıcı dokunuşlar', href: '/kategori/aksesuar', Icon: Package },
  { label: 'Tekstil', description: 'Sıcaklık ve konfor', href: '/kategori/ev-tekstil', Icon: Layers },
]

type ProductRow = {
  id: string
  name: string
  slug: string
  price: { toNumber(): number } | number
  compareAtPrice?: { toNumber(): number } | number | null
  images: Array<{ url: string }>
  seller: { displayName: string; slug: string } | null
}

async function getPageData() {
  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const cmsSvc = createHomeCmsService({ prisma })

  const [featuredProducts, slides, topPromo, bottomPromo] = await Promise.all([
    catalogSvc.listPublished({ skip: 0, take: 8 }).catch(() => []),
    cmsSvc.getActiveSlides().catch(() => []),
    cmsSvc.getActivePromo('TOP_RIGHT').catch(() => null),
    cmsSvc.getActivePromo('BOTTOM_RIGHT').catch(() => null),
  ])

  return { featuredProducts, slides, topPromo, bottomPromo }
}

export default async function HomePage() {
  const { featuredProducts, slides, topPromo, bottomPromo } = await getPageData()
  const hasPromo = topPromo !== null || bottomPromo !== null

  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Hero — slider 2/3 + promo column 1/3 */}
      <section className="mx-auto max-w-7xl px-4 pt-6 pb-4 sm:px-6 lg:px-8">
        <div
          className={`grid gap-4 ${hasPromo ? 'lg:grid-cols-3' : 'grid-cols-1'}`}
          style={{ height: '480px' }}
        >
          {/* Slider — takes 2/3 on desktop when promos present */}
          <div className={hasPromo ? 'lg:col-span-2' : ''}>
            <HeroSlider slides={slides} autoPlayMs={6000} />
          </div>

          {/* Promo column — visible only on lg+ when at least one promo exists */}
          {hasPromo && (
            <div className="hidden lg:flex lg:flex-col lg:gap-4">
              {topPromo ? (
                <PromoCard
                  imageUrl={topPromo.mediaAsset.url}
                  imageVariants={topPromo.mediaAsset.variants}
                  imageAlt={topPromo.title}
                  title={topPromo.title}
                  subtitle={topPromo.subtitle}
                  ctaHref={topPromo.ctaHref}
                />
              ) : (
                <div className="flex-1 rounded-xl" style={{ backgroundColor: 'var(--color-muted)' }} />
              )}
              {bottomPromo ? (
                <PromoCard
                  imageUrl={bottomPromo.mediaAsset.url}
                  imageVariants={bottomPromo.mediaAsset.variants}
                  imageAlt={bottomPromo.title}
                  title={bottomPromo.title}
                  subtitle={bottomPromo.subtitle}
                  ctaHref={bottomPromo.ctaHref}
                />
              ) : (
                <div className="flex-1 rounded-xl" style={{ backgroundColor: 'var(--color-muted)' }} />
              )}
            </div>
          )}
        </div>
      </section>

      {/* Featured Categories */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
              Kategoriler
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              İhtiyacınıza göre keşfetmeye başlayın
            </p>
          </div>
          <Link
            href="/kategori"
            className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--color-accent)' }}
          >
            Tüm kategoriler
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {FEATURED_CATEGORIES.map((cat) => (
            <Link
              key={cat.href}
              href={cat.href}
              className="group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-shadow hover:shadow-md"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full transition-colors group-hover:bg-[var(--color-accent)]"
                style={{ backgroundColor: 'var(--color-muted)' }}
              >
                <cat.Icon
                  className="h-6 w-6 transition-colors group-hover:text-white"
                  style={{ color: 'var(--color-primary)' }}
                />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{cat.label}</p>
                <p className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--color-muted-fg)' }}>{cat.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-16" style={{ backgroundColor: 'var(--color-muted)' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex items-end justify-between">
            <div>
              <h2
                className="text-3xl font-bold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
              >
                Öne Çıkan Ürünler
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Editörlerimizin seçtikleri
              </p>
            </div>
            <Link
              href="/kategori"
              className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: 'var(--color-accent)' }}
            >
              Tümünü gör
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {featuredProducts.length === 0 ? (
            <p className="text-center text-sm py-10" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz ürün eklenmemiş.
            </p>
          ) : (
            <StorefrontProductGrid
              products={(featuredProducts as unknown as ProductRow[]).map<StorefrontGridProduct>((product) => ({
                id: product.id,
                title: product.name,
                slug: product.slug,
                price: typeof product.price === 'object' ? product.price.toNumber() : Number(product.price),
                comparePrice:
                  product.compareAtPrice && typeof product.compareAtPrice === 'object'
                    ? product.compareAtPrice.toNumber()
                    : (product.compareAtPrice ?? null),
                imageUrl: product.images?.[0]?.url ?? null,
                imageUrls: product.images?.map((image) => image.url) ?? [],
                ...(product.seller
                  ? { sellerName: product.seller.displayName, sellerSlug: product.seller.slug }
                  : {}),
              }))}
            />
          )}
        </div>
      </section>

      {/* Editorial CTA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div
          className="rounded-2xl px-8 py-14 text-center sm:px-16"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <h2
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-fg)' }}
          >
            Evi Sıfırdan mı Döşüyorsunuz?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Uzman içeriklerimiz ve ilham veren rehberlerimizle doğru ürünleri daha kolay bulun. Mobilyadan
            aydınlatmaya her şey için fikirler blog&apos;da sizi bekliyor.
          </p>
          <Link
            href="/blog"
            className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
          >
            Blog&apos;u Keşfet
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
