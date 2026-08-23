/**
 * Media Processing Job — post-upload tasks for newly uploaded image assets.
 *
 * Pipeline for each image asset:
 *   1. Verify the original object exists in R2.
 *   2. If kind === 'image' and mimeType is a raster image:
 *      a. Download original bytes from R2.
 *      b. Home CMS images receive responsive 400/800/1200/1600 WebP variants.
 *         Other folders retain the legacy thumb/medium pipeline.
 *      d. Write variants JSON + original dimensions to MediaAsset record.
 *   3. Mark verifiedAt.
 *
 * Idempotent: updateMany on status='ready' guard ensures safe retries.
 */
import { Worker, Job } from 'bullmq'
import sharp from 'sharp'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import {
  getMediaMaxSizeBytes,
  objectExists,
  readObject,
  uploadBufferWithKey,
  type MediaFolder,
} from '../lib/r2'
import {
  generateHomeMediaVariants,
  MAX_MEDIA_IMAGE_DIMENSION,
  MAX_MEDIA_INPUT_PIXELS,
  SHARP_INPUT_OPTIONS,
} from '../lib/home-media-variants'

export interface MediaProcessingJobData {
  assetId: string
  key: string
  mimeType: string
}

const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export { MAX_MEDIA_IMAGE_DIMENSION, MAX_MEDIA_INPUT_PIXELS, SHARP_INPUT_OPTIONS }

export interface MediaVariantRecord {
  key: string
  url: string
  width: number
  height: number
}

export interface MediaVariants {
  thumb: MediaVariantRecord
  medium: MediaVariantRecord
}

const HOME_MEDIA_FOLDERS = new Set<MediaFolder>(['slider', 'promo'])

function variantKey(originalKey: string, suffix: string): string {
  // products/owner/uuid.jpg  →  products/owner/uuid_thumb.webp
  const dotIndex = originalKey.lastIndexOf('.')
  const base = dotIndex >= 0 ? originalKey.slice(0, dotIndex) : originalKey
  return `${base}_${suffix}.webp`
}

export async function generateVariants(
  originalBytes: Uint8Array,
  originalKey: string,
  cdnUrl: string,
  sharpFactory: typeof sharp = sharp,
): Promise<{ variants: MediaVariants; width: number; height: number }> {
  const image = sharpFactory(Buffer.from(originalBytes), SHARP_INPUT_OPTIONS)
  const meta = await image.metadata()
  const originalWidth = meta.width ?? 0
  const originalHeight = meta.height ?? 0

  const VARIANTS = [
    { suffix: 'thumb', width: 320, quality: 75 },
    { suffix: 'medium', width: 800, quality: 82 },
  ] as const

  const results: Partial<Record<string, MediaVariantRecord>> = {}

  for (const v of VARIANTS) {
    const outputBuffer = await sharpFactory(Buffer.from(originalBytes), SHARP_INPUT_OPTIONS)
      .resize(v.width, v.width, {
        fit: 'contain',
        withoutEnlargement: true,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .webp({ quality: v.quality })
      .toBuffer()

    const outMeta = await sharpFactory(outputBuffer, SHARP_INPUT_OPTIONS).metadata()
    const key = variantKey(originalKey, v.suffix)
    const { publicUrl } = await uploadBufferWithKey({
      key,
      body: new Uint8Array(outputBuffer),
      mimeType: 'image/webp',
    })

    results[v.suffix] = {
      key,
      url: publicUrl,
      width: outMeta.width ?? v.width,
      height: outMeta.height ?? v.width,
    }
  }

  return {
    variants: results as unknown as MediaVariants,
    width: originalWidth,
    height: originalHeight,
  }
}

async function processMediaJob(job: Job<MediaProcessingJobData>) {
  const { assetId, key, mimeType } = job.data

  const exists = await objectExists(key)
  if (!exists) {
    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'ready' },
      data: { status: 'failed' },
    })
    throw new Error(`R2 object not found for asset ${assetId} at key ${key}`)
  }

  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } })
  const isImage = RASTER_MIME_TYPES.has(mimeType) && asset?.kind === 'image'

  if (isImage) {
    const folder = (asset.folder as MediaFolder | null) ?? 'general'
    const { body } = await readObject(key, getMediaMaxSizeBytes(folder))
    const isHomeMedia = HOME_MEDIA_FOLDERS.has(folder)
    const { variants, width, height } = isHomeMedia
      ? await generateHomeMediaVariants(body, key)
      : await generateVariants(body, key, '')

    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'ready' },
      data: {
        verifiedAt: new Date(),
        width,
        height,
        variants: variants as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    })

    console.log(`[media-processing] Asset ${assetId} processed — folder=${folder}`)
  } else {
    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'ready' },
      data: { verifiedAt: new Date() },
    })

    console.log(`[media-processing] Asset ${assetId} verified — key=${key} mimeType=${mimeType}`)
  }
}

export function startMediaProcessingWorker() {
  const worker = new Worker<MediaProcessingJobData>(QUEUE_NAMES.MEDIA_PROCESSING, processMediaJob, {
    connection: redis,
    concurrency: 3,
  })

  worker.on('failed', (job, err) => {
    console.error(`[media-processing] Job ${job?.id} failed:`, err.message)
  })

  return worker
}
