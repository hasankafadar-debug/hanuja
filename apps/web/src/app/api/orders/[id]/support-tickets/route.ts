import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'
import {
  createSupportTicket,
  listSupportTicketsForOrder,
} from '@hanuja/api/routes/customer-support-tickets'

// POST /api/orders/:id/support-tickets — yeni destek talebi aç
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const rl = await checkUserRateLimit(session.user.id, 'support-tickets:create', API_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    const { id } = await params
    return createSupportTicket(req, id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/orders/:id/support-tickets — sipariş destek talebi geçmişi
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return listSupportTicketsForOrder(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
