import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createCatalogService } from '@hanuja/api/services/catalog.service'

const updateCategoryTaxGroupSchema = z.object({
  categoryIds: z.array(z.string().cuid()).min(1).max(50),
  taxRate: z.number().min(0).max(1).nullable(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = updateCategoryTaxGroupSchema.parse(await req.json())
    const service = createCatalogService({ prisma: createPrismaForRoute() })
    const categories = await service.updateCategoryTaxGroupForAdmin({
      categoryIds: body.categoryIds,
      taxRate: body.taxRate,
      actorId: session.user.id,
    })

    return ok({ categories })
  } catch (error) {
    return handleError(error)
  }
}
