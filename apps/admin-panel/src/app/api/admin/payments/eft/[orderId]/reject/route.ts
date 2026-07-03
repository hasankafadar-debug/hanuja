import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { rejectEft } from '@hanuja/api/routes/payments'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { assertRoleCan } from '@hanuja/api/lib/authorize'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    assertRoleCan(session.user.role, 'payment:reject_eft')
    const { orderId } = await params
    return rejectEft(req, orderId, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
