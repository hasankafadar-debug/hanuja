import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { fetchPrivateMedia, type PrivateMediaViewer } from '@hanuja/api/routes/media'
import { handleError } from '@hanuja/api/lib/response'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    const { id } = await params

    return fetchPrivateMedia(
      id,
      session?.user
        ? {
            viewerId: session.user.id,
            viewerRole: session.user.role as PrivateMediaViewer['viewerRole'],
          }
        : null,
    )
  } catch (err) {
    const response = handleError(err)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
