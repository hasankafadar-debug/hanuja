import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireAdminStepUp } from '@/lib/step-up'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { completeManualRefund } from '@hanuja/api/routes/refunds'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    await requireAdminStepUp(request, session, 'finance:adjustment')
    const { id } = await params
    return completeManualRefund(request, id, session.user.id)
  } catch (error) {
    return handleError(error)
  }
}
