import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { created, handleError } from '@hanuja/api/lib/response'
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

const createSlideSchema = z.object({
  mediaAssetId: z.string().min(1),
  posterAssetId: z.string().trim().optional().nullable(),
  eyebrow: z.string().trim().max(60).optional().nullable(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(300).optional().nullable(),
  ctaLabel: z.string().trim().min(1).max(40),
  ctaHref: z.string().trim().min(1).max(500),
  startsAt: nullableDate,
  endsAt: nullableDate,
  sellerId: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = createSlideSchema.parse(await req.json())
    const service = createHomeCmsService({ prisma: createPrismaForRoute() })
    const slide = await service.createSlide({
      mediaAssetId: body.mediaAssetId,
      posterAssetId: body.posterAssetId || null,
      eyebrow: body.eyebrow || null,
      title: body.title,
      body: body.body || null,
      ctaLabel: body.ctaLabel,
      ctaHref: body.ctaHref,
      ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
      sellerId: body.sellerId || null,
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      actorId: session.user.id,
    })

    return created({ slide })
  } catch (error) {
    return handleError(error)
  }
}
