import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { bulkApproveProducts } from '@hanuja/api/routes/catalog'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    return bulkApproveProducts(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
