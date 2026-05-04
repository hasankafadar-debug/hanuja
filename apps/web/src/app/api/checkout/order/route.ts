import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { verifyTurnstileToken } from '@hanuja/api/lib/turnstile'
import { createOrder, createOrderSchema } from '@hanuja/api/routes/checkout'

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) {
    return csrfError
  }

  const rl = checkRateLimit(req, 'checkout:order', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) {
    return rl.response!
  }

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      throw new UnauthorizedError()
    }

    if (!session.user.emailVerified) {
      return NextResponse.json(
        { message: 'Siparis olusturmadan once e-posta adresinizi dogrulamaniz gerekir.' },
        { status: 403 },
      )
    }

    const body = createOrderSchema.parse(await req.json())
    const turnstileResult = await verifyTurnstileToken({
      token: body.turnstileToken,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      action: 'checkout-submit',
    })

    if (!turnstileResult.success) {
      return NextResponse.json(
        { message: turnstileResult.message ?? 'Insan dogrulamasi tamamlanamadi.' },
        { status: 400 },
      )
    }

    return createOrder(req, session.user.id, body)
  } catch (error) {
    return handleError(error)
  }
}
