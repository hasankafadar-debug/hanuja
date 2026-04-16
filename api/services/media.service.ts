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
  type MediaFolder,
} from '../lib/r2'
import { mediaProcessingQueue } from '../lib/queue'

export interface MediaServiceDeps {
  prisma: PrismaClient
}

export function createMediaService({ prisma }: MediaServiceDeps) {
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

    const { uploadUrl, key, publicUrl, expiresIn } = await generatePresignedUploadUrl({
      folder,
      mimeType,
      ownerId,
    })

    // Create a pending record — confirmed after successful upload
    const asset = await prisma.mediaAsset.create({
      data: {
        uploadedBy: ownerId,
        folder,
        key,
        url: publicUrl,
        mimeType,
        originalName: originalName ?? null,
        status: 'pending',
        type: 'product_image', // default — updated when attached to a specific entity
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
    return prisma.mediaAsset.findMany({
      where: {
        uploadedBy: ownerId,
        ...(folder ? { folder } : {}),
        status: 'ready',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    })
  }

  return { requestUploadUrl, confirmUpload, deleteAsset, listAssets }
}

export type MediaService = ReturnType<typeof createMediaService>
