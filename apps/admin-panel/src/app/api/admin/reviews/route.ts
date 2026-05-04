import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { listReviewsForAdmin } from '@hanuja/api/routes/product-reviews'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/admin/reviews?status=pending_moderation
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    return listReviewsForAdmin(req)
  } catch (err) {
    return handleError(err)
  }
}
