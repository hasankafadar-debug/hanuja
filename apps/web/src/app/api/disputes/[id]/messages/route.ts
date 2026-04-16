import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { addDisputeMessage } from '@hanuja/api/routes/disputes'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    const role = (session.user.role as 'customer' | 'seller' | 'admin') ?? 'customer'
    return addDisputeMessage(req, id, session.user.id, role)
  } catch (err) {
    return handleError(err)
  }
}
