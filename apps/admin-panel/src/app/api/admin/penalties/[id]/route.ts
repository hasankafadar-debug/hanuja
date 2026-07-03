import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'

const updatePenaltySchema = z
  .object({
    amount: z.union([z.string(), z.number()]).optional(),
    reason: z.string().trim().min(3).max(5000).optional(),
  })
  .refine((data) => data.amount !== undefined || data.reason !== undefined, {
    message: 'En az bir alan guncellenmeli.',
  })

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = updatePenaltySchema.parse(await req.json())
    const prisma = createPrismaForRoute()

    const current = await prisma.penalty.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        reason: true,
        baseAmount: true,
        rate: true,
        penaltyAmount: true,
      },
    })

    if (!current) {
      throw new ValidationError('Ceza bulunamadi.')
    }
    if (current.status === 'waived') {
      throw new ValidationError('Muaf tutulmus cezalar duzenlenemez.')
    }

    const nextPenaltyAmount = body.amount !== undefined ? new Decimal(body.amount) : current.penaltyAmount
    if (nextPenaltyAmount.lessThanOrEqualTo(0)) {
      throw new ValidationError('Ceza tutari sifirdan buyuk olmalidir.')
    }

    const nextRate = current.baseAmount.greaterThan(0)
      ? nextPenaltyAmount.div(current.baseAmount).toDecimalPlaces(4)
      : current.rate

    const updated = await prisma.penalty.update({
      where: { id },
      data: {
        penaltyAmount: nextPenaltyAmount,
        rate: nextRate,
        ...(body.reason !== undefined ? { reason: body.reason as typeof current.reason } : {}),
      },
    })

    console.info('[admin][penalty.updated]', {
      actorId: session.user.id,
      penaltyId: id,
      previousValues: {
        reason: current.reason,
        rate: current.rate.toString(),
        penaltyAmount: current.penaltyAmount.toString(),
      },
      newValues: {
        reason: updated.reason,
        rate: updated.rate.toString(),
        penaltyAmount: updated.penaltyAmount.toString(),
      },
    })

    return ok({ penalty: updated })
  } catch (error) {
    return handleError(error)
  }
}
