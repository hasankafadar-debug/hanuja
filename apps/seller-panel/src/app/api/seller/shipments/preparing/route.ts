import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { startPreparing } from '@hanuja/api/routes/shipments'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import prisma from '@hanuja/api/lib/prisma'

async function getSellerIdOrThrow(userId: string): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId } })
  if (!seller || (seller.status !== 'active' && seller.status !== 'suspended')) throw new ForbiddenError('Satıcı hesabı sipariş işlemlerine kapalı')
  return seller.id
}

// POST /api/seller/shipments/preparing
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    return startPreparing(req, sellerId)
  } catch (err) {
    return handleError(err)
  }
}
