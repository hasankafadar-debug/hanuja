import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getCustomerOrder } from '@hanuja/api/routes/orders'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/orders/:id — müşteri sipariş detayı
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return getCustomerOrder(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
