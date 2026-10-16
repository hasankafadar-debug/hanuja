import type { Metadata } from 'next'
import { absoluteCanonical, absoluteUrl } from './canonical-builder'

const SITE_NAME = 'Hanuja'
const SITE_TAGLINE = 'Özenle Seçilmiş Tasarımlar'
const SITE_DESCRIPTION =
  "Özenle seçilmiş tasarım ürünleri Hanuja'da. Tasarımcıların özgün ürünlerini keşfedin, güvenle sipariş verin; faturanız ve satış sonrası destek Hanuja'dan."

export interface PublicPageMetaInput {
  title: string
  description: string
  path: string
  noindex?: boolean
}

export function buildPublicPageMetadata(input: PublicPageMetaInput): Metadata {
  const url = absoluteUrl(input.path)
  const socialTitle = `${input.title} | ${SITE_NAME}`
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    ...(input.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: socialTitle,
      description: input.description,
      url,
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: socialTitle,
      description: input.description,
    },
  }
}

export function buildBlogListMetadata(page = 1): Metadata {
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1
  return buildPublicPageMetadata({
    title: currentPage === 1 ? 'Blog & İlham' : `Blog & İlham — Sayfa ${currentPage}`,
    description: 'Tasarım trendleri, ilham ve ürün fikirleri için Hanuja Blog.',
    path: currentPage === 1 ? '/blog' : `/blog?page=${currentPage}`,
  })
}

// ── Product ───────────────────────────────────────────────────────────────────

export interface ProductMetaInput {
  name: string
  description: string
  slug: string
  price?: number
  imageUrl?: string
}

export function buildProductMetadata(input: ProductMetaInput): Metadata {
  const url = absoluteCanonical.product(input.slug)
  const title = input.name
  const socialTitle = `${input.name} | ${SITE_NAME}`
  const description =
    input.description.length > 155 ? input.description.slice(0, 152) + '...' : input.description

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: socialTitle,
      description,
      url: absoluteCanonical.product(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      ...(input.imageUrl ? { images: [input.imageUrl] } : {}),
    },
  }
}

// ── Category ──────────────────────────────────────────────────────────────────

export interface CategoryMetaInput {
  label: string
  slugParts: string[]
  description?: string
  /**
   * Empty categories (no published product in the subtree) must not be
   * indexed; links stay followable so crawlers keep discovering the site.
   */
  noindex?: boolean
}

export function buildCategoryMetadata(input: CategoryMetaInput): Metadata {
  const url = absoluteCanonical.category(input.slugParts)
  const title = input.label
  const socialTitle = `${input.label} | ${SITE_NAME}`
  const description =
    input.description ??
    `Hanuja'da ${input.label.toLowerCase()} kategorisindeki tüm ürünleri keşfedin. Özenle seçilmiş tasarım ürünleri tek adreste.`

  return {
    title,
    description,
    alternates: { canonical: url },
    ...(input.noindex === true ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: socialTitle,
      description,
      url: absoluteCanonical.category(input.slugParts),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description },
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface StoreMetaInput {
  name: string
  slug: string
  description?: string
  imageUrl?: string
}

export function buildStoreMetadata(input: StoreMetaInput): Metadata {
  const url = absoluteCanonical.store(input.slug)
  const title = `${input.name} Tasarımları`
  const socialTitle = `${title} | ${SITE_NAME}`
  const description = input.description ?? `${input.name} tasarımlarını Hanuja'da keşfedin.`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: socialTitle,
      description,
      url: absoluteCanonical.store(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.name }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description },
  }
}

// ── Blog post ─────────────────────────────────────────────────────────────────

export interface BlogPostMetaInput {
  title: string
  slug: string
  excerpt?: string
  publishedAt?: string
  imageUrl?: string
  authorName?: string
}

export function buildBlogPostMetadata(input: BlogPostMetaInput): Metadata {
  const url = absoluteCanonical.blog(input.slug)
  const titleTag = input.title
  const socialTitle = `${input.title} | ${SITE_NAME} Blog`
  const description =
    input.excerpt ?? `${input.title} — Hanuja Blog'da tasarım, ilham ve ürün fikirleri.`

  return {
    title: titleTag,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: socialTitle,
      description,
      url: absoluteCanonical.blog(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'article',
      ...(input.publishedAt ? { publishedTime: input.publishedAt } : {}),
      ...(input.authorName ? { authors: [input.authorName] } : {}),
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.title }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description },
  }
}

// ── Homepage ──────────────────────────────────────────────────────────────────

export function buildHomeMetadata(): Metadata {
  return {
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    alternates: { canonical: absoluteCanonical.home() },
    openGraph: {
      title: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION,
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
    },
    twitter: { card: 'summary_large_image' },
  }
}
