import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { cancelOrderAsCustomer } from '@hanuja/api/routes/orders'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// POST /api/orders/:id/cancel — müşteri ön-sevkiyat iptali
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params

    let reason: string | undefined
    try {
      const body = await req.json()
      if (typeof body.reason === 'string' && body.reason.trim()) {
        reason = body.reason.trim()
      }
    } catch {
      // No body or invalid JSON — reason stays undefined
    }

    return cancelOrderAsCustomer(id, session.user.id, reason)
  } catch (err) {
    return handleError(err)
  }
}
