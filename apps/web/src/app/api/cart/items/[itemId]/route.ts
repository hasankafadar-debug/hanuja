import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { updateCartItem, removeCartItem } from '@hanuja/api/routes/cart'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

interface Params {
  params: Promise<{ itemId: string }>
}

// PATCH /api/cart/items/:itemId
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { itemId } = await params
    return updateCartItem(req, session.user.id, itemId)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart/items/:itemId
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { itemId } = await params
    return removeCartItem(session.user.id, itemId)
  } catch (err) {
    return handleError(err)
  }
}
