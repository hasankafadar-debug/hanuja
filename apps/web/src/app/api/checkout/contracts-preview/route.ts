import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getContractsPreview } from '@hanuja/api/routes/checkout'
import { previewCardQuoteContracts, previewCheckoutForm } from '@hanuja/api/routes/card-payments'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkUserRateLimit } from '@hanuja/api/lib/rate-limit'

// GET /api/checkout/contracts-preview
// Kart ödemesinde ?quoteId= ile seçilen taksit ve vade farkını içeren belgeler döner.
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const quoteId = req.nextUrl.searchParams.get('quoteId')
    if (quoteId) return previewCardQuoteContracts(session.user.id, quoteId)
    if (req.nextUrl.searchParams.get('paymentMethod') === 'card') {
      const limit = await checkUserRateLimit(session.user.id, 'payment:cf-preview', {
        limit: 120,
        windowMs: 15 * 60_000,
      })
      if (!limit.allowed) return limit.response!
      return previewCheckoutForm(req, session.user.id)
    }
    return getContractsPreview(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
