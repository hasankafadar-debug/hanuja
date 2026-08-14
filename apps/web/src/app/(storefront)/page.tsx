import type { Metadata } from 'next'
import Image from 'next/image'
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
import { VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'
import FeaturedProductsCarousel from '@/components/storefront/featured-products-carousel'
import type { StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ev, Ofis & Yaşam Ürünleri',
  description:
    "Yaşam alanlarınız için seçkin mobilya, dekor, aydınlatma ve ofis ürünleri. Türkiye'nin en iyi tasarım mağazaları tek platformda.",
}

// visibilitySlugs: kartın görünürlüğünü belirleyen DB kategori slug'ları —
// alt ağacında yayınlanmış ürün olan en az bir slug varsa kart gösterilir.
// UYARI: slug'lar DB'ye string literal bağlıdır; admin panelden kök slug
// değişirse ilgili kart sessizce kaybolur (bkz. config/storefront-nav.ts).
const FEATURED_CATEGORIES: Array<{
  label: string
  description: string
  href: string
  Icon: typeof House
  visibilitySlugs: readonly string[]
}> = [
  { label: 'Ev', description: 'Eviniz için her şey', href: '/kategori/ev', Icon: House, visibilitySlugs: ['ev'] },
  { label: 'Ofis', description: 'Üretken çalışma alanları', href: '/kategori/ofis', Icon: BriefcaseBusiness, visibilitySlugs: ['ofis'] },
  { label: 'Mobilya', description: 'Masif ahşaptan modern tasarımlara', href: '/kategori/mobilya', Icon: Sofa, visibilitySlugs: VIRTUAL_COLLECTION_MAP.mobilya },
  { label: 'Mutfak & Sofra', description: 'Sofranıza zarafet katın', href: '/kategori/ev-mutfak', Icon: UtensilsCrossed, visibilitySlugs: ['ev-mutfak'] },
  { label: 'Aydınlatma', description: 'Doğru ışık, doğru atmosfer', href: '/kategori/aydinlatma', Icon: Lamp, visibilitySlugs: VIRTUAL_COLLECTION_MAP.aydinlatma },
  { label: 'Dekorasyon', description: 'Mekanınıza ruh katan objeler', href: '/kategori/ev-dekorasyon', Icon: Flower2, visibilitySlugs: ['ev-dekorasyon'] },
  { label: 'Aksesuar', description: 'Tamamlayıcı dokunuşlar', href: '/kategori/aksesuar', Icon: Package, visibilitySlugs: VIRTUAL_COLLECTION_MAP.aksesuar },
  { label: 'Tekstil', description: 'Sıcaklık ve konfor', href: '/kategori/ev-tekstil', Icon: Layers, visibilitySlugs: ['ev-tekstil'] },
]

const HOMEPAGE_FEATURED_GROUPS = [
  ['ev-mobilya', 'ofis-mobilya'],
  ['ev-aydinlatma', 'ofis-aydinlatma'],
  ['ev-aksesuar', 'ofis-aksesuar'],
  ['ev-mutfak'],
  ['ev-dekorasyon'],
  ['ev-tekstil'],
  ['ev'],
  ['ofis'],
] as const

function collectCategoryIds(
  rootIds: string[],
  categories: Array<{ id: string; slug: string; parentId: string | null }>,
) {
  const collected = new Set<string>(rootIds)
  let changed = true

  while (changed) {
    changed = false
    for (const category of categories) {
      if (category.parentId && collected.has(category.parentId) && !collected.has(category.id)) {
        collected.add(category.id)
        changed = true
      }
    }
  }

  return Array.from(collected)
}

function resolveDiscoveryHref(href: string, ...content: Array<string | null | undefined>) {
  const lookup = [href, ...content].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR')

  if (lookup.includes('favori')) return '/urunler?vitrin=favorited&siralama=favorited'
  if (lookup.includes('yeni')) return '/urunler?vitrin=newest&siralama=newest'
  if (lookup.includes('indirim')) return '/urunler?vitrin=discounts&indirimli=1'

  return href
}

type ProductRow = {
  id: string
  name: string
  slug: string
  price: { toNumber(): number } | number
  compareAtPrice?: { toNumber(): number } | number | null
  images: Array<{ url: string }>
  seller: { displayName: string; slug: string } | null
}

function toGridProduct(product: ProductRow): StorefrontGridProduct {
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
    imageUrls: product.images?.map((image) => image.url) ?? [],
    ...(product.seller
      ? { sellerName: product.seller.displayName, sellerSlug: product.seller.slug }
      : {}),
  }
}

