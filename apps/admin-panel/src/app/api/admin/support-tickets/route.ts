import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const service = createSupportTicketService({ prisma: createPrismaForRoute() })
    const items = await service.listForAdmin()
    return ok({ items })
  } catch (error) {
    return handleError(error)
  }
}
