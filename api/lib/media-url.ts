import {
  DEFAULT_CDN_HOSTNAME,
  DEFAULT_MEDIA_HOSTNAME,
  LEGACY_CDN_HOSTNAME,
  LEGACY_MEDIA_HOSTNAME,
} from './platform-info'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase()
}

export function getConfiguredMediaBaseUrl() {
  const value = process.env.R2_PUBLIC_URL?.trim()
  return value ? trimTrailingSlash(value) : ''
}

export function getConfiguredMediaHostname() {
  const explicitHost = process.env.R2_PUBLIC_HOSTNAME?.trim()
  if (explicitHost) return normalizeHostname(explicitHost)

  const configuredBaseUrl = getConfiguredMediaBaseUrl()
  if (!configuredBaseUrl) return ''

  const parsed = parseAbsoluteUrl(configuredBaseUrl)
  return parsed ? normalizeHostname(parsed.hostname) : ''
}

export function isR2DevHostname(hostname: string) {
  return normalizeHostname(hostname).endsWith('.r2.dev')
}

export function isLegacyMediaHostname(hostname: string) {
  return normalizeHostname(hostname) === LEGACY_MEDIA_HOSTNAME
}

export function isManagedMediaHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  const configuredHost = getConfiguredMediaHostname()

  return (
    normalized === DEFAULT_MEDIA_HOSTNAME ||
    normalized === LEGACY_MEDIA_HOSTNAME ||
    normalized === DEFAULT_CDN_HOSTNAME ||
    normalized === LEGACY_CDN_HOSTNAME ||
    normalized === configuredHost ||
    isR2DevHostname(normalized)
  )
}

export function isLegacyManagedMediaHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === DEFAULT_CDN_HOSTNAME ||
    normalized === LEGACY_CDN_HOSTNAME ||
    isR2DevHostname(normalized)
  )
}

export function extractManagedMediaKey(sourceUrl: string) {
  const parsed = parseAbsoluteUrl(sourceUrl)
  if (!parsed || !isManagedMediaHostname(parsed.hostname)) return null

  const key = parsed.pathname.replace(/^\/+/, '')
  return key || null
}

export function normalizeManagedMediaUrl(sourceUrl: string, publicBaseUrl = getConfiguredMediaBaseUrl()) {
  if (!sourceUrl || !publicBaseUrl || sourceUrl.startsWith('/')) return sourceUrl

  const parsedSource = parseAbsoluteUrl(sourceUrl)
  const parsedTarget = parseAbsoluteUrl(publicBaseUrl)
  if (!parsedSource || !parsedTarget) return sourceUrl
  if (!isManagedMediaHostname(parsedSource.hostname)) return sourceUrl

  const sameHost =
    normalizeHostname(parsedSource.hostname) === normalizeHostname(parsedTarget.hostname) &&
    parsedSource.protocol === parsedTarget.protocol
  if (sameHost) return sourceUrl

  parsedTarget.pathname = parsedSource.pathname
  parsedTarget.search = parsedSource.search
  parsedTarget.hash = parsedSource.hash
  return parsedTarget.toString()
}

type ManagedMediaShareUrlOptions = {
  publicBaseUrl?: string
  proxyBaseUrl?: string
  proxyPath?: string
}

function resolveShareUrlOptions(options?: string | ManagedMediaShareUrlOptions) {
  if (typeof options === 'string') {
    return {
      publicBaseUrl: options,
      proxyBaseUrl: '',
      proxyPath: '/api/media/fetch',
    }
  }

  return {
    publicBaseUrl: options?.publicBaseUrl ?? getConfiguredMediaBaseUrl(),
    proxyBaseUrl: options?.proxyBaseUrl ?? '',
    proxyPath: options?.proxyPath ?? '/api/media/fetch',
  }
}

export function getManagedMediaShareUrlConfigError(publicBaseUrl = getConfiguredMediaBaseUrl()) {
  if (!publicBaseUrl) {
    return 'Medya paylasim adresi kullanima hazir degil. Lutfen biraz sonra tekrar deneyin.'
  }

  const parsedTarget = parseAbsoluteUrl(publicBaseUrl)
  if (!parsedTarget) {
    return 'Medya paylasim adresi kullanima hazir degil. Lutfen biraz sonra tekrar deneyin.'
  }

  if (parsedTarget.protocol !== 'https:') {
    return 'Medya paylasim adresi kullanima hazir degil. Lutfen biraz sonra tekrar deneyin.'
  }

  if (isR2DevHostname(parsedTarget.hostname)) {
    return 'Medya paylasim adresi kullanima hazir degil. Lutfen biraz sonra tekrar deneyin.'
  }

  return null
}

export function buildManagedMediaShareUrl(sourceUrl: string, options?: string | ManagedMediaShareUrlOptions) {
  if (!sourceUrl || sourceUrl.startsWith('/')) return null

  const parsedSource = parseAbsoluteUrl(sourceUrl)
  if (!parsedSource || !isManagedMediaHostname(parsedSource.hostname)) {
    return sourceUrl
  }

  const { publicBaseUrl, proxyBaseUrl, proxyPath } = resolveShareUrlOptions(options)
  if (getManagedMediaShareUrlConfigError(publicBaseUrl)) {
    return buildAbsoluteMediaProxyUrl(sourceUrl, proxyBaseUrl, proxyPath)
  }

  return normalizeManagedMediaUrl(sourceUrl, publicBaseUrl)
}

export function buildMediaProxyUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  return `${proxyPath}?src=${encodeURIComponent(sourceUrl)}`
}

export function buildAbsoluteMediaProxyUrl(
  sourceUrl: string,
  proxyBaseUrl: string,
  proxyPath = '/api/media/fetch',
) {
  const proxyUrl = buildMediaProxyUrl(sourceUrl, proxyPath)
  const parsedBase = parseAbsoluteUrl(proxyBaseUrl)
  return parsedBase ? `${parsedBase.origin}${proxyUrl}` : proxyUrl
}

export function extractManagedMediaProxySourceUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  const parsed = parseAbsoluteUrl(sourceUrl)
  if (!parsed || parsed.pathname !== proxyPath) return null

  const proxiedSourceUrl = parsed.searchParams.get('src')?.trim() ?? ''
  const parsedProxiedSource = parseAbsoluteUrl(proxiedSourceUrl)
  if (!parsedProxiedSource || !isManagedMediaHostname(parsedProxiedSource.hostname)) return null

  return proxiedSourceUrl
}

export function resolveManagedMediaSourceUrl(sourceUrl: string) {
  const proxiedSourceUrl = extractManagedMediaProxySourceUrl(sourceUrl)
  const candidateUrl = proxiedSourceUrl ?? sourceUrl
  const parsedCandidate = parseAbsoluteUrl(candidateUrl)

  if (!parsedCandidate || parsedCandidate.protocol !== 'https:') return null
  if (!isManagedMediaHostname(parsedCandidate.hostname)) return null

  return candidateUrl
}

export function normalizeMediaDisplayUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  if (!sourceUrl || sourceUrl.startsWith('/')) return sourceUrl

  const parsed = parseAbsoluteUrl(sourceUrl)
  if (!parsed) return sourceUrl

  if (isLegacyMediaHostname(parsed.hostname)) {
    const publicBaseUrl = getConfiguredMediaBaseUrl() || `https://${DEFAULT_MEDIA_HOSTNAME}`
    return normalizeManagedMediaUrl(sourceUrl, publicBaseUrl)
  }

  return isLegacyManagedMediaHostname(parsed.hostname)
    ? buildMediaProxyUrl(sourceUrl, proxyPath)
    : sourceUrl
}
