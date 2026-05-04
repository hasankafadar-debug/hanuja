import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { listNotifications, markAllNotificationsRead } from '@hanuja/api/routes/notifications'

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    return listNotifications(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    return markAllNotificationsRead(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
