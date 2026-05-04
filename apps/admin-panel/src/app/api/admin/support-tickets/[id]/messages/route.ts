import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = (await req.json().catch(() => ({}))) as { body?: string; attachmentAssetIds?: string[] }
    const { id } = await params
    const service = createSupportTicketService({ prisma: createPrismaForRoute() })
    const ticket = await service.addAdminMessage({
      ticketId: id,
      adminId: session.user.id,
      body: body.body ?? '',
      attachmentAssetIds: Array.isArray(body.attachmentAssetIds) ? body.attachmentAssetIds : [],
    })

    return ok({ ticket })
  } catch (error) {
    return handleError(error)
  }
}
