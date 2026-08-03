import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { addDisputeMessage } from '@hanuja/api/routes/disputes'
import type { DisputeViewer } from '@hanuja/api/lib/dispute-authorization'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const rl = await checkUserRateLimit(session.user.id, 'disputes:message', API_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    const { id } = await params
    return addDisputeMessage(req, id, {
      viewerId: session.user.id,
      viewerRole: session.user.role as DisputeViewer['viewerRole'],
    })
  } catch (err) {
    return handleError(err)
  }
}
