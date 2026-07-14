/**
 * Media service — manages MediaAsset records and presigned upload URLs.
 *
 * Flow:
 *  1. Client requests a presigned URL → server generates + stores a pending MediaAsset.
 *  2. Client uploads directly to R2 using the presigned URL.
 *  3. Client calls confirm endpoint → MediaAsset becomes 'ready'.
 *  4. A BullMQ media-processing job runs post-upload tasks (record metadata, future resizing).
 *
 * Authorization is enforced at the route level — this service trusts ownerId.
 */
import type { PrismaClient } from '@prisma/client'
import {
  generatePresignedUploadUrl,
  deleteObject,
  readObject,
  uploadObject,
  SLIDER_VIDEO_MIME_TYPES,
  type MediaFolder,
} from '../lib/r2'
import { ValidationError } from '../lib/errors'
import { mediaProcessingQueue } from '../lib/queue'
import { parseImageMetadata } from '../lib/image-meta'

export interface MediaServiceDeps {
  prisma: PrismaClient
}

export function createMediaService({ prisma }: MediaServiceDeps) {
  const productAllowedTypes = new Set(['image/jpeg', 'image/png'])

  /**
   * Request a presigned upload URL.
   * Creates a pending MediaAsset record that tracks the intended upload.
   */
  async function requestUploadUrl(opts: {
    ownerId: string
    folder: MediaFolder
    mimeType: string
    originalName?: string
  }) {
    const { ownerId, folder, mimeType, originalName } = opts

    if (folder === 'products' && !productAllowedTypes.has(mimeType)) {
      throw new Error('Yalnızca PNG veya JPEG kabul edilir.')
    }

    // Video MIME types are only accepted for the slider folder
    if (SLIDER_VIDEO_MIME_TYPES.has(mimeType) && folder !== 'slider') {
      throw new ValidationError('Video yüklemesi yalnızca slider klasörü için desteklenir.')
    }

    const { uploadUrl, key, publicUrl, expiresIn } = await generatePresignedUploadUrl({
      folder,
      mimeType,
      ownerId,
    })

    // Create a pending record — confirmed after successful upload
    const isDocument = folder === 'documents'
    const asset = await prisma.mediaAsset.create({
      data: {
        uploadedBy: ownerId,
        folder,
        key,
        url: publicUrl,
        mimeType,
        kind: SLIDER_VIDEO_MIME_TYPES.has(mimeType) ? 'video' : isDocument ? 'document' : 'image',
        originalName: originalName ?? null,
        status: 'pending',
        type: isDocument ? 'support_attachment' : 'product_image', // default — updated when attached to a specific entity
      },
    })

    return { asset, uploadUrl, expiresIn }
  }

  /**
   * Confirm an upload completed successfully.
   * Moves asset to 'ready' and enqueues post-processing.
   */
  async function confirmUpload(assetId: string, ownerId: string) {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, uploadedBy: ownerId, status: 'pending' },
    })

    if (!asset) {
      throw new Error('Medya kaydı bulunamadı veya zaten onaylandı.')
    }

    // Video-specific validation for slider folder
    if (asset.kind === 'video') {
      const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
      const VIDEO_MAX_DURATION_SEC = 15

      if (asset.sizeBytes != null && asset.sizeBytes > VIDEO_MAX_SIZE_BYTES) {
        await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'rejected' } })
        throw new ValidationError(
          `Video dosyası 10 MB sınırını aşıyor (yüklenen: ${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB).`,
        )
      }

      if (asset.durationSec != null && asset.durationSec > VIDEO_MAX_DURATION_SEC) {
        await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'rejected' } })
        throw new ValidationError(
          `Video süresi 15 saniyeyi geçemez (yüklenen: ${asset.durationSec} saniye).`,
        )
      }
    }

    if (asset.folder === 'products') {
      if (!asset.key) {
        await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'failed' } })
        throw new Error('Görsel dosyası doğrulanamadı.')
      }

      try {
        const object = await readObject(asset.key)
        const metadata = parseImageMetadata(object.body, asset.mimeType ?? object.contentType)

        if (!productAllowedTypes.has(asset.mimeType ?? object.contentType)) {
          throw new Error('Yalnızca PNG veya JPEG kabul edilir.')
        }

        if (metadata.width < 800 || metadata.height < 800) {
          throw new Error(
            `Görsel en az 800×800 piksel olmalıdır (yüklenen: ${metadata.width}×${metadata.height}).`,
          )
        }

        if (metadata.width > 6000 || metadata.height > 6000) {
          throw new Error(
            `Görsel en fazla 6000×6000 piksel olabilir (yüklenen: ${metadata.width}×${metadata.height}).`,
          )
        }
      } catch (error) {
        await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: 'rejected' } })
        throw error
      }
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: 'ready' },
    })

    // Enqueue post-processing (metadata, future resize variants)
    await mediaProcessingQueue.add(
      'process-media',
      { assetId: updated.id, key: updated.key, mimeType: updated.mimeType },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    )

    return updated
  }

  /**
   * Delete a media asset — removes DB record and R2 object.
   * Only the owner can delete; route layer must enforce this.
   */
  async function deleteAsset(assetId: string, ownerId: string): Promise<void> {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, uploadedBy: ownerId },
    })

    if (!asset) throw new Error('Medya kaydı bulunamadı.')
    if (!asset.key) throw new Error('Medya anahtarı eksik, silinemiyor.')

    // Delete from R2 first — if it fails, DB record stays intact
    await deleteObject(asset.key)

    await prisma.mediaAsset.delete({ where: { id: assetId } })
  }

  /**
   * List assets owned by a user/seller for a given folder.
   */
  async function listAssets(
    ownerId: string,
    folder?: MediaFolder,
    opts: { limit?: number; skip?: number } = {},
  ) {
    const { limit = 20, skip = 0 } = opts
    const where = {
      uploadedBy: ownerId,
      ...(folder ? { folder } : {}),
      status: 'ready',
    }

    const [items, total] = await prisma.$transaction([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.mediaAsset.count({ where }),
    ])

    return {
      items,
      total,
      hasMore: skip + items.length < total,
      nextSkip: skip + items.length,
    }
  }

  async function mirrorExternalImage(opts: {
    ownerId: string
    sourceUrl: string
    folder?: MediaFolder
    originalName?: string
  }) {
    const response = await fetch(opts.sourceUrl, {
      headers: {
        'User-Agent': 'Hanuja-Import-Bot/1.0 (+https://www.hanuja.com.tr/bot)',
      },
    })

    if (!response.ok) {
      throw new Error(`Görsel indirilemedi: ${response.status}`)
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
    if (!productAllowedTypes.has(mimeType)) {
      throw new Error(`Desteklenmeyen görsel türü: ${mimeType}`)
    }

    const body = new Uint8Array(await response.arrayBuffer())
    const uploaded = await uploadObject({
      folder: opts.folder ?? 'products',
      mimeType,
      ownerId: opts.ownerId,
      body,
    })

    return prisma.mediaAsset.create({
      data: {
        uploadedBy: opts.ownerId,
        folder: opts.folder ?? 'products',
        key: uploaded.key,
        url: uploaded.publicUrl,
        mimeType,
        originalName: opts.originalName ?? null,
        status: 'ready',
        type: 'product_image',
      },
    })
  }

  return { requestUploadUrl, confirmUpload, deleteAsset, listAssets, mirrorExternalImage }
}

export type MediaService = ReturnType<typeof createMediaService>
