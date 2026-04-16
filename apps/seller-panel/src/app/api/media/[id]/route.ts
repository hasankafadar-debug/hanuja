import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { deleteAsset } from '@hanuja/api/routes/media'

// DELETE /api/media/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return deleteAsset(id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
