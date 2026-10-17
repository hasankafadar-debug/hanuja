import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { assertRoleCan } from '@hanuja/api/lib/authorize'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'
import { reconcileCardRefundByAdmin } from '@hanuja/api/routes/card-payment-admin'

// POST /api/admin/refunds/:id/reconcile — belirsiz kart iadesini iyzico raporuyla sonuçlandırır
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(request)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    assertRoleCan(session.user.role, 'finance:adjust_manual')
    const limit = await checkUserRateLimit(
      session.user.id,
      'admin:card-reconcile',
      HIGH_RISK_RATE_LIMIT,
    )
    if (!limit.allowed) return limit.response!
    const { id } = await params
    const response = await reconcileCardRefundByAdmin(request, id, session.user.id)
    if (response.ok) {
      const { data } = await response.clone().json()
      revalidatePath(`/siparisler/${data.orderId}`)
      revalidatePath('/iadeler')
    }
    return response
  } catch (error) {
    return handleError(error)
  }
}
