import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { listCustomerOrders } from '@hanuja/api/routes/orders'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/orders — müşteri sipariş listesi
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listCustomerOrders(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
