import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getReturnRequest } from '@hanuja/api/routes/returns'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await params
    return getReturnRequest(id)
  } catch (err) {
    return handleError(err)
  }
}
