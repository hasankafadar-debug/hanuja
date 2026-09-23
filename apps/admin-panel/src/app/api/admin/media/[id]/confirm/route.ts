import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createMediaService } from '@hanuja/api/services/media.service'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const service = createMediaService({ prisma: createPrismaForRoute() })
    const asset = await service.confirmUpload(id, session.user.id)

    return ok({ asset })
  } catch (error) {
    return handleError(error)
  }
}