async function getPageData() {
  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const cmsSvc = createHomeCmsService({ prisma })

  const [allCategories, slides, topPromo, bottomPromo] = await Promise.all([
    getCustomerVisibleCategories().catch(() => []),
    cmsSvc.getActiveSlides().catch(() => []),
    cmsSvc.getActivePromo('TOP_RIGHT').catch(() => null),
    cmsSvc.getActivePromo('BOTTOM_RIGHT').catch(() => null),
  ])

  const featuredGroups = HOMEPAGE_FEATURED_GROUPS.map((group) => {
    const rootIds = allCategories
      .filter((category) => group.some((slug) => slug === category.slug))
      .map((category) => category.id)

    return {
      key: group.join('-'),
      categoryIds: collectCategoryIds(rootIds, allCategories),
    }
  }).filter((group) => group.categoryIds.length > 0)

  const [featuredProducts, weeklyFavorites, campaignDiscounts] = await Promise.all([
    catalogSvc.getHomepageFeaturedProducts(featuredGroups).catch(() => []),
    catalogSvc.getWeeklyFavoriteShowcase(featuredGroups, 20).catch(() => []),
    catalogSvc.getCampaignDiscountProducts(25).catch(() => []),
  ])

  const visibleCategorySlugs = new Set(allCategories.map((category) => category.slug))

  return {
    featuredProducts,
    weeklyFavorites,
    campaignDiscounts,
    slides,
    topPromo,
    bottomPromo,
    visibleCategorySlugs,
  }
}

