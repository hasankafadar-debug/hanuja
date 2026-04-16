/**
 * Media Processing Job — post-upload tasks for newly uploaded assets.
 *
 * Runs after the client confirms a successful R2 upload.
 * Currently: verifies object exists and logs. Future: generate thumbnails,
 * extract image dimensions, run content moderation scan.
 *
 * Idempotent: safe to retry — only updates DB metadata, no destructive writes.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { objectExists } from '../lib/r2'

export interface MediaProcessingJobData {
  assetId: string
  key: string
  mimeType: string
}

async function processMediaJob(job: Job<MediaProcessingJobData>) {
  const { assetId, key, mimeType } = job.data

  // Verify the object actually landed in R2
  const exists = await objectExists(key)
  if (!exists) {
    // Mark asset as failed — it won't appear in public listings
    await prisma.mediaAsset.updateMany({
      where: { id: assetId, status: 'ready' },
      data: { status: 'failed' },
    })
    throw new Error(`R2 object not found for asset ${assetId} at key ${key}`)
  }

  // Update asset with verified flag and basic metadata
  await prisma.mediaAsset.updateMany({
    where: { id: assetId, status: 'ready' },
    data: { verifiedAt: new Date() },
  })

  console.log(`[media-processing] Asset ${assetId} verified — key=${key} mimeType=${mimeType}`)
}

export function startMediaProcessingWorker() {
  const worker = new Worker<MediaProcessingJobData>(
    QUEUE_NAMES.MEDIA_PROCESSING,
    processMediaJob,
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[media-processing] Job ${job?.id} failed:`, err.message)
  })

  return worker
}
