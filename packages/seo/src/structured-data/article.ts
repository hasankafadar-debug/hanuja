import { absoluteCanonical, getBaseUrl } from '../canonical-builder'

export interface ArticleStructuredDataInput {
  title: string
  slug: string
  excerpt?: string
  publishedAt?: string
  modifiedAt?: string
  authorName?: string
  imageUrl?: string
}

export function buildArticleStructuredData(input: ArticleStructuredDataInput): object {
  const baseUrl = getBaseUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${absoluteCanonical.blog(input.slug)}#article`,
    inLanguage: 'tr-TR',
    headline: input.title,
    description: input.excerpt,
    url: absoluteCanonical.blog(input.slug),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    ...(input.modifiedAt ? { dateModified: input.modifiedAt } : {}),
    author: {
      '@type': 'Organization',
      name: input.authorName ?? 'Hanuja Editörü',
      url: `${baseUrl}/blog`,
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      name: 'Hanuja',
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/logo.svg`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': absoluteCanonical.blog(input.slug),
    },
  }
}
