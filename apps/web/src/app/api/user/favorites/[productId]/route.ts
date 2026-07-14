import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getFavoriteStatus, removeFavorite } from '@hanuja/api/routes/favorites'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { NextResponse } from 'next/server'

interface RouteContext {
  params: Promise<{ productId: string }>
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ data: { isFavorite: false } })
    const { productId } = await params
    return getFavoriteStatus(session.user.id, productId)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { productId } = await params
    return removeFavorite(session.user.id, productId)
  } catch (err) {
    return handleError(err)
  }
}
