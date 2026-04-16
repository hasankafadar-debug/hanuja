import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { markNotificationRead } from '@hanuja/api/routes/notifications'

// POST /api/notifications/:id/read
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return markNotificationRead(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
