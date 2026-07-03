import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
  vi.unmock('@aws-sdk/client-s3')
  vi.unmock('@aws-sdk/s3-request-presigner')
})

describe('r2 config guards', () => {
  it('throws a configuration error when required env vars are missing', async () => {
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    delete process.env.R2_BUCKET_NAME

    const { generatePresignedUploadUrl } = await import('../../api/lib/r2')

    await expect(
      generatePresignedUploadUrl({
        folder: 'stores',
        mimeType: 'image/png',
        ownerId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_CONFIG_MISSING',
      statusCode: 503,
    })
  })

  it('fails fast with a bucket access error when R2 bucket is unreachable', async () => {
    process.env.R2_ACCOUNT_ID = '1234567890abcdef'
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_BUCKET_NAME = 'missing-bucket'

    vi.doMock('@aws-sdk/client-s3', () => {
      class S3Client {
        async send(command: unknown) {
          const commandName = (command as { constructor?: { name?: string } }).constructor?.name
          if (commandName === 'HeadBucketCommand') {
            throw {
              Code: 'NoSuchBucket',
              $metadata: { httpStatusCode: 404 },
            }
          }
          return {}
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
        constructor(_input: unknown) {}
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

    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(async () => 'https://signed-upload.example.com'),
    }))

    const { generatePresignedUploadUrl } = await import('../../api/lib/r2')

    await expect(
      generatePresignedUploadUrl({
        folder: 'stores',
        mimeType: 'image/png',
        ownerId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_BUCKET_UNREACHABLE',
      statusCode: 503,
    })
  })
})
