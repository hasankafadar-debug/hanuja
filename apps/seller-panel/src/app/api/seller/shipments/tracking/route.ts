import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { enterTracking } from '@hanuja/api/routes/shipments'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import prisma from '@hanuja/api/lib/prisma'

async function getSellerIdOrThrow(userId: string): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId } })
  if (!seller || seller.status !== 'active') throw new ForbiddenError('Aktif satıcı hesabı gerekli')
  return seller.id
}

// POST /api/seller/shipments/tracking
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 'seller:tracking', API_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    return enterTracking(req, sellerId)
  } catch (err) {
    return handleError(err)
  }
}
