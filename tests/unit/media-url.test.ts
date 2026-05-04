import { describe, expect, it } from 'vitest'
import {
  buildMediaProxyUrl,
  extractManagedMediaKey,
  normalizeManagedMediaUrl,
  normalizeMediaDisplayUrl,
} from '../../api/lib/media-url'

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

  it('extracts the r2 object key from a managed media url', () => {
    const source = 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/products/test/image.jpg'

    expect(extractManagedMediaKey(source)).toBe('products/test/image.jpg')
  })
})
