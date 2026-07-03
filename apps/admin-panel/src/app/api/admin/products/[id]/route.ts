import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { deleteAdminProduct, updateAdminProduct } from '@hanuja/api/routes/catalog'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

async function assertAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    return updateAdminProduct(id, body)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertAdmin()
    const { id } = await params
    return deleteAdminProduct(id)
  } catch (err) {
    return handleError(err)
  }
}
