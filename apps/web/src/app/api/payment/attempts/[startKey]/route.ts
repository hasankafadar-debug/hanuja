import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { getCardAttemptState } from '@hanuja/api/routes/card-payments'

// GET /api/payment/attempts/:startKey — başlatma yanıtı kaybolursa denemenin durumu
export async function GET(_req: Request, { params }: { params: Promise<{ startKey: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { startKey } = await params
    return getCardAttemptState(session.user.id, startKey)
  } catch (error) {
    return handleError(error)
  }
}
