import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { listNotifications, markAllNotificationsRead } from '@hanuja/api/routes/notifications'

// GET /api/notifications — list notifications for current user
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listNotifications(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/notifications — mark all as read
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return markAllNotificationsRead(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
