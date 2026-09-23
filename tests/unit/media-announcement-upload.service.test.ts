/**
 * Announcement media (e-mail plan phase 5): upload rules, size by kind, file
 * signature checks on confirm, and a delete order that never leaves a record
 * pointing at a removed file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../api/lib/errors'

const TEN_MIB = 10 * 1024 * 1024
const FIFTY_MIB = 50 * 1024 * 1024

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  getObjectMetadata: vi.fn(),
  mediaProcessingAdd: vi.fn(),
  readObject: vi.fn(),
  readObjectRange: vi.fn(),
  order: [] as string[],
}))

vi.mock('../../api/lib/r2', () => ({
  deleteObject: mocks.deleteObject,
  generatePresignedUploadUrl: mocks.generatePresignedUploadUrl,
  getAllowedMediaMimeTypes: (folder: string) =>
    folder === 'announcements'
      ? new Set(['image/jpeg', 'image/png', 'video/mp4', 'video/webm'])
      : folder === 'slider'
        ? new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
        : new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  getMediaMaxSizeBytes: (folder: string, kind?: string) =>
    folder === 'announcements' && kind === 'video' ? FIFTY_MIB : TEN_MIB,
  getObjectMetadata: mocks.getObjectMetadata,
  readObject: mocks.readObject,
  readObjectRange: mocks.readObjectRange,
  uploadObject: vi.fn(),
  SLIDER_VIDEO_MIME_TYPES: new Set(['video/mp4', 'video/webm']),
}))

vi.mock('../../api/lib/queue', () => ({
  mediaProcessingQueue: { add: mocks.mediaProcessingAdd },
}))

import { createMediaService } from '../../api/services/media.service'

const MP4_HEADER = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
// 1×1 PNG: signature + IHDR (width 1, height 1).
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0,
])

function pendingAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    uploadedBy: 'admin-1',
    status: 'pending',
    folder: 'announcements',
    key: 'announcements/admin-1/asset.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    sizeBytes: null,
    durationSec: null,
    ...overrides,
  }
}

function prismaForAsset(asset: ReturnType<typeof pendingAsset>) {
  return {
    mediaAsset: {
      findFirst: vi.fn().mockResolvedValue(asset),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-asset', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...asset, ...data })),
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.length = 0
  mocks.deleteObject.mockResolvedValue(undefined)
  mocks.mediaProcessingAdd.mockResolvedValue(undefined)
  mocks.generatePresignedUploadUrl.mockResolvedValue({
    uploadUrl: 'https://r2.test/put',
    key: 'announcements/admin-1/x.mp4',
    publicUrl: 'https://media.hanuja.tr/announcements/admin-1/x.mp4',
    expiresIn: 300,
  })
})

describe('announcement upload request', () => {
  it('accepts video for announcements and records it as a video asset', async () => {
    const prisma = prismaForAsset(pendingAsset())
    await createMediaService({ prisma }).requestUploadUrl({
      ownerId: 'admin-1',
      folder: 'announcements',
      mimeType: 'video/mp4',
    })
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'video', status: 'pending' }) }),
    )
  })

  it('rejects WebP for announcements (e-mail covers must render in Outlook)', async () => {
    const prisma = prismaForAsset(pendingAsset())
    await expect(
      createMediaService({ prisma }).requestUploadUrl({
        ownerId: 'admin-1',
        folder: 'announcements',
        mimeType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(mocks.generatePresignedUploadUrl).not.toHaveBeenCalled()
  })

  it('still rejects video outside the slider and announcement folders', async () => {
    const prisma = prismaForAsset(pendingAsset())
    await expect(
      createMediaService({ prisma }).requestUploadUrl({
        ownerId: 'admin-1',
        folder: 'general',
        mimeType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('announcement upload confirmation', () => {
  it('accepts a 50 MiB MP4 whose header is a real ftyp box', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({ contentLength: FIFTY_MIB, contentType: 'video/mp4' })
    mocks.readObjectRange.mockResolvedValue(MP4_HEADER)

    const confirmed = await createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy)

    expect(confirmed).toMatchObject({ status: 'ready', sizeBytes: FIFTY_MIB })
    expect(mocks.readObjectRange).toHaveBeenCalledWith(asset.key, 0, 63)
    // Only the header is read, never the whole video.
    expect(mocks.readObject).not.toHaveBeenCalled()
  })

  it('rejects and deletes a video one byte over 50 MiB', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({ contentLength: FIFTY_MIB + 1, contentType: 'video/mp4' })

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.key)
    expect(mocks.mediaProcessingAdd).not.toHaveBeenCalled()
  })

  it('rejects a file whose bytes are not the declared video type', async () => {
    const asset = pendingAsset()
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({ contentLength: 1024, contentType: 'video/mp4' })
    mocks.readObjectRange.mockResolvedValue(new TextEncoder().encode('<html><script>x</script>'))

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toThrow('Video dosyası doğrulanamadı')
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: asset.id },
      data: { status: 'rejected', sizeBytes: 1024 },
    })
    expect(mocks.deleteObject).toHaveBeenCalledWith(asset.key)
  })

  it('accepts a real PNG and rejects a disguised one', async () => {
    const asset = pendingAsset({ key: 'announcements/admin-1/a.png', mimeType: 'image/png', kind: 'image' })
    mocks.getObjectMetadata.mockResolvedValue({ contentLength: PNG_1X1.byteLength, contentType: 'image/png' })

    mocks.readObject.mockResolvedValueOnce({ body: PNG_1X1, contentType: 'image/png', sizeBytes: 29 })
    await expect(
      createMediaService({ prisma: prismaForAsset(asset) }).confirmUpload(asset.id, asset.uploadedBy),
    ).resolves.toMatchObject({ status: 'ready' })

    mocks.readObject.mockResolvedValueOnce({
      body: new TextEncoder().encode('GIF89a-not-a-png'),
      contentType: 'image/png',
      sizeBytes: 16,
    })
    await expect(
      createMediaService({ prisma: prismaForAsset(asset) }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toThrow('Görsel dosyası doğrulanamadı')
  })

  it('keeps the 10 MiB cap for slider videos', async () => {
    const asset = pendingAsset({ folder: 'slider', key: 'slider/admin-1/v.mp4' })
    const prisma = prismaForAsset(asset)
    mocks.getObjectMetadata.mockResolvedValue({ contentLength: TEN_MIB + 1, contentType: 'video/mp4' })

    await expect(
      createMediaService({ prisma }).confirmUpload(asset.id, asset.uploadedBy),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(mocks.readObjectRange).not.toHaveBeenCalled()
  })
})

describe('media delete order', () => {
  function prismaForDelete(options: { announcementUses?: number; deleteError?: unknown; found?: boolean } = {}) {
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        mocks.order.push('lock')
        return options.found === false ? [] : [{ id: 'asset-1', key: 'announcements/admin-1/a.png' }]
      }),
      announcement: { count: vi.fn().mockResolvedValue(options.announcementUses ?? 0) },
      mediaAsset: {
        delete: vi.fn().mockImplementation(async () => {
          mocks.order.push('db-delete')
          if (options.deleteError) throw options.deleteError
        }),
      },
    }
    mocks.deleteObject.mockImplementation(async () => {
      mocks.order.push('r2-delete')
    })
    return {
      tx,
      prisma: {
        $transaction: vi.fn().mockImplementation(async (fn: (client: typeof tx) => unknown) => {
          const result = await fn(tx)
          mocks.order.push('commit')
          return result
        }),
      } as any,
    }
  }

  it('removes the record under a lock and the file only after commit', async () => {
    const { prisma } = prismaForDelete()
    await createMediaService({ prisma }).deleteAsset('asset-1', 'admin-1')
    expect(mocks.order).toEqual(['lock', 'db-delete', 'commit', 'r2-delete'])
  })

  it('refuses to delete media an announcement uses and keeps the file', async () => {
    const { prisma, tx } = prismaForDelete({ announcementUses: 1 })
    await expect(createMediaService({ prisma }).deleteAsset('asset-1', 'admin-1')).rejects.toThrow(
      'Bu medya bir duyuruda kullanılıyor',
    )
    expect(tx.mediaAsset.delete).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('keeps the file when a foreign key still references the record', async () => {
    const { prisma } = prismaForDelete({ deleteError: Object.assign(new Error('fk'), { code: 'P2003' }) })
    await expect(createMediaService({ prisma }).deleteAsset('asset-1', 'admin-1')).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('reports an orphaned file instead of failing once the record is gone', async () => {
    const { prisma } = prismaForDelete()
    mocks.deleteObject.mockRejectedValueOnce(new Error('R2 down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(createMediaService({ prisma }).deleteAsset('asset-1', 'admin-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[media] R2 object orphaned after record delete', expect.any(Object))
    warn.mockRestore()
  })
})
