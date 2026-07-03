import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { getSanitizedR2DebugContext } from '@hanuja/api/lib/r2'
import { confirmUpload } from '@hanuja/api/routes/media'

// POST /api/media/:id/confirm
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let assetId: string | undefined
  let userId: string | undefined

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    userId = session.user.id
    const { id } = await params
    assetId = id
    return confirmUpload(id, session.user.id)
  } catch (err) {
    console.error('[seller-panel][media][confirm-upload]', {
      userId,
      assetId,
      ...(() => {
        try {
          return getSanitizedR2DebugContext()
        } catch {
          return {}
        }
      })(),
      statusCode:
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode?: number }).statusCode
          : undefined,
      error: err instanceof Error ? err.message : err,
    })
    return handleError(err)
  }
}
