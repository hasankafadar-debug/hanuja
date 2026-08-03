import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  uploadBufferWithKey: vi.fn(),
}))

vi.mock('bullmq', () => ({ Worker: class {} }))
vi.mock('../../api/lib/redis', () => ({ redis: {} }))
vi.mock('../../api/lib/queue', () => ({
  QUEUE_NAMES: { MEDIA_PROCESSING: 'media-processing' },
}))
vi.mock('../../api/lib/prisma', () => ({ prisma: {} }))
vi.mock('../../api/lib/r2', () => ({
  getMediaMaxSizeBytes: vi.fn(),
  objectExists: vi.fn(),
  readObject: vi.fn(),
  uploadBufferWithKey: mocks.uploadBufferWithKey,
}))

import {
  generateVariants,
  MAX_MEDIA_IMAGE_DIMENSION,
  MAX_MEDIA_INPUT_PIXELS,
  SHARP_INPUT_OPTIONS,
} from '../../api/jobs/media-processing.job'

function sharpProcessor() {
  return {
    metadata: vi.fn().mockResolvedValue({ width: 1200, height: 900 }),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
  }
}

describe('media processing resource bounds', () => {
  it('configures every Sharp decode with the 6000x6000 input-pixel limit', async () => {
    mocks.sharp.mockImplementation(sharpProcessor)
    mocks.uploadBufferWithKey.mockResolvedValue({
      publicUrl: 'https://media.example.test/products/seller-1/variant.webp',
    })

    await generateVariants(
      new Uint8Array([1, 2, 3]),
      'products/seller-1/original.jpg',
      '',
      mocks.sharp as any,
    )

    expect(MAX_MEDIA_IMAGE_DIMENSION).toBe(6000)
    expect(MAX_MEDIA_INPUT_PIXELS).toBe(36_000_000)
    expect(SHARP_INPUT_OPTIONS).toEqual({ limitInputPixels: 36_000_000 })
    expect(mocks.sharp).toHaveBeenCalledTimes(5)
    for (const [, options] of mocks.sharp.mock.calls) {
      expect(options).toEqual(SHARP_INPUT_OPTIONS)
    }
  })
})
