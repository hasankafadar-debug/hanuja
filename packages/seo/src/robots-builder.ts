import type { MetadataRoute } from 'next'

export function buildRobotsConfig(sitemapUrl: string): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/hesabim/',
          '/sepet',
          '/odeme',
          '/siparis/',
          '/arama',
          '/api/',
        ],
      },
    ],
    sitemap: sitemapUrl,
  }
}
