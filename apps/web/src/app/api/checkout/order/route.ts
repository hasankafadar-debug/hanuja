import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createOrder } from '@hanuja/api/routes/checkout'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

// POST /api/checkout/order
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const rl = checkRateLimit(req, 'checkout:order', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return createOrder(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
