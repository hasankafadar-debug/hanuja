import { type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { sellerReturnInvoice } from '@hanuja/api/routes/seller-return-invoices'
import { handleError } from '@hanuja/api/lib/response'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'seller' || session.user.mustChangePassword)
      throw new ForbiddenError()
    const seller = await createPrismaForRoute().seller.findUnique({
      where: { userId: session.user.id },
      select: { id: true, status: true },
    })
    if (!seller || !['active', 'suspended'].includes(seller.status)) throw new ForbiddenError()
    const { id } = await ctx.params
    return sellerReturnInvoice(req, id, seller.id)
  } catch (err) {
    return handleError(err)
  }
}
