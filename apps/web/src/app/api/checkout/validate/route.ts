import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { validateCart } from '@hanuja/api/routes/checkout'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/checkout/validate
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return validateCart(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
