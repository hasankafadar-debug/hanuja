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
  getAllowedMediaMimeTypes,
  getMediaMaxSizeBytes,
  getObjectMetadata,
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

  function normalizeMimeType(value: string | null | undefined) {
    const mimeType = value?.split(';')[0]?.trim().toLowerCase()
    return mimeType || null
  }

  async function rejectUploadedAsset(
    asset: { id: string; key: string | null },
    sizeBytes?: number,
  ) {
    const cleanup = asset.key ? deleteObject(asset.key) : null

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: 'rejected',
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      },
    })

    if (!cleanup) return

    try {
      await cleanup
    } catch {
      // The DB record remains rejected even if object cleanup needs a retry.
      console.warn('[media] rejected upload cleanup failed', { assetId: asset.id })
    }
  }

  async function readExternalResponseWithinLimit(
    response: Response,
    maxBytes: number,
  ): Promise<Uint8Array> {
    if (!response.body) throw new ValidationError('Gorsel icerigi okunamadi.')

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          await reader.cancel()
          throw new ValidationError(
            `Gorsel dosyasi en fazla ${Math.round(maxBytes / 1024 / 1024)} MB olabilir.`,
          )
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  }

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
    const isDocument = folder === 'documents' || folder === 'customer-support'
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

    if (!asset.key) {
      await rejectUploadedAsset(asset)
      throw new ValidationError('Yuklenen dosya dogrulanamadi.')
    }

    let objectMetadata: Awaited<ReturnType<typeof getObjectMetadata>>
    try {
      objectMetadata = await getObjectMetadata(asset.key)
    } catch {
      await rejectUploadedAsset(asset)
      throw new ValidationError('Yuklenen dosya dogrulanamadi.')
    }

    const folder = (asset.folder as MediaFolder | null) ?? 'general'
    const maxSizeBytes = getMediaMaxSizeBytes(folder)
    const actualMimeType = normalizeMimeType(objectMetadata.contentType)
    const actualSizeBytes = objectMetadata.contentLength
    const declaredMimeType = normalizeMimeType(asset.mimeType)

    if (actualSizeBytes === null || !Number.isSafeInteger(actualSizeBytes) || actualSizeBytes < 0) {
      await rejectUploadedAsset(asset)
      throw new ValidationError('Yuklenen dosyanin boyutu dogrulanamadi.')
    }

    if (actualSizeBytes > maxSizeBytes) {
      await rejectUploadedAsset(asset, actualSizeBytes)
      throw new ValidationError(
        `Dosya boyutu en fazla ${Math.round(maxSizeBytes / 1024 / 1024)} MB olabilir.`,
      )
    }

    if (
      !actualMimeType ||
      actualMimeType !== declaredMimeType ||
      !getAllowedMediaMimeTypes(folder).has(actualMimeType)
    ) {
      await rejectUploadedAsset(asset, actualSizeBytes)
      throw new ValidationError('Yuklenen dosya turu dogrulanamadi.')
    }

    // Video-specific validation for slider folder
    if (asset.kind === 'video') {
      const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
      const VIDEO_MAX_DURATION_SEC = 15

      if (actualSizeBytes > VIDEO_MAX_SIZE_BYTES) {
        await rejectUploadedAsset(asset, actualSizeBytes)
        throw new ValidationError(
          `Video dosyası 10 MB sınırını aşıyor (yüklenen: ${(actualSizeBytes / 1024 / 1024).toFixed(1)} MB).`,
        )
      }

      if (asset.durationSec != null && asset.durationSec > VIDEO_MAX_DURATION_SEC) {
        await rejectUploadedAsset(asset, actualSizeBytes)
        throw new ValidationError(
          `Video süresi 15 saniyeyi geçemez (yüklenen: ${asset.durationSec} saniye).`,
        )
      }
    }

    if (asset.folder === 'products') {
      try {
        const object = await readObject(asset.key, maxSizeBytes)
        const metadata = parseImageMetadata(object.body, actualMimeType)

        if (!productAllowedTypes.has(actualMimeType)) {
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
        await rejectUploadedAsset(asset, actualSizeBytes)
        throw error
      }
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: 'ready', sizeBytes: actualSizeBytes },
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
    const folder = opts.folder ?? 'products'
    const maxSizeBytes = getMediaMaxSizeBytes(folder)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    let body: Uint8Array
    let mimeType: string
    try {
      const response = await fetch(opts.sourceUrl, {
        headers: {
          'User-Agent': 'Hanuja-Import-Bot/1.0 (+https://www.hanuja.com.tr/bot)',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Görsel indirilemedi: ${response.status}`)
      }

      mimeType = normalizeMimeType(response.headers.get('content-type')) ?? ''
      if (!productAllowedTypes.has(mimeType)) {
        throw new Error(`Desteklenmeyen görsel türü: ${mimeType || 'bilinmiyor'}`)
      }

      const contentLength = response.headers.get('content-length')
      if (contentLength) {
        const declaredBytes = Number(contentLength)
        if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
          throw new ValidationError('Gorsel boyutu dogrulanamadi.')
        }
        if (declaredBytes > maxSizeBytes) {
          await response.body?.cancel()
          throw new ValidationError(
            `Gorsel dosyasi en fazla ${Math.round(maxSizeBytes / 1024 / 1024)} MB olabilir.`,
          )
        }
      }

      body = await readExternalResponseWithinLimit(response, maxSizeBytes)
    } finally {
      clearTimeout(timeout)
    }

    const uploaded = await uploadObject({
      folder,
      mimeType,
      ownerId: opts.ownerId,
      body,
    })

    return prisma.mediaAsset.create({
      data: {
        uploadedBy: opts.ownerId,
        folder,
        key: uploaded.key,
        url: uploaded.publicUrl,
        mimeType,
        originalName: opts.originalName ?? null,
        status: 'ready',
        sizeBytes: body.byteLength,
        type: 'product_image',
      },
    })
  }

  return { requestUploadUrl, confirmUpload, deleteAsset, listAssets, mirrorExternalImage }
}

export type MediaService = ReturnType<typeof createMediaService>
