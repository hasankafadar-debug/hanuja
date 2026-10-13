import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { headers } from 'next/headers'
import type { AdminActionType } from '@prisma/client'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createCatalogService } from '@hanuja/api/services/catalog.service'

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  taxRate: z.number().min(0).max(1).optional().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrf = checkCsrf(req)
    if (csrf) return csrf
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = updateCategorySchema.parse(await req.json())
    const prisma = createPrismaForRoute()
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(82910214)::text`
      const existing = await tx.category.findUnique({
        where: { id },
        select: { taxRate: true, name: true, sortOrder: true, isActive: true },
      })
      const service = createCatalogService({
        prisma: tx as unknown as typeof prisma,
      })
      const category = await service.updateCategoryForAdmin({
        categoryId: id,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl || null } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
      })

      if (body.taxRate !== undefined) {
        await createAdminAuditLogRepository(tx as unknown as typeof prisma).createEntry({
          actorId: session.user.id,
          actionType: 'category_tax_rate_changed' as AdminActionType,
          targetType: 'category',
          targetId: id,
          previousData: {
            taxRate: existing?.taxRate?.toString() ?? null,
            name: existing?.name ?? null,
          },
          newData: {
            taxRate: category.taxRate?.toString() ?? null,
            name: category.name,
          },
        })
      }

      if (body.name !== undefined || body.sortOrder !== undefined || body.isActive !== undefined)
        await createAdminAuditLogRepository(tx as unknown as typeof prisma).createEntry({
          actorId: session.user.id,
          actionType: 'category_updated',
          targetType: 'category',
          targetId: id,
          previousData: existing
            ? {
                name: existing.name,
                sortOrder: existing.sortOrder,
                isActive: existing.isActive,
              }
            : {},
          newData: {
            name: category.name,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
          },
        })
      return ok({ category })
    })
  } catch (error) {
    return handleError(error)
  }
}
