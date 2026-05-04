/**
 * Slug normalization — Turkish-aware.
 * ğ→g, ü→u, ş→s, ı→i, ö→o, ç→c, then lowercase + hyphens.
 * Aligned with docs/04-seo/seo-url-slug-rules.md
 */

const TURKISH_CHAR_MAP: Record<string, string> = {
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ş: 's',
  Ş: 's',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
}

export function normalizeSlug(input: string): string {
  return input
    .split('')
    .map((char) => TURKISH_CHAR_MAP[char] ?? char)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function buildSlugWithSuffix(baseSlug: string, suffix: number): string {
  const normalizedBase = baseSlug.trim().replace(/^-+|-+$/g, '') || 'urun'
  if (suffix <= 1) return normalizedBase

  const suffixText = `-${suffix}`
  const maxBaseLength = Math.max(1, 80 - suffixText.length)
  const truncatedBase = normalizedBase.slice(0, maxBaseLength).replace(/-+$/g, '') || 'urun'
  return `${truncatedBase}${suffixText}`
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)
}
