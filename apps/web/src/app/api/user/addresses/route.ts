import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { listAddresses, addAddress } from '@hanuja/api/routes/user'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/user/addresses
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listAddresses(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/user/addresses
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return addAddress(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
