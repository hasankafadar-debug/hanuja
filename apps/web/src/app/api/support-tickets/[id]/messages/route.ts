import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { replySupportTicket } from '@hanuja/api/routes/customer-support-tickets'

// POST /api/support-tickets/:id/messages — müşteri yanıtı
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return replySupportTicket(req, id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
