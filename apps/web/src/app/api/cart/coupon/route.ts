import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { applyCoupon, removeCoupon } from '@hanuja/api/routes/cart'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'

// POST /api/cart/coupon — high-risk: coupon abuse vector
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 'cart:coupon', HIGH_RISK_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return applyCoupon(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart/coupon
export async function DELETE() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return removeCoupon(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
