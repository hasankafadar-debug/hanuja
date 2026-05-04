import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { listFavoriteIds } from '@hanuja/api/routes/favorites'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return listFavoriteIds(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
