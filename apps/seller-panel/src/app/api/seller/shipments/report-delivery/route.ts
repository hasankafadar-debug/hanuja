import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerDeliveryReportService } from '@hanuja/api/services/seller-delivery-report.service'

const bodySchema = z.object({ orderId: z.string().min(1) })

export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const limit = await checkRateLimit(req, 'seller:report-delivery', API_RATE_LIMIT)
    if (!limit.allowed) return limit.response!
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const prisma = createPrismaForRoute()
    const seller = await prisma.seller.findUnique({
      where: { userId: session.user.id },
    })
    if (!seller || !['active', 'suspended'].includes(seller.status)) throw new ForbiddenError()
    const { orderId } = bodySchema.parse(await req.json().catch(() => null))
    return ok(
      await createSellerDeliveryReportService({ prisma }).report({
        orderId,
        sellerId: seller.id,
        actorId: session.user.id,
      }),
    )
  } catch (error) {
    return handleError(error)
  }
}
