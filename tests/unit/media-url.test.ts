import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildManagedMediaShareUrl,
  buildMediaProxyUrl,
  extractManagedMediaProxySourceUrl,
  extractManagedMediaKey,
  extractPublicManagedMediaKey,
  getManagedMediaShareUrlConfigError,
  normalizeManagedMediaUrl,
  normalizeMediaDisplayUrl as normalizeApiMediaDisplayUrl,
  resolveManagedMediaSourceUrl,
} from '../../api/lib/media-url'
import {
  isManagedMediaProxyUrl,
  normalizeMediaDisplayUrl as normalizeUiMediaDisplayUrl,
} from '../../packages/ui/src/lib/media-url'

describe('media url helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('proxies legacy r2.dev urls through the app route', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(normalizeApiMediaDisplayUrl(source)).toBe(buildMediaProxyUrl(source))
  })

  it('rewrites the legacy media hostname to the configured current media base', () => {
    const source = 'https://media.hanuja.com.tr/products/test/image.jpg?width=800#preview'

    expect(normalizeManagedMediaUrl(source, 'https://media.hanuja.tr')).toBe(
      'https://media.hanuja.tr/products/test/image.jpg?width=800#preview',
    )
  })

  it('rewrites the legacy media hostname directly in API and UI display urls', () => {
    const source = 'https://media.hanuja.com.tr/products/test/image.jpg?width=800#preview'
    vi.stubEnv('R2_PUBLIC_URL', '')

    expect(normalizeApiMediaDisplayUrl(source)).toBe(
      'https://media.hanuja.tr/products/test/image.jpg?width=800#preview',
    )
    expect(normalizeUiMediaDisplayUrl(source)).toBe(
      'https://media.hanuja.tr/products/test/image.jpg?width=800#preview',
    )
  })

  it('rewrites the legacy media hostname to the API configured public base', () => {
    const source = 'https://media.hanuja.com.tr/products/test/image.jpg?width=800#preview'
    vi.stubEnv('R2_PUBLIC_URL', 'https://assets.example.com')

    expect(normalizeApiMediaDisplayUrl(source)).toBe(
      'https://assets.example.com/products/test/image.jpg?width=800#preview',
    )
  })

  it('rewrites the legacy media hostname to an explicitly configured UI public base', () => {
    const source = 'https://media.hanuja.com.tr/products/test/image.jpg?width=800#preview'

    expect(
      normalizeUiMediaDisplayUrl(source, '/api/media/fetch', 'https://assets.example.com'),
    ).toBe('https://assets.example.com/products/test/image.jpg?width=800#preview')
  })

  it('keeps the current media hostname direct in API and UI display urls', () => {
    const source = 'https://media.hanuja.tr/products/test/image.jpg'

    expect(normalizeApiMediaDisplayUrl(source)).toBe(source)
    expect(normalizeUiMediaDisplayUrl(source)).toBe(source)
  })

  it('keeps cdn and r2.dev display urls on the proxy path', () => {
    const cdnSource = 'https://cdn.hanuja.com.tr/products/test/image.jpg'
    const r2Source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(normalizeApiMediaDisplayUrl(cdnSource)).toBe(buildMediaProxyUrl(cdnSource))
    expect(normalizeUiMediaDisplayUrl(cdnSource)).toBe(buildMediaProxyUrl(cdnSource))
    expect(normalizeApiMediaDisplayUrl(r2Source)).toBe(buildMediaProxyUrl(r2Source))
    expect(normalizeUiMediaDisplayUrl(r2Source)).toBe(buildMediaProxyUrl(r2Source))
  })

  it('rewrites managed hosts to the configured public base', () => {
    const source = 'https://cdn.hanuja.com.tr/products/test/image.jpg'

    expect(normalizeManagedMediaUrl(source, 'https://media.hanuja.tr')).toBe(
      'https://media.hanuja.tr/products/test/image.jpg',
    )
  })

  it('builds share urls from the configured custom media domain', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(buildManagedMediaShareUrl(source, 'https://media.hanuja.tr')).toBe(
      'https://media.hanuja.tr/products/test/image.jpg',
    )
  })

  it('falls back to an absolute proxy share url when the configured public base is r2.dev', () => {
    const source = 'https://cdn.hanuja.com.tr/products/test/image.jpg'

    expect(
      buildManagedMediaShareUrl(source, {
        publicBaseUrl: 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev',
        proxyBaseUrl: 'http://localhost:3001',
      }),
    ).toBe(`http://localhost:3001${buildMediaProxyUrl(source)}`)
    expect(
      getManagedMediaShareUrlConfigError('https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev'),
    ).toBe('Medya paylasim adresi kullanima hazir degil. Lutfen biraz sonra tekrar deneyin.')
  })

  it('resolves first-party media proxy urls back to the managed source url', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'
    const proxyUrl = `http://localhost:3001${buildMediaProxyUrl(source)}`

    expect(extractManagedMediaProxySourceUrl(proxyUrl)).toBe(source)
    expect(resolveManagedMediaSourceUrl(proxyUrl)).toBe(source)
  })

  it('extracts the r2 object key from a managed media url', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(extractManagedMediaKey(source)).toBe('products/test/image.jpg')
  })

  it('allows only explicit public media prefixes for the anonymous proxy', () => {
    expect(extractPublicManagedMediaKey('https://media.hanuja.tr/products/test/image.jpg')).toBe(
      'products/test/image.jpg',
    )
    expect(
      extractPublicManagedMediaKey('https://media.hanuja.tr/avatars/store-owner/logo.png'),
    ).toBe('avatars/store-owner/logo.png')
    expect(
      extractPublicManagedMediaKey('https://media.hanuja.tr/returns/test/private.jpg'),
    ).toBeNull()
  })

  it.each([
    'https://foreign-bucket.r2.dev/products/test/image.jpg',
    'https://media.hanuja.tr/products//test/image.jpg',
    'https://media.hanuja.tr/products/%2e%2e/returns/test/image.jpg',
    'https://media.hanuja.tr/products%2Ftest%2Fimage.jpg',
  ])('rejects an untrusted or non-canonical proxy source: %s', (source) => {
    expect(extractPublicManagedMediaKey(source)).toBeNull()
  })

  it('detects first-party proxied media urls for Next Image unoptimized mode', () => {
    const proxied = buildMediaProxyUrl('https://cdn.hanuja.com.tr/products/test/image.jpg')

    expect(isManagedMediaProxyUrl(proxied)).toBe(true)
    expect(isManagedMediaProxyUrl('https://media.hanuja.tr/products/test/image.jpg')).toBe(false)
  })
})
