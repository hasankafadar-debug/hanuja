import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { adminListSupportTickets } from '@hanuja/api/routes/customer-support-tickets'

// GET /api/admin/customer-support-tickets
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    return adminListSupportTickets(req)
  } catch (err) {
    return handleError(err)
  }
}
