import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import {
  CRITICAL_CAPABILITIES,
  issueStepUpGrant,
  requireStrictRateLimit,
  verifyAdminTotp,
} from '@hanuja/api/lib/auth-security'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { handleError, ok } from '@hanuja/api/lib/response'

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  capability: z.enum(CRITICAL_CAPABILITIES),
})

export async function POST(request: NextRequest) {
  try {
    const authSession = await auth.api.getSession({ headers: await headers() }) as unknown as {
      user?: { id: string; role: string }; session?: { id?: string }
    }
    if (!authSession.user) throw new UnauthorizedError()
    if (authSession.user.role !== 'admin') throw new ForbiddenError()
    if (!authSession.session?.id) throw new ForbiddenError()

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip') ?? 'unknown'
    await requireStrictRateLimit(`${ip}:/api/admin/security/step-up`)

    const body = bodySchema.parse(await request.json())
    const prisma = createPrismaForRoute()
    if (!(await verifyAdminTotp(prisma, authSession.user.id, body.code))) {
      throw new ForbiddenError('Dogrulama kodu gecersiz')
    }

    const token = await issueStepUpGrant({
      userId: authSession.user.id,
      sessionId: authSession.session.id,
      capability: body.capability,
    })
    await createAdminAuditLogRepository(prisma).createEntry({
      actorId: authSession.user.id,
      actionType: 'security_step_up_verified',
      targetType: 'security_capability',
      targetId: body.capability,
      // Deliberately excludes OTP, session token, device details and any secret.
      newData: { capability: body.capability },
    })
    return ok({ token, expiresIn: 300 })
  } catch (error) {
    if (error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 429) {
      return Response.json({ success: false, code: 'RATE_LIMITED' }, { status: 429 })
    }
    return handleError(error)
  }
}
