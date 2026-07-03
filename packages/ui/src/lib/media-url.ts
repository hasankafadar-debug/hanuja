type Variants = Record<string, string>
const DEFAULT_MEDIA_HOSTNAME = 'media.hanuja.com.tr'
const DEFAULT_CDN_HOSTNAME = 'cdn.hanuja.com.tr'
const LEGACY_CDN_HOSTNAME = 'cdn.hanuja.com'

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase()
}

function isLegacyManagedMediaHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === DEFAULT_CDN_HOSTNAME ||
    normalized === LEGACY_CDN_HOSTNAME ||
    normalized.endsWith('.r2.dev')
  )
}

export function normalizeMediaDisplayUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  if (!sourceUrl || sourceUrl.startsWith('/')) return sourceUrl

  try {
    const parsed = new URL(sourceUrl)
    if (normalizeHostname(parsed.hostname) === DEFAULT_MEDIA_HOSTNAME) return sourceUrl
    return isLegacyManagedMediaHostname(parsed.hostname)
      ? `${proxyPath}?src=${encodeURIComponent(sourceUrl)}`
      : sourceUrl
  } catch {
    return sourceUrl
  }
}

export function isManagedMediaProxyUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  return sourceUrl.startsWith(`${proxyPath}?`)
}

export function mediaSrcSet(
  variants: unknown,
  fallback: string,
): { src: string; srcSet?: string; sizes?: string } {
  const normalizedFallback = normalizeMediaDisplayUrl(fallback)
  if (!variants || typeof variants !== 'object') return { src: normalizedFallback }

  const v = variants as Variants
  const variant400 = v['400w'] ? normalizeMediaDisplayUrl(v['400w']) : null
  const variant800 = v['800w'] ? normalizeMediaDisplayUrl(v['800w']) : null
  const variant1200 = v['1200w'] ? normalizeMediaDisplayUrl(v['1200w']) : null
  const src = variant800 ?? variant1200 ?? normalizedFallback
  const parts: string[] = []
  if (variant400) parts.push(`${variant400} 400w`)
  if (variant800) parts.push(`${variant800} 800w`)
  if (variant1200) parts.push(`${variant1200} 1200w`)

  if (parts.length === 0) return { src: normalizedFallback }

  return {
    src,
    srcSet: parts.join(', '),
    sizes: '(max-width: 640px) 400px, (max-width: 1024px) 800px, 1200px',
  }
}
