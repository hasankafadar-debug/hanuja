import { unstable_cache } from 'next/cache'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import {
  createHomeCmsService,
  type ActivePromo,
  type ActiveSlide,
} from '@hanuja/api/services/home-cms.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import type { ShowcaseGroup } from '@hanuja/api/domain/homepage-showcase'
import type { StorefrontGridProduct } from '@/components/storefront/storefront-product-grid'
import { createSingleFlight } from '@/lib/single-flight'

/**
 * Homepage showcase data — the one expensive computation behind `/`.
 *
 * Cached with `unstable_cache` for HOMEPAGE_SHOWCASE_REVALIDATE_SECONDS. Semantics
 * (not a freshness guarantee): the first request after the window expires triggers
 * a background refresh and is served the previous data; if the refresh fails, Next
 * logs it and keeps serving the previous data, so the window can stretch. On a cold
 * cache (right after deploy) the first request waits for the computation and any
 * concurrent requests share it via single-flight.
 *
 * Page-level ISR is deliberately NOT used: a `revalidate` export would prerender
 * `/` at build time, where the DB is unreachable, and bake an empty homepage into
 * the image (`.claude/rules/12-production-readiness.md` §4).
 *
 * Errors from the catalog/category loads are NOT swallowed here: `unstable_cache`
 * does not store a thrown result, so an outage never freezes as an "empty catalog"
 * for the whole window. The page decides how to render the failure.
 */
export const HOMEPAGE_SHOWCASE_REVALIDATE_SECONDS = 60
export const HOMEPAGE_SHOWCASE_CACHE_TAG = 'storefront-homepage'
export const HOMEPAGE_WEEKLY_FAVORITES_LIMIT = 20
export const HOMEPAGE_CAMPAIGN_DISCOUNTS_LIMIT = 25

// Each group becomes one "Öne Çıkan Ürünler" slot; slugs are DB category roots
// (see the FEATURED_CATEGORIES slug-dependency warning in the page).
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

export interface HomepageShowcaseData {
  featuredProducts: StorefrontGridProduct[]
  weeklyFavoriteProducts: StorefrontGridProduct[]
  campaignDiscountProducts: StorefrontGridProduct[]
  /** ctaHref already resolved via resolveDiscoveryHref. */
  slides: ActiveSlide[]
  topPromo: ActivePromo | null
  bottomPromo: ActivePromo | null
  /** Array (not Set) — the cached value must survive JSON serialization. */
  visibleCategorySlugs: string[]
}

type CatalogService = ReturnType<typeof createCatalogService>
type ShowcaseProductRow = Awaited<ReturnType<CatalogService['getHomepageShowcase']>>['featured'][number]

type FlatCategory = { id: string; slug: string; parentId: string | null }

function collectCategoryIds(rootIds: string[], categories: FlatCategory[]) {
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

function buildShowcaseGroups(categories: FlatCategory[]): ShowcaseGroup[] {
  return HOMEPAGE_FEATURED_GROUPS.map((group) => {
    const rootIds = categories
      .filter((category) => group.some((slug) => slug === category.slug))
      .map((category) => category.id)

    return {
      key: group.join('-'),
      categoryIds: collectCategoryIds(rootIds, categories),
    }
  }).filter((group) => group.categoryIds.length > 0)
}

function resolveDiscoveryHref(href: string, ...content: Array<string | null | undefined>) {
  const lookup = [href, ...content].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR')

  if (lookup.includes('favori')) return '/urunler?vitrin=favorited&siralama=favorited'
  if (lookup.includes('yeni')) return '/urunler?vitrin=newest&siralama=newest'
  if (lookup.includes('indirim')) return '/urunler?vitrin=discounts&indirimli=1'

  return href
}

/** Plain, JSON-safe card data — Prisma Decimal/Date must not leak into the cache. */
function toGridProduct(product: ShowcaseProductRow): StorefrontGridProduct {
  return {
    id: product.id,
    title: product.name,
    slug: product.slug,
    price: product.price.toNumber(),
    comparePrice: product.compareAtPrice?.toNumber() ?? null,
    imageUrl: product.images[0]?.url ?? null,
    imageUrls: product.images.map((image) => image.url),
    sellerName: product.seller.displayName,
    sellerSlug: product.seller.slug,
  }
}

async function computeHomepageShowcaseData(): Promise<HomepageShowcaseData> {
  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const cmsSvc = createHomeCmsService({ prisma })

  // Categories are fetched directly (not via the request-scoped React cache
  // wrapper) because this runs inside the data cache, outside a request scope.
  // Category and showcase failures propagate; CMS blocks are non-critical.
  const [allCategories, slides, topPromo, bottomPromo] = await Promise.all([
    catalogSvc.listCustomerVisibleCategories(),
    cmsSvc.getActiveSlides().catch(() => [] as ActiveSlide[]),
    cmsSvc.getActivePromo('TOP_RIGHT').catch(() => null),
    cmsSvc.getActivePromo('BOTTOM_RIGHT').catch(() => null),
  ])

  const showcase = await catalogSvc.getHomepageShowcase(buildShowcaseGroups(allCategories), {
    weeklyFavorites: HOMEPAGE_WEEKLY_FAVORITES_LIMIT,
    campaignDiscounts: HOMEPAGE_CAMPAIGN_DISCOUNTS_LIMIT,
  })

  return {
    featuredProducts: showcase.featured.map(toGridProduct),
    weeklyFavoriteProducts: showcase.weeklyFavorites.map(toGridProduct),
    campaignDiscountProducts: showcase.campaignDiscounts.map(toGridProduct),
    slides: slides.map((slide) => ({
      ...slide,
      ctaHref: resolveDiscoveryHref(slide.ctaHref, slide.title, slide.body, slide.ctaLabel),
    })),
    topPromo: topPromo
      ? { ...topPromo, ctaHref: resolveDiscoveryHref(topPromo.ctaHref, topPromo.title, topPromo.subtitle) }
      : null,
    bottomPromo: bottomPromo
      ? {
          ...bottomPromo,
          ctaHref: resolveDiscoveryHref(bottomPromo.ctaHref, bottomPromo.title, bottomPromo.subtitle),
        }
      : null,
    visibleCategorySlugs: allCategories.map((category) => category.slug),
  }
}

const computeHomepageShowcaseDataOnce = createSingleFlight(computeHomepageShowcaseData)

export const getHomepageShowcaseData = unstable_cache(
  computeHomepageShowcaseDataOnce,
  ['storefront-homepage-showcase'],
  {
    revalidate: HOMEPAGE_SHOWCASE_REVALIDATE_SECONDS,
    tags: [HOMEPAGE_SHOWCASE_CACHE_TAG],
  },
)
