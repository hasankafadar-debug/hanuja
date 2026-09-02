import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createQuantityCancellation } from '@hanuja/api/routes/orders'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const rateLimit = await checkRateLimit(req, 'orders:quantity-cancel', SENSITIVE_RATE_LIMIT)
  if (!rateLimit.allowed) return rateLimit.response!

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return createQuantityCancellation(req, id, session.user.id)
  } catch (error) {
    return handleError(error)
  }
}
