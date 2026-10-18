import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { ok, handleError } from '@hanuja/api/lib/response'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    const body = z.object({ lastSeenMessageId: z.string().min(1).max(64) }).parse(await readJsonBody(req))
    return ok(await createProductQuestionService({ prisma: createPrismaForRoute() }).completeAdminReview({
      threadId: id, adminId: session.user.id, lastSeenMessageId: body.lastSeenMessageId,
    }))
  } catch (error) {
    return handleError(error)
  }
}
