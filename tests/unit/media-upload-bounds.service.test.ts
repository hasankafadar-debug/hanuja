import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../api/lib/errors'

const TEN_MIB = 10 * 1024 * 1024
const TWENTY_MIB = 20 * 1024 * 1024

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  getObjectMetadata: vi.fn(),
  mediaProcessingAdd: vi.fn(),
  readObject: vi.fn(),
  uploadObject: vi.fn(),
}))

vi.mock('../../api/lib/r2', () => ({
  deleteObject: mocks.deleteObject,
  generatePresignedUploadUrl: mocks.generatePresignedUploadUrl,
  getAllowedMediaMimeTypes: (folder: string) =>
    folder === 'documents' || folder === 'customer-support'
      ? new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
      : new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  getMediaMaxSizeBytes: (folder: string) =>
    folder === 'documents' || folder === 'customer-support' ? TWENTY_MIB : TEN_MIB,
  getObjectMetadata: mocks.getObjectMetadata,
  readObject: mocks.readObject,
  uploadObject: mocks.uploadObject,
  SLIDER_VIDEO_MIME_TYPES: new Set(['video/mp4', 'video/webm']),
}))

vi.mock('../../api/lib/queue', () => ({
  mediaProcessingQueue: { add: mocks.mediaProcessingAdd },
}))

vi.mock('../../api/lib/image-meta', () => ({
  parseImageMetadata: vi.fn(),
}))

import { createMediaService } from '../../api/services/media.service'

function pendingAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    uploadedBy: 'owner-1',
    status: 'pending',
    folder: 'stores',
    key: 'stores/owner-1/asset.jpg',
    mimeType: 'image/jpeg',
    kind: 'image',
    sizeBytes: null,
    durationSec: null,
    ...overrides,
  }
}

function prismaForAsset(asset: ReturnType<typeof pendingAsset>) {
  return {
    mediaAsset: {
      findFirst: vi.fn().mockResolvedValue(asset),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...asset, ...data })),
    },
  } as any
}

describe('media upload confirmation limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteObject.mockResolvedValue(undefined)
    mocks.mediaProcessingAdd.mockResolvedValue(undefined)
  })

  it('accepts an object exactly at the folder limit and persists R2 metadata size', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({
      contentLength: TEN_MIB,
      contentType: 'image/jpeg',
    })

    const confirmed = await createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy)

    expect(confirmed).toMatchObject({ status: 'ready', sizeBytes: TEN_MIB })
    expect(prisma.mediaAsset.update).toHaveBeenLastCalledWith({
      where: { id: asset.id },
      data: { status: 'ready', sizeBytes: TEN_MIB },
    })
    expect(mocks.mediaProcessingAdd).toHaveBeenCalledOnce()
  })

  it('rejects and deletes an object one byte over the limit before it can be queued', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({
      contentLength: TEN_MIB + 1,
      contentType: 'image/jpeg',
    })

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.key)
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: asset.id },
      data: { status: 'rejected', sizeBytes: TEN_MIB + 1 },
    })
    expect(mocks.readObject).not.toHaveBeenCalled()
    expect(mocks.mediaProcessingAdd).not.toHaveBeenCalled()
  })

  it('rejects and deletes an upload with missing ContentLength without queueing it', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({
      contentLength: null,
      contentType: 'image/jpeg',
    })

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.key)
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: asset.id },
      data: { status: 'rejected' },
    })
    expect(mocks.mediaProcessingAdd).not.toHaveBeenCalled()
  })

  it('rejects a mismatched R2 ContentType before any read or queue work', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({
      contentLength: 1024,
      contentType: 'image/png',
    })

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.key)
    expect(mocks.readObject).not.toHaveBeenCalled()
    expect(mocks.mediaProcessingAdd).not.toHaveBeenCalled()
  })
})
