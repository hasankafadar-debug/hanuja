import type { Metadata } from 'next'
import { absoluteCanonical } from './canonical-builder'

const SITE_NAME = 'Hanuja'
const SITE_DESCRIPTION = "Türkiye'nin ev, ofis ve yaşam ürünleri marketplace'i."

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
  const title = `${input.name} | ${SITE_NAME}`
  const description =
    input.description.length > 155
      ? input.description.slice(0, 152) + '...'
      : input.description

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url: absoluteCanonical.product(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.name }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
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
}

export function buildCategoryMetadata(input: CategoryMetaInput): Metadata {
  const url = absoluteCanonical.category(input.slugParts)
  const title = `${input.label} | ${SITE_NAME}`
  const description =
    input.description ??
    `Hanuja'da ${input.label.toLowerCase()} kategorisindeki tüm ürünleri keşfedin. Türkiye'nin en iyi tasarım mağazalarından seçkin ürünler.`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url: absoluteCanonical.category(input.slugParts),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description },
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
  const title = `${input.name} Mağazası | ${SITE_NAME}`
  const description =
    input.description ?? `${input.name} mağazasının tüm ürünleri Hanuja'da.`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url: absoluteCanonical.store(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.name }] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
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
  const titleTag = `${input.title} | ${SITE_NAME} Blog`
  const description =
    input.excerpt ?? `${input.title} — Hanuja Blog'da ev dekorasyonu ve yaşam alanı fikirleri.`

  return {
    title: titleTag,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: titleTag,
      description,
      url: absoluteCanonical.blog(input.slug),
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'article',
      ...(input.publishedAt ? { publishedTime: input.publishedAt } : {}),
      ...(input.authorName ? { authors: [input.authorName] } : {}),
      ...(input.imageUrl ? { images: [{ url: input.imageUrl, alt: input.title }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: titleTag, description },
  }
}

// ── Homepage ──────────────────────────────────────────────────────────────────

export function buildHomeMetadata(): Metadata {
  return {
    title: `${SITE_NAME} — Ev, Ofis & Yaşam Ürünleri`,
    description: SITE_DESCRIPTION,
    alternates: { canonical: absoluteCanonical.home() },
    openGraph: {
      title: `${SITE_NAME} — Ev, Ofis & Yaşam Ürünleri`,
      description: SITE_DESCRIPTION,
      siteName: SITE_NAME,
      locale: 'tr_TR',
      type: 'website',
    },
    twitter: { card: 'summary_large_image' },
  }
}
