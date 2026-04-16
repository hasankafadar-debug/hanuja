import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getCart, addCartItem, clearCart } from '@hanuja/api/routes/cart'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/cart
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return getCart(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/cart — sepete ürün ekle (items endpoint'in kısayolu)
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return addCartItem(req, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart — sepeti tamamen temizle
export async function DELETE() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    return clearCart(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
