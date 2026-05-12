import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { adminResolveSupportTicket } from '@hanuja/api/routes/customer-support-tickets'

// POST /api/admin/customer-support-tickets/:id/resolve
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    return adminResolveSupportTicket(req, id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
