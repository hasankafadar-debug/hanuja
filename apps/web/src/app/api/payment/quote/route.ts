import { headers } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import {
  checkRateLimit,
  checkUserRateLimit,
  SENSITIVE_RATE_LIMIT,
} from '@hanuja/api/lib/rate-limit'
import { quoteCardPayment } from '@hanuja/api/routes/card-payments'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'

const QUOTE_USER_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 }

// POST /api/payment/quote — BIN (ilk 8 hane) + taksit sayısı için sunucu teklifi
export async function POST(req: NextRequest) {
  if (!isCardPaymentsEnabled()) {
    return NextResponse.json(
      { success: false, code: 'CARD_PAYMENTS_DISABLED', message: 'Kartla ödeme şu anda kullanılamıyor.' },
      { status: 503 },
    )
  }
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const rl = await checkRateLimit(req, 'payment:quote', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response!
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const userRl = await checkUserRateLimit(session.user.id, 'payment:quote', QUOTE_USER_RATE_LIMIT)
    if (!userRl.allowed) return userRl.response!
    return quoteCardPayment(req, session.user.id)
  } catch (error) {
    return handleError(error)
  }
}
