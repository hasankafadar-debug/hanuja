import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { requestUploadUrl, listAssets } from '@hanuja/api/routes/media'

// POST /api/media — request presigned upload URL
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return requestUploadUrl(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/media?folder=products — list seller's assets
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listAssets(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
