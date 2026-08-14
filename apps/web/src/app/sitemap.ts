import type { MetadataRoute } from 'next'
import {
  homeSitemapEntry,
  categorySitemapEntry,
  productSitemapEntry,
  blogSitemapEntry,
  storeSitemapEntry,
  buildSitemapEntry,
} from '@hanuja/seo'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { PUBLIC_PRODUCT_WHERE } from '@hanuja/api/domain/product-visibility'

/**
 * Next.js sitemap route.
 * In production, category/product/store/blog slugs are fetched from the DB.
 * These static entries cover the guaranteed-indexable surfaces.
 *
 * Kategori girişleri müşteri-görünürlük kuralına tabidir: alt ağacında en az
 * bir yayınlanmış ürün olmayan kategoriler sitemap'e girmez (noindex politikası
 * ile uyumlu). Ürün yayınlandıkça kategori bir sonraki yenilemede otomatik girer.
 */

// Without this the handler is statically snapshotted at build time (no fetch /
// dynamic API in the module) and would never refresh until the next deploy.
// One-hour ISR keeps the sitemap a live, self-updating URL for Google.
export const revalidate = 0
const staticCategories = [
  'mobilya',
  'dekor',
  'aydinlatma',
  'ofis',
  'banyo',
  'mutfak',
]

const staticBlogPosts = [
  'kucuk-salon-dekorasyon-fikirleri',
  'dogal-malzemeler-ev-dekorasyonu',
  'ev-ofis-duzeni-nasil-kurulur',
  'bahar-dekorasyon-trendleri-2026',
  'minimalist-yatak-odasi-tasarimi',
  'mutfak-organizasyon-ipuclari',
]

const staticStores = [
  'atelier-noa',
  'woodform-design',
  'forma-interiors',
  'toprak-atolyesi',
]

function staticSitemap(): MetadataRoute.Sitemap {
  return [
    homeSitemapEntry(),
    buildSitemapEntry('/blog', { priority: 0.8, changeFrequency: 'daily' }),
    ...staticCategories.map((slug) => categorySitemapEntry([slug])),
    ...staticBlogPosts.map((slug) => blogSitemapEntry(slug)),
    ...staticStores.map((slug) => storeSitemapEntry(slug)),
  ]
}

type SitemapCategory = { id: string; slug: string; parentId: string | null }

/**
 * Builds the full hierarchical slug path (root → leaf) so sitemap URLs match
 * the nav's canonical form (/kategori/ev/ev-mobilya, not /kategori/ev-mobilya).
 * Ancestors of a visible category are always visible too (upward roll-up),
 * so the walk never leaves the provided map.
 */
function buildCategorySlugPath(
  category: SitemapCategory,
  categoriesById: Map<string, SitemapCategory>,
): string[] {
  const path: string[] = []
  let current: SitemapCategory | undefined = category
  const walked = new Set<string>()
  while (current && !walked.has(current.id)) {
    walked.add(current.id)
    path.unshift(current.slug)
    current = current.parentId ? categoriesById.get(current.parentId) : undefined
  }
  return path
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const prisma = createPrismaForRoute()

  try {
    const catalogSvc = createCatalogService({ prisma })
    const [categories, products, blogPosts, stores] = await Promise.all([
      catalogSvc.listCustomerVisibleCategories(),
      prisma.product.findMany({
        where: PUBLIC_PRODUCT_WHERE,
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20000,
      }),
      prisma.blogPost.findMany({
        where: { status: 'published' },
        select: { slug: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: 5000,
      }),
      prisma.seller.findMany({
        where: { status: 'active' },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      }),
    ])

    const categoriesById = new Map(categories.map((category) => [category.id, category]))

    return [
      homeSitemapEntry(),
      buildSitemapEntry('/blog', { priority: 0.8, changeFrequency: 'daily' }),
      ...categories.map((category) =>
        categorySitemapEntry(buildCategorySlugPath(category, categoriesById), category.updatedAt),
      ),
      ...products.map((product) => productSitemapEntry(product.slug, product.updatedAt)),
      ...blogPosts.map((post) => blogSitemapEntry(post.slug, post.updatedAt)),
      ...stores.map((store) => storeSitemapEntry(store.slug, store.updatedAt)),
    ]
  } catch (error) {
    console.error('[sitemap] Dynamic sitemap failed, using static fallback:', error)
    return staticSitemap()
  }
}
