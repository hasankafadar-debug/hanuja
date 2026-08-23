type VariantValue = string | { url?: unknown; width?: unknown }
type Variants = Record<string, VariantValue>
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
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
    return { src: normalizedFallback }
  }

  const v = variants as Variants
  const candidates = new Map<number, string>()

  const addCandidate = (value: VariantValue | undefined, defaultWidth: number) => {
    if (!value) return
    const url = typeof value === 'string' ? value : value.url
    const width =
      typeof value === 'object' && typeof value.width === 'number' ? value.width : defaultWidth
    if (typeof url !== 'string' || !url || !Number.isFinite(width) || width <= 0) return
    candidates.set(width, normalizeMediaDisplayUrl(url))
  }

  addCandidate(v['400w'], 400)
  addCandidate(v['800w'], 800)
  addCandidate(v['1200w'], 1200)
  addCandidate(v['1600w'], 1600)
  addCandidate(v.thumb, 320)
  addCandidate(v.medium, 800)

  const sorted = Array.from(candidates.entries()).sort(([left], [right]) => left - right)
  const src =
    candidates.get(800) ?? candidates.get(1200) ?? sorted.at(-1)?.[1] ?? normalizedFallback
  const parts = sorted.map(([width, url]) => `${url} ${width}w`)

  if (parts.length === 0) return { src: normalizedFallback }

  return {
    src,
    srcSet: parts.join(', '),
  }
}
