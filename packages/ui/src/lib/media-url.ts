type Variants = Record<string, string>
const DEFAULT_MEDIA_HOSTNAME = 'media.hanuja.tr'
const LEGACY_MEDIA_HOSTNAME = 'media.hanuja.com.tr'
const DEFAULT_CDN_HOSTNAME = 'cdn.hanuja.com.tr'
const LEGACY_CDN_HOSTNAME = 'cdn.hanuja.com'
const DEFAULT_MEDIA_BASE_URL = `https://${DEFAULT_MEDIA_HOSTNAME}`

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

function normalizeLegacyMediaUrl(sourceUrl: string, publicBaseUrl: string) {
  try {
    const source = new URL(sourceUrl)
    const target = new URL(publicBaseUrl)
    target.pathname = source.pathname
    target.search = source.search
    target.hash = source.hash
    return target.toString()
  } catch {
    return sourceUrl
  }
}

export function normalizeMediaDisplayUrl(
  sourceUrl: string,
  proxyPath = '/api/media/fetch',
  publicBaseUrl = DEFAULT_MEDIA_BASE_URL,
) {
  if (!sourceUrl || sourceUrl.startsWith('/')) return sourceUrl

  try {
    const parsed = new URL(sourceUrl)
    if (normalizeHostname(parsed.hostname) === DEFAULT_MEDIA_HOSTNAME) return sourceUrl
    if (normalizeHostname(parsed.hostname) === LEGACY_MEDIA_HOSTNAME) {
      return normalizeLegacyMediaUrl(sourceUrl, publicBaseUrl)
    }
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
