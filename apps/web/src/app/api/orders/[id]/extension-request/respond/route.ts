import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createExtensionRequestService } from '@hanuja/api/services/extension-request.service'

const bodySchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  responseNote: z.string().trim().max(2000).optional(),
})

function extractIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() ?? null
  return req.headers.get('x-real-ip')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const reqHeaders = await headers()
    const session = await auth.api.getSession({ headers: reqHeaders })
    if (!session?.user) throw new UnauthorizedError()

    const { id: orderId } = await params
    const body = bodySchema.parse(await req.json())

    const prisma = createPrismaForRoute()
    const request = await prisma.fulfillmentExtensionRequest.findUnique({
      where: { id: body.requestId },
      select: { id: true, orderId: true, customerId: true },
    })
    if (!request) throw new ValidationError('Ek süre talebi bulunamadı.')
    if (request.orderId !== orderId) throw new ValidationError('Talep bu siparişe ait değil.')

    // Capture the active session row as legal evidence. Better Auth keeps the
    // session row keyed by user; we pick the latest non-expired one.
    const activeSession = await prisma.session.findFirst({
      where: {
        userId: session.user.id,
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })

    const service = createExtensionRequestService({ prisma })
    const updated = await service.respondByCustomer({
      requestId: body.requestId,
      customerId: session.user.id,
      decision: body.decision,
      ...(body.responseNote !== undefined ? { responseNote: body.responseNote } : {}),
      ipAddress: extractIp(req),
      userAgent: req.headers.get('user-agent'),
      sessionId: activeSession?.id ?? null,
    })

    return ok({ request: updated })
  } catch (error) {
    return handleError(error)
  }
}
