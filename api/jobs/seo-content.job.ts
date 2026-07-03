import { Worker, type Job } from 'bullmq'
import { createSeoContentService } from '../services/seo-content.service'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { QUEUE_NAMES } from '../lib/queue'
import type { SeoContentRunMode } from '../services/seo-content.service'

export interface SeoContentJobData {
  runId?: string
  mode?: SeoContentRunMode
  force?: boolean
  dryRun?: boolean
  maxPosts?: number
  triggeredBy?: string | null
}

export async function processSeoContentJob(job: Job<SeoContentJobData>) {
  const service = createSeoContentService({ prisma })
  const result = await service.runWeeklyTopicalAuthorityAutomation({
    ...(job.data.runId ? { runId: job.data.runId } : {}),
    ...(job.data.mode ? { mode: job.data.mode } : {}),
    ...(job.data.force !== undefined ? { force: job.data.force } : {}),
    ...(job.data.dryRun !== undefined ? { dryRun: job.data.dryRun } : {}),
    ...(job.data.maxPosts !== undefined ? { maxPosts: job.data.maxPosts } : {}),
    ...(job.data.triggeredBy !== undefined ? { triggeredBy: job.data.triggeredBy } : {}),
  })

  console.log(
    `[seo-content] run=${result.runId ?? 'n/a'} mode=${result.mode} status=${result.status} evaluated=${result.evaluatedCandidates} approved=${result.approvedCandidates} drafts=${result.draftedPosts.length} published=${result.publishedPosts.length}`,
  )

  return result
}

export async function enqueueSeoContentRun(params: SeoContentJobData = {}) {
  const { seoContentQueue } = await import('../lib/queue')
  return seoContentQueue.add('seo-content-manual-run', params, {
    ...(params.runId ? { jobId: params.runId } : {}),
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  })
}

export function startSeoContentWorker() {
  const worker = new Worker<SeoContentJobData>(
    QUEUE_NAMES.SEO_CONTENT,
    processSeoContentJob,
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[seo-content] Job ${job?.id} failed:`, err)
  })

  return worker
}
