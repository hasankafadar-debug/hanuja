import { describe, expect, it } from 'vitest'
import {
  buildManagedMediaShareUrl,
  buildMediaProxyUrl,
  extractManagedMediaProxySourceUrl,
  extractManagedMediaKey,
  getManagedMediaShareUrlConfigError,
  normalizeManagedMediaUrl,
  normalizeMediaDisplayUrl,
  resolveManagedMediaSourceUrl,
} from '../../api/lib/media-url'
import { isManagedMediaProxyUrl } from '../../packages/ui/src/lib/media-url'

describe('media url helpers', () => {
  it('proxies legacy r2.dev urls through the app route', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(normalizeMediaDisplayUrl(source)).toBe(buildMediaProxyUrl(source))
  })

  it('keeps the custom media domain direct', () => {
    const source = 'https://media.hanuja.com.tr/products/test/image.jpg'

    expect(normalizeMediaDisplayUrl(source)).toBe(source)
  })

  it('rewrites managed hosts to the configured public base', () => {
    const source = 'https://cdn.hanuja.com.tr/products/test/image.jpg'

    expect(normalizeManagedMediaUrl(source, 'https://media.hanuja.com.tr')).toBe(
      'https://media.hanuja.com.tr/products/test/image.jpg',
    )
  })

  it('builds share urls from the configured custom media domain', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(buildManagedMediaShareUrl(source, 'https://media.hanuja.com.tr')).toBe(
      'https://media.hanuja.com.tr/products/test/image.jpg',
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

  it('detects first-party proxied media urls for Next Image unoptimized mode', () => {
    const proxied = buildMediaProxyUrl('https://cdn.hanuja.com.tr/products/test/image.jpg')

    expect(isManagedMediaProxyUrl(proxied)).toBe(true)
    expect(isManagedMediaProxyUrl('https://media.hanuja.com.tr/products/test/image.jpg')).toBe(
      false,
    )
  })
})
