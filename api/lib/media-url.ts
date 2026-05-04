import {
  DEFAULT_CDN_HOSTNAME,
  DEFAULT_MEDIA_HOSTNAME,
  LEGACY_CDN_HOSTNAME,
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

export function isManagedMediaHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  const configuredHost = getConfiguredMediaHostname()

  return (
    normalized === DEFAULT_MEDIA_HOSTNAME ||
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

export function buildMediaProxyUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  return `${proxyPath}?src=${encodeURIComponent(sourceUrl)}`
}

export function normalizeMediaDisplayUrl(sourceUrl: string, proxyPath = '/api/media/fetch') {
  if (!sourceUrl || sourceUrl.startsWith('/')) return sourceUrl

  const parsed = parseAbsoluteUrl(sourceUrl)
  if (!parsed) return sourceUrl

  return isLegacyManagedMediaHostname(parsed.hostname)
    ? buildMediaProxyUrl(sourceUrl, proxyPath)
    : sourceUrl
}
