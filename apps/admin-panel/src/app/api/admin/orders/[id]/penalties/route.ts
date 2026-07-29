import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { assertRoleCan } from '@hanuja/api/lib/authorize'
import { handleError } from '@hanuja/api/lib/response'
import { applyManualPenalty } from '@hanuja/api/routes/penalties'
import { requireAdminStepUp } from '@/lib/step-up'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    assertRoleCan(session.user.role, 'penalty:apply')
    await requireAdminStepUp(req, session, 'penalty:apply')

    const { id } = await params
    return applyManualPenalty(req, id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
