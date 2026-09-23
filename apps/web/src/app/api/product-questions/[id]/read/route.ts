import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkRateLimit, checkUserRateLimit } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'
import {
  markProductQuestionRead,
  PRODUCT_QUESTION_IP_RATE_LIMIT,
  PRODUCT_QUESTION_READ_RATE_LIMIT,
} from '@hanuja/api/routes/product-questions'

// POST /api/product-questions/:id/read — ekranda gösterilen son mesajı okundu işaretle
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const ipLimit = await checkRateLimit(req, 'product-questions', PRODUCT_QUESTION_IP_RATE_LIMIT)
  if (!ipLimit.allowed) return ipLimit.response!

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const userLimit = await checkUserRateLimit(
      session.user.id,
      'product-questions:read',
      PRODUCT_QUESTION_READ_RATE_LIMIT,
    )
    if (!userLimit.allowed) return userLimit.response!

    const { id } = await params
    return markProductQuestionRead(req, id, { role: 'customer', customerId: session.user.id })
  } catch (err) {
    return handleError(err)
  }
}
