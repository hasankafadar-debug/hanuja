import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'

async function getSellerContext() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) throw new UnauthorizedError('Satıcı hesabı bulunamadı.')

  return { session, seller, prisma }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, seller, prisma } = await getSellerContext()
    const { id } = await params
    const service = createSupportTicketService({ prisma })
    const ticket = await service.getForSeller(id, seller.id)
    return ok({ ticket, viewerId: session.user.id })
  } catch (error) {
    return handleError(error)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, seller, prisma } = await getSellerContext()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { body?: string; attachmentAssetIds?: string[] }

    const service = createSupportTicketService({ prisma })
    const ticket = await service.addSellerMessage({
      ticketId: id,
      sellerId: seller.id,
      authorId: session.user.id,
      body: body.body ?? '',
      attachmentAssetIds: Array.isArray(body.attachmentAssetIds) ? body.attachmentAssetIds : [],
    })

    return ok({ ticket })
  } catch (error) {
    return handleError(error)
  }
}
