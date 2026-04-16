import type { MetadataRoute } from 'next'
import { absoluteUrl } from './canonical-builder'

export type SitemapEntry = MetadataRoute.Sitemap[number]

export interface SitemapEntryOptions {
  priority?: number
  changeFrequency?: SitemapEntry['changeFrequency']
  lastModified?: Date
}

export function buildSitemapEntry(
  path: string,
  options: SitemapEntryOptions = {},
): SitemapEntry {
  return {
    url: absoluteUrl(path),
    lastModified: options.lastModified ?? new Date(),
    changeFrequency: options.changeFrequency ?? 'weekly',
    priority: options.priority ?? 0.5,
  }
}

// ── Preset builders ───────────────────────────────────────────────────────────

export function homeSitemapEntry(): SitemapEntry {
  return buildSitemapEntry('/', { priority: 1.0, changeFrequency: 'daily' })
}

export function categorySitemapEntry(slugParts: string[], lastModified?: Date): SitemapEntry {
  return buildSitemapEntry(`/kategori/${slugParts.join('/')}`, {
    priority: 0.9,
    changeFrequency: 'daily',
    ...(lastModified ? { lastModified } : {}),
  })
}

export function productSitemapEntry(slug: string, lastModified?: Date): SitemapEntry {
  return buildSitemapEntry(`/urun/${slug}`, {
    priority: 0.8,
    changeFrequency: 'weekly',
    ...(lastModified ? { lastModified } : {}),
  })
}

export function storeSitemapEntry(slug: string, lastModified?: Date): SitemapEntry {
  return buildSitemapEntry(`/magaza/${slug}`, {
    priority: 0.7,
    changeFrequency: 'weekly',
    ...(lastModified ? { lastModified } : {}),
  })
}

export function blogSitemapEntry(slug: string, lastModified?: Date): SitemapEntry {
  return buildSitemapEntry(`/blog/${slug}`, {
    priority: 0.6,
    changeFrequency: 'monthly',
    ...(lastModified ? { lastModified } : {}),
  })
}
