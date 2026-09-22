import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createNotificationOperationsService } from '@hanuja/api/services/notification-operations.service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const body = z
      .object({
        reason: z.string().trim().min(10).max(500),
        kind: z.enum(['delivery', 'outbox']),
      })
      .parse(await req.json())
    const { id } = await params
    return ok(
      await createNotificationOperationsService(createPrismaForRoute()).retry(
        session.user.id,
        id,
        body.reason,
        body.kind,
      ),
    )
  } catch (error) {
    return handleError(error)
  }
}
