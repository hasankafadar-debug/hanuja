import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { HomePromoSlot } from '@prisma/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
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

const upsertPromoSchema = z.object({
  mediaAssetId: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(160).optional().nullable(),
  ctaHref: z.string().trim().min(1).max(500),
  startsAt: nullableDate,
  endsAt: nullableDate,
  isActive: z.boolean().optional(),
})

function parseSlot(slot: string): HomePromoSlot {
  if (slot === HomePromoSlot.TOP_RIGHT || slot === HomePromoSlot.BOTTOM_RIGHT) return slot
  throw new ValidationError('Geçersiz promo slotu.')
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { slot } = await params
    const body = upsertPromoSchema.parse(await req.json())
    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    const promo = await service.upsertPromo(parseSlot(slot), {
      mediaAssetId: body.mediaAssetId,
      title: body.title,
      subtitle: body.subtitle || null,
      ctaHref: body.ctaHref,
      ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      actorId: session.user.id,
    })

    return ok({ promo })
  } catch (error) {
    return handleError(error)
  }
}
