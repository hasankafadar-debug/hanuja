import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { assertRoleCan } from '@hanuja/api/lib/authorize'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createCommissionExemptionService } from '@hanuja/api/services/commission-exemption.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const bodySchema = z.object({
  reason: z.string().trim().min(1),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    assertRoleCan(session.user.role, 'finance:adjust_manual')
    const { id } = await params
    const body = bodySchema.parse(await req.json())

    const prisma = createPrismaForRoute()

    const updated = await createCommissionExemptionService({ prisma }).exempt({
      orderLineId: id,
      adminActorId: session.user.id,
      reason: body.reason,
    })

    return ok({ orderLine: updated })
  } catch (error) {
    return handleError(error)
  }
}
