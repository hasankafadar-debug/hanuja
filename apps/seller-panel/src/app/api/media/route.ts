import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError } from '@hanuja/api/lib/response'
import { getSanitizedR2DebugContext } from '@hanuja/api/lib/r2'
import { requestUploadUrl, listAssets } from '@hanuja/api/routes/media'

// POST /api/media - request presigned upload URL
export async function POST(req: NextRequest) {
  let requestBody: { folder?: string; mimeType?: string } | null = null
  let userId: string | undefined

  try {
    requestBody = await req.clone().json().catch(() => null)
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    userId = session.user.id

    const rl = await checkUserRateLimit(session.user.id, 'media:upload-url', SENSITIVE_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    return requestUploadUrl(req, session.user.id)
  } catch (err) {
    console.error('[seller-panel][media][request-upload-url]', {
      userId,
      folder: requestBody?.folder,
      mimeType: requestBody?.mimeType,
      ...(requestBody?.folder
        ? (() => {
            try {
              return getSanitizedR2DebugContext()
            } catch {
              return {}
            }
          })()
        : {}),
      statusCode:
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode?: number }).statusCode
          : undefined,
      error: err instanceof Error ? err.message : err,
    })
    return handleError(err)
  }
}

// GET /api/media?folder=products - list seller's assets
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listAssets(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
