import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { requestUploadUrl } from '@hanuja/api/routes/media'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

// POST /api/media — customer requests a presigned upload URL (e.g. avatar, dispute evidence)
export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req); if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return requestUploadUrl(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
