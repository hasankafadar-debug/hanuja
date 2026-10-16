import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildBlogListMetadata,
  buildPublicPageMetadata,
} from '../../packages/seo/src/metadata-builder'
import {
  buildOrganizationStructuredData,
  buildWebsiteStructuredData,
} from '../../packages/seo/src/structured-data/organization'
import { buildArticleStructuredData } from '../../packages/seo/src/structured-data/article'
import { buildDesignerStructuredData } from '../../packages/seo/src/structured-data/designer'
import { buildProductStructuredData } from '../../packages/seo/src/structured-data/product'
import { buildSitemapEntry } from '../../packages/seo/src/sitemap-builder'
import { buildRobotsConfig } from '../../packages/seo/src/robots-builder'

afterEach(() => vi.unstubAllEnvs())

describe('public storefront SEO contracts', () => {
  it('keeps canonical and social URLs on the specific public page', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
    for (const path of ['/', '/blog', '/hakkimizda', '/iletisim', '/magaza', '/kategori']) {
      const metadata = buildPublicPageMetadata({
        path,
        title: 'Başlık',
        description: 'Açıklama',
      })
      expect(metadata.alternates?.canonical).toBe(`https://www.hanuja.com.tr${path}`)
      expect(metadata.openGraph).toMatchObject({
        url: `https://www.hanuja.com.tr${path}`,
      })
    }
  })

  it('gives paginated blog pages their own canonical and normalizes invalid page numbers', () => {
    expect(buildBlogListMetadata(2).alternates?.canonical).toMatch(/\/blog\?page=2$/)
    for (const page of [1, 0, -1, 1.5, NaN, Infinity]) {
      expect(buildBlogListMetadata(page).alternates?.canonical).toMatch(/\/blog$/)
    }
  })

  it('keeps empty categories followable without making them indexable', () => {
    const metadata = buildPublicPageMetadata({
      path: '/kategori',
      title: 'Kategoriler',
      description: 'Kategoriler',
      noindex: true,
    })
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('never manufactures a sitemap modification time', () => {
    expect(buildSitemapEntry('/')).not.toHaveProperty('lastModified')
    const date = new Date('2026-06-08T10:00:00Z')
    expect(buildSitemapEntry('/blog/rehber', { lastModified: date }).lastModified).toEqual(date)
  })

  it('connects website and article publisher identity to the same real brand', () => {
    const organization = buildOrganizationStructuredData({
      legalName: 'Şirket',
      email: 'admin@hanuja.com.tr',
    }) as Record<string, unknown>
    const website = buildWebsiteStructuredData() as {
      publisher: { '@id': string }
    }
    const article = buildArticleStructuredData({
      title: 'Rehber',
      slug: 'rehber',
      publishedAt: '2026-06-08T10:00:00Z',
      modifiedAt: '2026-10-16T10:00:00Z',
    }) as Record<string, any>
    expect(website.publisher['@id']).toBe(organization['@id'])
    expect(article.publisher['@id']).toBe(organization['@id'])
    expect(article.publisher.logo.url).toBe(organization.logo)
    expect(article.publisher.logo.url).toMatch(/\/logo\.svg$/)
    expect(article.datePublished).toBe('2026-06-08T10:00:00Z')
    expect(article.dateModified).toBe('2026-10-16T10:00:00Z')
    expect(buildArticleStructuredData({ title: 'Rehber', slug: 'rehber' })).not.toHaveProperty(
      'datePublished',
    )
  })

  it('describes designers as profiles while Hanuja remains the product seller', () => {
    const designer = buildDesignerStructuredData({
      name: 'Mosaiss',
      slug: 'mosaiss',
    }) as Record<string, any>
    expect(designer['@type']).toBe('ProfilePage')
    expect(designer.mainEntity).toMatchObject({
      '@type': 'Organization',
      name: 'Mosaiss',
    })
    expect(designer).not.toHaveProperty('offers')
    const product = buildProductStructuredData({
      name: 'Masa',
      slug: 'masa',
      description: 'Ahşap masa',
      price: 100,
      availability: 'InStock',
    }) as Record<string, any>
    expect(product.offers.seller.name).toBe('Hanuja')
  })

  it('allows public search crawlers while keeping private paths disallowed', () => {
    const robots = buildRobotsConfig('https://www.hanuja.com.tr/sitemap.xml') as {
      rules: { userAgent: string; allow: string; disallow: string[] }[]
    }
    const general = robots.rules.find((rule) => rule.userAgent === '*')!
    expect(general.allow).toBe('/')
    expect(general.disallow).toEqual(expect.arrayContaining(['/hesabim/', '/api/', '/odeme']))
  })
})
