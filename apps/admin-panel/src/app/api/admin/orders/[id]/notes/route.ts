import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { created, handleError } from '@hanuja/api/lib/response'
import {
  adminOrderNoteSchema,
  createAdminOrderNoteService,
} from '@hanuja/api/services/admin-order-note.service'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params
    const { body } = adminOrderNoteSchema.parse(await req.json().catch(() => null))
    return created(
      await createAdminOrderNoteService({ prisma: createPrismaForRoute() }).add({
        orderId: id,
        authorId: session.user.id,
        body,
      }),
    )
  } catch (error) {
    return handleError(error)
  }
}
