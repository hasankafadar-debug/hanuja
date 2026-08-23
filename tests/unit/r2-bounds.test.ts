import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEN_MIB = 10 * 1024 * 1024
const TWENTY_MIB = 20 * 1024 * 1024
const ORIGINAL_ENV = { ...process.env }

const mocks = vi.hoisted(() => ({
  putInputs: [] as Array<Record<string, unknown>>,
  send: vi.fn(),
}))

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    R2_ACCOUNT_ID: '1234567890abcdef',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET_NAME: 'test-bucket',
    R2_CDN_URL: 'https://media.example.test',
  }
  mocks.putInputs.length = 0
  mocks.send.mockReset()

  vi.doMock('@aws-sdk/client-s3', () => {
    class S3Client {
      async send(command: unknown) {
        return mocks.send(command)
      }
    }
    class DeleteObjectCommand {
      constructor(_input: unknown) {}
    }
    class GetObjectCommand {
      constructor(_input: unknown) {}
    }
    class HeadBucketCommand {
      constructor(_input: unknown) {}
    }
    class HeadObjectCommand {
      constructor(_input: unknown) {}
    }
    class PutObjectCommand {
      constructor(input: Record<string, unknown>) {
        mocks.putInputs.push(input)
      }
    }

    return {
      S3Client,
      DeleteObjectCommand,
      GetObjectCommand,
      HeadBucketCommand,
      HeadObjectCommand,
      PutObjectCommand,
    }
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.doUnmock('@aws-sdk/client-s3')
  vi.resetModules()
})

describe('R2 media size bounds', () => {
  it('uses 10 MiB for image/video folders and 20 MiB for documents', async () => {
    const { getMediaMaxSizeBytes } = await import('../../api/lib/r2')

    expect(getMediaMaxSizeBytes('products')).toBe(TEN_MIB)
    expect(getMediaMaxSizeBytes('slider')).toBe(TEN_MIB)
    expect(getMediaMaxSizeBytes('documents')).toBe(TWENTY_MIB)
    expect(getMediaMaxSizeBytes('customer-support')).toBe(TWENTY_MIB)
  })

  it('sets ContentLength for server-side uploads and rejects a +1 byte payload', async () => {
    const { uploadObject } = await import('../../api/lib/r2')
    mocks.send.mockResolvedValue({})

    await uploadObject({
      folder: 'products',
      mimeType: 'image/jpeg',
      ownerId: 'seller-1',
      body: new Uint8Array(TEN_MIB),
    })

    expect(mocks.putInputs[0]).toMatchObject({
      ContentLength: TEN_MIB,
      ContentType: 'image/jpeg',
    })

    await expect(
      uploadObject({
        folder: 'products',
        mimeType: 'image/jpeg',
        ownerId: 'seller-1',
        body: new Uint8Array(TEN_MIB + 1),
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_FILE_TOO_LARGE', statusCode: 413 })
    expect(mocks.putInputs).toHaveLength(1)
  })

  it('applies immutable cache metadata to generated variants', async () => {
    const { uploadBufferWithKey } = await import('../../api/lib/r2')
    mocks.send.mockResolvedValue({})

    await uploadBufferWithKey({
      key: 'slider/admin/hero_1200w.webp',
      mimeType: 'image/webp',
      body: new Uint8Array([1, 2, 3]),
      cacheControl: 'public, max-age=31536000, immutable',
    })

    expect(mocks.putInputs[0]).toMatchObject({
      Key: 'slider/admin/hero_1200w.webp',
      ContentType: 'image/webp',
      ContentLength: 3,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  })

  it('rejects an oversized declared ContentLength before consuming the stream', async () => {
    const { readObject } = await import('../../api/lib/r2')
    const destroy = vi.fn()
    mocks.send.mockResolvedValue({
      ContentLength: TEN_MIB + 1,
      ContentType: 'image/jpeg',
      Body: {
        destroy,
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1])
        },
      },
    })

    await expect(readObject('products/seller-1/asset.jpg')).rejects.toMatchObject({
      code: 'MEDIA_FILE_TOO_LARGE',
      statusCode: 413,
    })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('enforces the byte limit while reading a stream with no ContentLength', async () => {
    const { readObject } = await import('../../api/lib/r2')
    const destroy = vi.fn()
    mocks.send.mockResolvedValue({
      ContentType: 'image/jpeg',
      Body: {
        destroy,
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(6 * 1024 * 1024)
          yield new Uint8Array(6 * 1024 * 1024)
        },
      },
    })

    await expect(readObject('products/seller-1/asset.jpg')).rejects.toMatchObject({
      code: 'MEDIA_FILE_TOO_LARGE',
      statusCode: 413,
    })
    expect(destroy).toHaveBeenCalledOnce()
  })
})