export default async function HomePage() {
  const {
    featuredProducts,
    weeklyFavorites,
    campaignDiscounts,
    slides,
    topPromo,
    bottomPromo,
    visibleCategorySlugs,
  } = await getPageData()
  const weeklyFavoriteProducts = (weeklyFavorites as unknown as ProductRow[]).map(toGridProduct)
  const campaignDiscountProducts = (campaignDiscounts as unknown as ProductRow[]).map(toGridProduct)
  const visibleFeaturedCategories = FEATURED_CATEGORIES.filter((cat) =>
    cat.visibilitySlugs.some((slug) => visibleCategorySlugs.has(slug)),
  )
  const heroSlides = slides.map((slide) => ({
    ...slide,
    ctaHref: resolveDiscoveryHref(slide.ctaHref, slide.title, slide.body, slide.ctaLabel),
  }))
  const resolvedTopPromo = topPromo
    ? {
        ...topPromo,
        ctaHref: resolveDiscoveryHref(topPromo.ctaHref, topPromo.title, topPromo.subtitle),
      }
    : null
  const resolvedBottomPromo = bottomPromo
    ? {
        ...bottomPromo,
        ctaHref: resolveDiscoveryHref(bottomPromo.ctaHref, bottomPromo.title, bottomPromo.subtitle),
      }
    : null
  const hasPromo = resolvedTopPromo !== null || resolvedBottomPromo !== null

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
            <HeroSlider slides={heroSlides} autoPlayMs={6000} />
          </div>

          {/* Promo column — visible only on lg+ when at least one promo exists */}
          {hasPromo && (
            <div className="hidden lg:flex lg:flex-col lg:gap-4">
              {resolvedTopPromo ? (
                <PromoCard
                  imageUrl={resolvedTopPromo.mediaAsset.url}
                  imageVariants={resolvedTopPromo.mediaAsset.variants}
                  imageAlt={resolvedTopPromo.title}
                  title={resolvedTopPromo.title}
                  subtitle={resolvedTopPromo.subtitle}
                  ctaHref={resolvedTopPromo.ctaHref}
                  priority
                />
              ) : (
                <div className="flex-1 rounded-xl" style={{ backgroundColor: 'var(--color-muted)' }} />
              )}
              {resolvedBottomPromo ? (
                <PromoCard
                  imageUrl={resolvedBottomPromo.mediaAsset.url}
                  imageVariants={resolvedBottomPromo.mediaAsset.variants}
                  imageAlt={resolvedBottomPromo.title}
                  title={resolvedBottomPromo.title}
                  subtitle={resolvedBottomPromo.subtitle}
                  ctaHref={resolvedBottomPromo.ctaHref}
                  priority
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
            <h2 className="text-3xl font-medium" style={{ fontFamily: 'var(--font-display)', color: '#3d3529' }}>
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
          {visibleFeaturedCategories.map((cat) => (
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
              {/* marginLeft: display fontundaki "Ö" glifinin optik sol boşluğunu
                  telafi eder — alt başlıkla mürekkep (ink) hizası ölçülerek bulundu. */}
              <h2
                className="text-3xl font-medium"
                style={{ fontFamily: 'var(--font-display)', color: '#3d3529', marginLeft: '-1px' }}
              >
                Öne Çıkan Ürünler
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Her kategoriden öne çıkanlar
              </p>
            </div>
            <Link
              href="/urunler"
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
            <FeaturedProductsCarousel
              products={(featuredProducts as unknown as ProductRow[]).map(toGridProduct)}
            />
          )}
        </div>
      </section>

      {/* Haftanın Favorileri — supplementary discovery section; hidden when empty */}
      {weeklyFavoriteProducts.length > 0 && (
        <section className="py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2
                  className="text-3xl font-medium"
                  style={{ fontFamily: 'var(--font-display)', color: '#3d3529', marginLeft: '-1px' }}
                >
                  Haftanın Favorileri
                </h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Bu hafta en çok favorilenen ürünler
                </p>
              </div>
              <Link
                href="/urunler?vitrin=favorited&siralama=favorited"
                className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--color-accent)' }}
              >
                Tümünü gör
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <FeaturedProductsCarousel products={weeklyFavoriteProducts} />
          </div>
        </section>
      )}

      {/* Özel Kampanyalı Ürünler — supplementary discovery section; hidden when empty */}
      {campaignDiscountProducts.length > 0 && (
        <section className="py-16" style={{ backgroundColor: 'var(--color-muted)' }}>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2
                  className="text-3xl font-medium"
                  style={{ fontFamily: 'var(--font-display)', color: '#3d3529', marginLeft: '-1px' }}
                >
                  Özel Kampanyalı Ürünler
                </h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Son 3 ayın en avantajlı kampanyaları
                </p>
              </div>
              <Link
                href="/urunler?vitrin=discounts&indirimli=1"
                className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
                style={{ color: 'var(--color-accent)' }}
              >
                Tümünü gör
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <FeaturedProductsCarousel products={campaignDiscountProducts} />
          </div>
        </section>
      )}

      {/* Editorial CTA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-16">
          <Image
            src="https://images.unsplash.com/photo-1618219908412-a29a1bb7b86e?w=1600&q=80&auto=format&fit=crop"
            alt=""
            fill
            className="object-cover scale-105 blur-sm"
            sizes="(max-width: 1280px) 100vw, 1280px"
            aria-hidden="true"
          />
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(18,14,10,0.72)' }} />
          <div className="relative z-10">
            <h2
              className="text-3xl font-medium sm:text-4xl"
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
        </div>
      </section>
    </div>
  )
}
