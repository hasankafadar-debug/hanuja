import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { getSupportTicket } from '@hanuja/api/routes/customer-support-tickets'

// GET /api/support-tickets/:id — destek talebi detayı (müşteri)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return getSupportTicket(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
