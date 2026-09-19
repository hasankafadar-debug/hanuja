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
import { VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import FeaturedProductsCarousel from '@/components/storefront/featured-products-carousel'
import { getHomepageShowcaseData, type HomepageShowcaseData } from '@/lib/homepage-showcase-data'

// Stays dynamic on purpose: a `revalidate` export would prerender this page at
// build time (DB unreachable in the Coolify build) and bake an empty homepage
// into the image. Freshness/cost is handled by the 60 s data cache in
// `@/lib/homepage-showcase-data` instead — see that module's header.
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

// Rendered when the showcase data could not be loaded at all (DB outage on a cold
// cache). Deliberately distinct from the genuinely-empty-catalog copy below so an
// incident never reads as "no products yet".
const EMPTY_SHOWCASE_DATA: HomepageShowcaseData = {
  featuredProducts: [],
  weeklyFavoriteProducts: [],
  campaignDiscountProducts: [],
  slides: [],
  topPromo: null,
  bottomPromo: null,
  visibleCategorySlugs: [],
}

async function loadHomepageShowcase(): Promise<{
  data: HomepageShowcaseData
  showcaseUnavailable: boolean
}> {
  try {
    return { data: await getHomepageShowcaseData(), showcaseUnavailable: false }
  } catch (error) {
    // Not cached — only this request degrades; the next one retries the load.
    console.error('[storefront] homepage showcase load failed', error)
    return { data: EMPTY_SHOWCASE_DATA, showcaseUnavailable: true }
  }
}

export default async function HomePage() {
  const {
    data: {
      featuredProducts,
      weeklyFavoriteProducts,
      campaignDiscountProducts,
      slides: heroSlides,
      topPromo: resolvedTopPromo,
      bottomPromo: resolvedBottomPromo,
      visibleCategorySlugs,
    },
    showcaseUnavailable,
  } = await loadHomepageShowcase()
  const visibleCategorySlugSet = new Set(visibleCategorySlugs)
  const visibleFeaturedCategories = FEATURED_CATEGORIES.filter((cat) =>
    cat.visibilitySlugs.some((slug) => visibleCategorySlugSet.has(slug)),
  )
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

          {showcaseUnavailable ? (
            <p
              role="status"
              className="text-center text-sm py-10"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              Ürünler şu anda yüklenemiyor. Lütfen kısa süre sonra tekrar deneyin.
            </p>
          ) : featuredProducts.length === 0 ? (
            <p className="text-center text-sm py-10" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz ürün eklenmemiş.
            </p>
          ) : (
            <FeaturedProductsCarousel products={featuredProducts} />
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
