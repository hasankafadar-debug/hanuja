import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createMediaService } from '@hanuja/api/services/media.service'

const uploadSchema = z.object({
  folder: z.enum(['slider', 'promo', 'blog', 'general']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']),
  originalName: z.string().trim().max(255).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = uploadSchema.parse(await req.json())
    const service = createMediaService({ prisma: createPrismaForRoute() })
    const result = await service.requestUploadUrl({
      ownerId: session.user.id,
      folder: body.folder,
      mimeType: body.mimeType,
      ...(body.originalName ? { originalName: body.originalName } : {}),
    })

    return ok(result)
  } catch (error) {
    return handleError(error)
  }
}
