import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { addSellerReturnMessage } from '@hanuja/api/routes/returns'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getActiveSellerIdOrThrow()
    const { id } = await params
    return addSellerReturnMessage(req, id, sellerId, session.user.id)
  } catch (error) {
    return handleError(error)
  }
}
