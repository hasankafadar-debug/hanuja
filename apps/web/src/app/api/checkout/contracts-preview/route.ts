import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getContractsPreview } from '@hanuja/api/routes/checkout'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/checkout/contracts-preview
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return getContractsPreview(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
