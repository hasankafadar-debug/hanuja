import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { openDispute } from '@hanuja/api/routes/disputes'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const rl = await checkUserRateLimit(session.user.id, 'disputes:open', API_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    return openDispute(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
