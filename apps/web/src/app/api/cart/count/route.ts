import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ok, handleError } from '@hanuja/api/lib/response'
import { createCartService } from '@hanuja/api/services/cart.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return ok({ count: 0 })
    }

    const service = createCartService({ prisma: createPrismaForRoute() })
    const cart = await service.getCart(session.user.id)
    return ok({ count: cart.itemCount })
  } catch (err) {
    return handleError(err)
  }
}
