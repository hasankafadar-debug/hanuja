import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { cancelOrderAsCustomer } from '@hanuja/api/routes/orders'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// POST /api/orders/:id/cancel — müşteri ön-sevkiyat iptali
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return cancelOrderAsCustomer(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
