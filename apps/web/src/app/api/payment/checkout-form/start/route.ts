/** Hosted CheckoutForm start. No card data is accepted. */
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import {
  checkRateLimit,
  checkUserRateLimit,
  SENSITIVE_RATE_LIMIT,
} from '@hanuja/api/lib/rate-limit'
import { extractTrustedClientIp } from '@hanuja/api/lib/legal-acceptance'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'
import { getTurnstileFailureContract, verifyTurnstileToken } from '@hanuja/api/lib/turnstile'
import {
  handleCardPaymentError,
  startCheckoutForm,
  startCheckoutFormSchema,
  reuseCheckoutForm,
} from '@hanuja/api/routes/card-payments'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('NEXT_PUBLIC_APP_URL is required in production')
      })()
    : 'http://localhost:3000')

// Kart deneme (card testing) saldırılarına karşı kullanıcı başına ayrı sınır.
const START_USER_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 }

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Bayrak kapalıyken gövde okunmadan, oturuma ve sağlayıcıya dokunmadan reddedilir.
  if (!isCardPaymentsEnabled()) {
    return NextResponse.json(
      {
        success: false,
        code: 'CARD_PAYMENTS_DISABLED',
        message: 'Kartla ödeme şu anda kullanılamıyor. Lütfen Havale / EFT seçeneğini kullanın.',
      },
      { status: 503 },
    )
  }
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError as NextResponse

  const rl = await checkRateLimit(req, 'payment:start', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response! as NextResponse

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Oturumunuz sona erdi. Lütfen giriş yapın.',
        },
        { status: 401 },
      )
    }
    if (!session.user.emailVerified) {
      return NextResponse.json(
        {
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Sipariş oluşturmadan önce e-posta adresinizi doğrulamanız gerekir.',
        },
        { status: 403 },
      )
    }
    const userRl = await checkUserRateLimit(session.user.id, 'payment:start', START_USER_RATE_LIMIT)
    if (!userRl.allowed) return userRl.response! as NextResponse

    const body = startCheckoutFormSchema.parse(await req.json())
    // A previously verified intent does not consume the same single-use Turnstile token again.
    const existing = await reuseCheckoutForm(session.user.id, body.previewId, body.startKey)
    if (existing)
      return NextResponse.json(
        { success: true, data: existing },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    const turnstileResult = await verifyTurnstileToken({
      token: body.turnstileToken,
      ip: extractTrustedClientIp(req),
      action: 'checkout-submit',
      surface: 'checkout-payment',
    })
    if (!turnstileResult.success) {
      const contract = getTurnstileFailureContract(turnstileResult)
      return NextResponse.json(contract.body, { status: contract.status })
    }

    const callbackBase =
      (process.env.NODE_ENV !== 'production' ? process.env.IYZICO_CALLBACK_BASE_URL : undefined) ??
      APP_URL
    return startCheckoutForm(
      req,
      session.user.id,
      body,
      `${callbackBase}/api/payment/checkout-form/callback`,
    )
  } catch (error) {
    return handleCardPaymentError(error)
  }
}
