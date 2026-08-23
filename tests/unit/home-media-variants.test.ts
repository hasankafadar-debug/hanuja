import { describe, expect, it, vi } from 'vitest'
import {
  generateHomeMediaVariants,
  hasCanonicalHomeMediaVariants,
  HOME_MEDIA_CACHE_CONTROL,
  HOME_MEDIA_VARIANT_SPECS,
  HOME_MEDIA_WEBP_QUALITY,
  SHARP_INPUT_OPTIONS,
} from '../../api/lib/home-media-variants'

describe('home media variants', () => {
  it('generates proportional cached WebP variants with the canonical flat shape', async () => {
    const resize = vi.fn().mockReturnThis()
    const webp = vi.fn().mockReturnThis()
    const toBuffer = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]))
    const metadata = vi.fn().mockResolvedValue({ width: 1672, height: 941 })
    const sharpFactory = vi.fn(() => ({ resize, webp, toBuffer, metadata }))
    const uploadVariant = vi.fn(async ({ key }: { key: string }) => ({
      publicUrl: `https://media.hanuja.tr/${key}`,
    }))

    const result = await generateHomeMediaVariants(
      new Uint8Array([1, 2, 3]),
      'slider/admin/hero.png',
      sharpFactory as never,
      uploadVariant as never,
    )

    expect(result.width).toBe(1672)
    expect(result.height).toBe(941)
    expect(Object.keys(result.variants)).toEqual(['400w', '800w', '1200w', '1600w'])
    expect(sharpFactory).toHaveBeenCalledTimes(1 + HOME_MEDIA_VARIANT_SPECS.length)
    expect(sharpFactory.mock.calls.every(([, options]) => options === SHARP_INPUT_OPTIONS)).toBe(
      true,
    )

    for (const width of HOME_MEDIA_VARIANT_SPECS) {
      expect(resize).toHaveBeenCalledWith({
        width,
        fit: 'inside',
        withoutEnlargement: true,
      })
      expect(uploadVariant).toHaveBeenCalledWith({
        key: `slider/admin/hero_${width}w.webp`,
        body: new Uint8Array([1, 2, 3]),
        mimeType: 'image/webp',
        cacheControl: HOME_MEDIA_CACHE_CONTROL,
      })
      expect(result.variants[`${width}w`]).toBe(
        `https://media.hanuja.tr/slider/admin/hero_${width}w.webp`,
      )
    }
    expect(webp).toHaveBeenCalledTimes(HOME_MEDIA_VARIANT_SPECS.length)
    expect(webp).toHaveBeenCalledWith({ quality: HOME_MEDIA_WEBP_QUALITY })
  })

  it('recognizes only complete canonical variant maps', () => {
    expect(
      hasCanonicalHomeMediaVariants({
        '400w': 'https://media.hanuja.tr/a-400.webp',
        '800w': 'https://media.hanuja.tr/a-800.webp',
        '1200w': 'https://media.hanuja.tr/a-1200.webp',
        '1600w': 'https://media.hanuja.tr/a-1600.webp',
      }),
    ).toBe(true)
    expect(hasCanonicalHomeMediaVariants({ thumb: { url: 'legacy.webp' } })).toBe(false)
  })
})
