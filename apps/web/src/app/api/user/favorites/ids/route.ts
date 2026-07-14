import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { listFavoriteIds } from '@hanuja/api/routes/favorites'
import { handleError } from '@hanuja/api/lib/response'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ data: [] })
    return listFavoriteIds(session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
