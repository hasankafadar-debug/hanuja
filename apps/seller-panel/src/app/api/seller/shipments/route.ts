import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import {
  listSellerShipments,
} from '@hanuja/api/routes/shipments'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import prisma from '@hanuja/api/lib/prisma'

async function getSellerIdOrThrow(userId: string): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId } })
  if (!seller || (seller.status !== 'active' && seller.status !== 'suspended')) {
    throw new ForbiddenError('Aktif satıcı hesabı gerekli')
  }
  return seller.id
}

// GET /api/seller/shipments
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    return listSellerShipments(req, sellerId)
  } catch (err) {
    return handleError(err)
  }
}
