import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createHomeCmsService } from '@hanuja/api/services/home-cms.service'

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    const [slides, promos] = await Promise.all([
      service.listAllSlides(),
      service.listAllPromos(),
    ])

    return ok({ slides, promos })
  } catch (error) {
    return handleError(error)
  }
}
