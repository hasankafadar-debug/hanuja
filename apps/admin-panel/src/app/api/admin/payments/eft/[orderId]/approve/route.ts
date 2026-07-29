import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { approveEft } from '@hanuja/api/routes/payments'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { assertRoleCan } from '@hanuja/api/lib/authorize'
import { handleError } from '@hanuja/api/lib/response'
import { requireAdminStepUp } from '@/lib/step-up'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    assertRoleCan(session.user.role, 'payment:approve_eft')
    await requireAdminStepUp(req, session, 'eft:approve')
    const { orderId } = await params
    return approveEft(req, orderId, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
