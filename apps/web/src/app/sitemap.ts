import type { MetadataRoute } from 'next'
import {
  homeSitemapEntry,
  categorySitemapEntry,
  blogSitemapEntry,
  storeSitemapEntry,
  buildSitemapEntry,
} from '@hanuja/seo'

/**
 * Next.js sitemap route.
 * In production, category/product/store/blog slugs are fetched from the DB.
 * These static entries cover the guaranteed-indexable surfaces.
 */
export default function sitemap(): MetadataRoute.Sitemap {
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

  return [
    homeSitemapEntry(),
    buildSitemapEntry('/blog', { priority: 0.8, changeFrequency: 'daily' }),
    ...staticCategories.map((slug) => categorySitemapEntry([slug])),
    ...staticBlogPosts.map((slug) => blogSitemapEntry(slug)),
    ...staticStores.map((slug) => storeSitemapEntry(slug)),
  ]
}
