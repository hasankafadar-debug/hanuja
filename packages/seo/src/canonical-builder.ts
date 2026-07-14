/**
 * Canonical URL builders — deterministic route generation for all entity types.
 * All public routes must go through these helpers to stay aligned with SEO rules.
 */

export function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.hanuja.com.tr').replace(/\/$/, '')
}

/** Convert a relative path to an absolute URL using NEXT_PUBLIC_APP_URL. */
export function absoluteUrl(path: string): string {
  return `${getBaseUrl()}${path}`
}

// ── Entity path builders (relative) ──────────────────────────────────────────

export const canonical = {
  home: (): string => '/',
  category: (slugParts: string[]): string => `/kategori/${slugParts.join('/')}`,
  product: (slug: string): string => `/urun/${slug}`,
  store: (slug: string): string => `/magaza/${slug}`,
  blog: (slug: string): string => `/blog/${slug}`,
  blogList: (): string => '/blog',
  search: (): string => '/arama',
} as const

// ── Absolute URL builders ─────────────────────────────────────────────────────

export const absoluteCanonical = {
  home: (): string => absoluteUrl(canonical.home()),
  category: (slugParts: string[]): string => absoluteUrl(canonical.category(slugParts)),
  product: (slug: string): string => absoluteUrl(canonical.product(slug)),
  store: (slug: string): string => absoluteUrl(canonical.store(slug)),
  blog: (slug: string): string => absoluteUrl(canonical.blog(slug)),
  blogList: (): string => absoluteUrl(canonical.blogList()),
} as const
