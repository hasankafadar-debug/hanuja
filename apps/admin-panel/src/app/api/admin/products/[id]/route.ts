import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { deleteAdminProduct, updateAdminProduct } from '@hanuja/api/routes/catalog'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

async function assertAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
  return session.user.id
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const adminActorId = await assertAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    return updateAdminProduct(id, body, adminActorId)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const adminActorId = await assertAdmin()
    const { id } = await params
    return deleteAdminProduct(id, adminActorId)
  } catch (err) {
    return handleError(err)
  }
}
