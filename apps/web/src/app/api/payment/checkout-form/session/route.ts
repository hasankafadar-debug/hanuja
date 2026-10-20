import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCardPaymentService } from '@hanuja/api/services/card-payment.service'
import { handleCardPaymentError, getCardAttemptState } from '@hanuja/api/routes/card-payments'
import { checkUserRateLimit } from '@hanuja/api/lib/rate-limit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ success: false }, { status: 401 })
    const limit = await checkUserRateLimit(session.user.id, 'payment:cf-recovery', {
      limit: 30,
      windowMs: 60_000,
    })
    if (!limit.allowed) return limit.response!
    const previewId = z.string().min(1).max(100).parse(req.nextUrl.searchParams.get('previewId'))
    const attempt = await createPrismaForRoute().cardPaymentAttempt.findUnique({
      where: { checkoutFormPreviewId: previewId },
      select: { userId: true, startKey: true, flow: true },
    })
    if (!attempt || attempt.userId !== session.user.id || attempt.flow !== 'checkout_form')
      return NextResponse.json(
        { success: false },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      )
    return getCardAttemptState(session.user.id, attempt.startKey)
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function DELETE(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ success: false }, { status: 401 })
    const body = z
      .object({ attemptId: z.string().min(1) })
      .strict()
      .parse(await req.json())
    await createCardPaymentService({ prisma: createPrismaForRoute() }).abandonCheckoutForm(
      session.user.id,
      body.attemptId,
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleCardPaymentError(error)
  }
}
