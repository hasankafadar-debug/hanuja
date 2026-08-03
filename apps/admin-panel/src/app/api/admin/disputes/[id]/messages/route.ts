import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { addDisputeMessage } from '@hanuja/api/routes/disputes'
import type { DisputeViewer } from '@hanuja/api/lib/dispute-authorization'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    return addDisputeMessage(req, id, {
      viewerId: session.user.id,
      viewerRole: session.user.role as DisputeViewer['viewerRole'],
    })
  } catch (err) {
    return handleError(err)
  }
}
