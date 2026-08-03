import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getDispute } from '@hanuja/api/routes/disputes'
import type { DisputeViewer } from '@hanuja/api/lib/dispute-authorization'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return getDispute(id, {
      viewerId: session.user.id,
      viewerRole: session.user.role as DisputeViewer['viewerRole'],
    })
  } catch (err) {
    return handleError(err)
  }
}
