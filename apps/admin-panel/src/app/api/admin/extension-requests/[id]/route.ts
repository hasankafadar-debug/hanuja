import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createExtensionRequestService } from '@hanuja/api/services/extension-request.service'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    approvedDays: z.number().int().min(1).max(30),
    adminNote: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal('reject'),
    adminNote: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('escalate_to_customer'),
    questionForCustomer: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('send_back_to_seller'),
    adminNote: z.string().trim().min(1),
  }),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = bodySchema.parse(await req.json())
    const service = createExtensionRequestService({ prisma: createPrismaForRoute() })

    if (body.action === 'approve') {
      const updated = await service.approveByAdmin({
        requestId: id,
        adminActorId: session.user.id,
        approvedDays: body.approvedDays,
        ...(body.adminNote !== undefined ? { adminNote: body.adminNote } : {}),
      })
      return ok({ request: updated })
    }

    if (body.action === 'reject') {
      const updated = await service.rejectByAdmin({
        requestId: id,
        adminActorId: session.user.id,
        adminNote: body.adminNote,
      })
      return ok({ request: updated })
    }

    if (body.action === 'escalate_to_customer') {
      const updated = await service.escalateToCustomer({
        requestId: id,
        adminActorId: session.user.id,
        questionForCustomer: body.questionForCustomer,
      })
      return ok({ request: updated })
    }

    const updated = await service.sendBackToSeller({
      requestId: id,
      adminActorId: session.user.id,
      adminNote: body.adminNote,
    })
    return ok({ request: updated })
  } catch (error) {
    return handleError(error)
  }
}
