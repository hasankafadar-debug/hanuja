import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { createMediaService } from '@hanuja/api/services/media.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  originalName: z.string().max(255).optional(),
})

// POST /api/support-tickets/upload-url — presigned R2 URL for customer support attachments
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const body = await req.json()
    const { mimeType, originalName } = schema.parse(body)

    const svc = createMediaService({ prisma: createPrismaForRoute() })
    const result = await svc.requestUploadUrl({
      ownerId: session.user.id,
      folder: 'customer-support',
      mimeType,
      ...(originalName ? { originalName } : {}),
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return handleError(err)
  }
}
