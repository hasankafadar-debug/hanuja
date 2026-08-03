import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { moderateReview } from '@hanuja/api/routes/product-reviews'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// POST /api/admin/reviews/:id/moderate { decision: 'approved' | 'rejected', moderationNote? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    return moderateReview(req, id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
