import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { markNotificationRead } from '@hanuja/api/routes/notifications'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    return markNotificationRead(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
