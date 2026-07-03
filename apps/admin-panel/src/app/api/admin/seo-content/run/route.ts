import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { enqueueSeoContentRun } from '@hanuja/api/jobs/seo-content.job'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createSeoContentService } from '@hanuja/api/services/seo-content.service'

const bodySchema = z.object({
  mode: z.enum(['dry_run', 'draft', 'publish']).default('dry_run'),
  maxPosts: z.number().int().min(1).max(5).optional(),
  force: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const rateLimit = checkUserRateLimit(
      session.user.id,
      'admin:seo-content:run',
      SENSITIVE_RATE_LIMIT,
    )
    if (!rateLimit.allowed) return rateLimit.response!

    const body = bodySchema.parse(await req.json().catch(() => ({})))
    const prisma = createPrismaForRoute()
    const service = createSeoContentService({ prisma })
    const run = await service.createRun({
      mode: body.mode,
      triggeredBy: session.user.id,
      ...(body.maxPosts !== undefined ? { maxPosts: body.maxPosts } : {}),
    })

    const job = await enqueueSeoContentRun({
      runId: run.id,
      mode: body.mode,
      ...(body.force !== undefined ? { force: body.force } : {}),
      ...(body.maxPosts !== undefined ? { maxPosts: body.maxPosts } : {}),
      triggeredBy: session.user.id,
    })

    await createAdminAuditLogRepository(prisma).createEntry({
      actorId: session.user.id,
      actionType: 'seo_content_run_triggered',
      targetType: 'seo_content_run',
      targetId: run.id,
      newData: {
        mode: body.mode,
        maxPosts: body.maxPosts ?? null,
        force: body.force ?? false,
        jobId: job.id ?? null,
      },
    })

    return ok(
      {
        runId: run.id,
        jobId: String(job.id ?? run.id),
      },
      202,
    )
  } catch (error) {
    return handleError(error)
  }
}
