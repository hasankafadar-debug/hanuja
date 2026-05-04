import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const service = createSupportTicketService({ prisma: createPrismaForRoute() })
    const ticket = await service.resolveAsAdmin({ ticketId: id, adminId: session.user.id })
    return ok({ ticket })
  } catch (error) {
    return handleError(error)
  }
}
