import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { CookieConsentError, createCookieConsentService } from '@hanuja/api/services/cookie-consent.service'

const schema = z
  .object({
    decision: z.enum(['accept_all', 'reject_all', 'save']),
    consentId: z.string().uuid().nullish(),
    policyVersion: z.string().min(1).max(64),
    functional: z.boolean(),
    analytics: z.boolean(),
    marketing: z.boolean(),
  })
  .strict()

/**
 * Records a cookie consent decision as proof (KVKK: the controller must be able to prove
 * consent). Anonymous visitors are allowed; a logged-in user is linked from the server
 * session, never from the payload. The IP is only used as a transient rate-limit key.
 */
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError

  const limit = await checkRateLimit(request, 'cookie-consent', SENSITIVE_RATE_LIMIT)
  if (!limit.allowed) return limit.response!

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Geçersiz çerez tercihi.' }, { status: 400 })

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null)
  const service = createCookieConsentService(createPrismaForRoute())
  try {
    const result = await service.record({ ...parsed.data, userId: session?.user?.id ?? null })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CookieConsentError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: 409 })
    }
    console.error('[cookie-consent] record failed', error)
    return NextResponse.json({ message: 'Çerez tercihiniz kaydedilemedi. Lütfen tekrar deneyin.' }, { status: 500 })
  }
}
