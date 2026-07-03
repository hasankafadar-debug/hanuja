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

/**
 * Next.js sitemap route.
 * In production, category/product/store/blog slugs are fetched from the DB.
 * These static entries cover the guaranteed-indexable surfaces.
 */
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const prisma = createPrismaForRoute()

  try {
    const [categories, products, blogPosts, stores] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
        orderBy: { sortOrder: 'asc' },
        take: 5000,
      }),
      prisma.product.findMany({
        where: { status: 'published' },
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

    return [
      homeSitemapEntry(),
      buildSitemapEntry('/blog', { priority: 0.8, changeFrequency: 'daily' }),
      ...categories.map((category) => categorySitemapEntry([category.slug], category.updatedAt)),
      ...products.map((product) => productSitemapEntry(product.slug, product.updatedAt)),
      ...blogPosts.map((post) => blogSitemapEntry(post.slug, post.updatedAt)),
      ...stores.map((store) => storeSitemapEntry(store.slug, store.updatedAt)),
    ]
  } catch (error) {
    console.error('[sitemap] Dynamic sitemap failed, using static fallback:', error)
    return staticSitemap()
  }
}
