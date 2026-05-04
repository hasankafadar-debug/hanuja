import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { created, handleError, ok } from '@hanuja/api/lib/response'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const prisma = createPrismaForRoute()
    const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
    if (!seller) throw new UnauthorizedError('Satıcı hesabı bulunamadı.')

    const service = createSupportTicketService({ prisma })
    const items = await service.listForSeller(seller.id)
    return ok({ items })
  } catch (error) {
    return handleError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const prisma = createPrismaForRoute()
    const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
    if (!seller) throw new UnauthorizedError('Satıcı hesabı bulunamadı.')

    const body = (await req.json().catch(() => ({}))) as {
      subject?: string
      body?: string
      orderId?: string | null
      attachmentAssetIds?: string[]
    }

    const service = createSupportTicketService({ prisma })
    const ticket = await service.createForSeller({
      sellerId: seller.id,
      authorId: session.user.id,
      subject: body.subject ?? '',
      body: body.body ?? '',
      orderId: body.orderId ?? null,
      attachmentAssetIds: Array.isArray(body.attachmentAssetIds) ? body.attachmentAssetIds : [],
    })

    return created({ ticket })
  } catch (error) {
    return handleError(error)
  }
}
