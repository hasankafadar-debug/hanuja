import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { completeManualRefund } from '@hanuja/api/routes/refunds'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = checkCsrf(request)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    return completeManualRefund(request, id, session.user.id)
  } catch (error) {
    return handleError(error)
  }
}
