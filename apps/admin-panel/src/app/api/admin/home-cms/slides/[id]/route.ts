import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, noContent, ok } from '@hanuja/api/lib/response'
import { createHomeCmsService } from '@hanuja/api/services/home-cms.service'

const nullableDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => {
    if (value === undefined) return undefined
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  })

const updateSlideSchema = z.object({
  mediaAssetId: z.string().min(1).optional(),
  posterAssetId: z.string().trim().optional().nullable(),
  eyebrow: z.string().trim().max(60).optional().nullable(),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().max(300).optional().nullable(),
  ctaLabel: z.string().trim().min(1).max(40).optional(),
  ctaHref: z.string().trim().min(1).max(500).optional(),
  startsAt: nullableDate,
  endsAt: nullableDate,
  sellerId: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = updateSlideSchema.parse(await req.json())
    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    const slide = await service.updateSlide(id, {
      ...(body.mediaAssetId !== undefined ? { mediaAssetId: body.mediaAssetId } : {}),
      ...(body.posterAssetId !== undefined ? { posterAssetId: body.posterAssetId || null } : {}),
      ...(body.eyebrow !== undefined ? { eyebrow: body.eyebrow || null } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body || null } : {}),
      ...(body.ctaLabel !== undefined ? { ctaLabel: body.ctaLabel } : {}),
      ...(body.ctaHref !== undefined ? { ctaHref: body.ctaHref } : {}),
      ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
      ...(body.sellerId !== undefined ? { sellerId: body.sellerId || null } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      actorId: session.user.id,
    })

    return ok({ slide })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    await service.deleteSlide(id, session.user.id)

    return noContent()
  } catch (error) {
    return handleError(error)
  }
}
