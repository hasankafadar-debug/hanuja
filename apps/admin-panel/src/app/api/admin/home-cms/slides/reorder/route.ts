import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createHomeCmsService } from '@hanuja/api/services/home-cms.service'

const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { ids } = reorderSchema.parse(await req.json())
    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    await service.reorderSlides(ids, session.user.id)

    return ok({ ids })
  } catch (error) {
    return handleError(error)
  }
}
