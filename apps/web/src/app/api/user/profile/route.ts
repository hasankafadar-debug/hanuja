import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getProfile, updateProfile } from '@hanuja/api/routes/user'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/user/profile
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return getProfile(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/user/profile
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return updateProfile(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
