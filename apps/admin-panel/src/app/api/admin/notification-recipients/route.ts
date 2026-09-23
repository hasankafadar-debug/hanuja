/**
 * Admin notification recipients — the operations mailbox per event.
 *
 * Authorisation is enforced here (admin role + CSRF), the address itself is
 * validated again in the service.
 */
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { handleError } from '@hanuja/api/lib/response'
import {
  ADMIN_NOTIFICATION_EVENTS,
  createAdminNotificationRecipientService,
} from '@hanuja/api/services/admin-notification.service'

const schema = z.object({
  entries: z
    .array(
      z.object({
        event: z.enum(ADMIN_NOTIFICATION_EVENTS),
        email: z.string().trim().email('Geçerli bir e-posta adresi girin.').max(254),
      }),
    )
    .min(1)
    .max(ADMIN_NOTIFICATION_EVENTS.length),
})

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 }) }
  }
  if (session.user.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Bu işlem için admin yetkisi gerekir.' },
        { status: 403 },
      ),
    }
  }
  return { userId: session.user.id }
}

export async function GET() {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const service = createAdminNotificationRecipientService({
    prisma: createPrismaForRoute(),
  })
  return NextResponse.json({ data: await service.list() })
}

export async function PUT(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const guard = await requireAdmin()
  if (guard.error) return guard.error

  try {
    const body = schema.parse(await req.json())
    const service = createAdminNotificationRecipientService({
      prisma: createPrismaForRoute(),
    })
    await service.update({ actorId: guard.userId!, entries: body.entries })
    return NextResponse.json({ success: true, data: await service.list() })
  } catch (error) {
    return handleError(error)
  }
}
