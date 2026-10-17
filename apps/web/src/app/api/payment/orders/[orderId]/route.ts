import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { getCardOrderPaymentState } from '@hanuja/api/routes/card-payments'

// GET /api/payment/orders/:orderId — ödenmemiş kart siparişinin yeniden ödenebilirliği
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { orderId } = await params
    return getCardOrderPaymentState(session.user.id, orderId)
  } catch (error) {
    return handleError(error)
  }
}
