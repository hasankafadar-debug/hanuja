import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPenaltyService } from '@hanuja/api/services/penalty.service'
import { handleError, ok } from '@hanuja/api/lib/response'

const updatePenaltySchema = z
  .object({
    amount: z.union([z.string(), z.number()]).optional(),
    reason: z.string().trim().min(3).max(5000),
  })
  .refine((data) => data.amount !== undefined || data.reason !== undefined, {
    message: 'En az bir alan guncellenmeli.',
  })

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = updatePenaltySchema.parse(await req.json())
    const prisma = createPrismaForRoute()

    const updated = await createPenaltyService({ prisma }).update({
      penaltyId: id,
      adminActorId: session.user.id,
      ...(body.amount !== undefined ? { amount: new Decimal(body.amount) } : {}),
      reason: body.reason,
    })

    return ok({ penalty: updated })
  } catch (error) {
    return handleError(error)
  }
}
