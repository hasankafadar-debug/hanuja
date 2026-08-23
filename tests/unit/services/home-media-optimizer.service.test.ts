import { describe, expect, it, vi } from 'vitest'
import {
  homeMediaAssetNeedsOptimization,
  optimizeHomeMediaAssets,
} from '../../../api/services/home-media-optimizer.service'

const canonicalVariants = {
  '400w': 'https://media.hanuja.tr/slider/admin/hero_400w.webp',
  '800w': 'https://media.hanuja.tr/slider/admin/hero_800w.webp',
  '1200w': 'https://media.hanuja.tr/slider/admin/hero_1200w.webp',
  '1600w': 'https://media.hanuja.tr/slider/admin/hero_1600w.webp',
}

describe('home media optimizer', () => {
  it('is idempotent for canonical assets on the public media domain', () => {
    expect(
      homeMediaAssetNeedsOptimization(
        {
          url: 'https://media.hanuja.tr/slider/admin/hero.png',
          variants: canonicalVariants,
        },
        'https://media.hanuja.tr',
      ),
    ).toBe(false)
  })

  it('keeps dry-run read-only and reports candidates', async () => {
    const update = vi.fn()
    const readObjectFn = vi.fn()
    const generateVariantsFn = vi.fn()
    const prisma = {
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'legacy',
            key: 'slider/admin/legacy.png',
            url: 'https://pub-05520b87648e41d29f4d7539fef47aef.r2.dev/slider/admin/legacy.png',
            folder: 'slider',
            variants: null,
          },
          {
            id: 'ready',
            key: 'slider/admin/hero.png',
            url: 'https://media.hanuja.tr/slider/admin/hero.png',
            folder: 'slider',
            variants: canonicalVariants,
          },
        ]),
        update,
      },
    }

    const summary = await optimizeHomeMediaAssets({
      prisma: prisma as never,
      apply: false,
      publicBaseUrl: 'https://media.hanuja.tr',
      readObjectFn,
      generateVariantsFn,
    })

    expect(summary).toMatchObject({
      mode: 'dry-run',
      scanned: 2,
      candidates: 1,
      optimized: 0,
      skipped: 1,
      failed: [],
    })
    expect(readObjectFn).not.toHaveBeenCalled()
    expect(generateVariantsFn).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('continues after a partial failure and updates only successful assets', async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ok',
            key: 'slider/admin/ok.png',
            url: 'https://legacy.example/slider/admin/ok.png',
            folder: 'slider',
            variants: null,
          },
          {
            id: 'failed',
            key: 'promo/admin/failed.png',
            url: 'https://legacy.example/promo/admin/failed.png',
            folder: 'promo',
            variants: null,
          },
        ]),
        update,
      },
    }
    const readObjectFn = vi.fn(async (key: string) => {
      if (key.includes('failed')) throw new Error('R2 read failed')
      return {
        body: new Uint8Array([1]),
        contentType: 'image/png',
        sizeBytes: 1,
      }
    })
    const generateVariantsFn = vi.fn().mockResolvedValue({
      variants: Object.fromEntries(
        Object.entries(canonicalVariants).map(([key, url]) => [
          key,
          url.replace('media.hanuja.tr', 'pub-05520b87648e41d29f4d7539fef47aef.r2.dev'),
        ]),
      ),
      width: 1600,
      height: 900,
    })

    const summary = await optimizeHomeMediaAssets({
      prisma: prisma as never,
      apply: true,
      publicBaseUrl: 'https://media.hanuja.tr',
      readObjectFn: readObjectFn as never,
      generateVariantsFn: generateVariantsFn as never,
    })

    expect(summary.optimized).toBe(1)
    expect(summary.failed).toEqual([{ id: 'failed', message: 'R2 read failed' }])
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ok' },
        data: expect.objectContaining({
          variants: canonicalVariants,
          width: 1600,
          height: 900,
        }),
      }),
    )
  })
})
