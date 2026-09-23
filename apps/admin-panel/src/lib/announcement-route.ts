import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'

/** Admin-only guard for the announcement routes; CSRF is checked by each mutating route first. */
export async function requireAnnouncementAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
  return {
    userId: session.user.id,
    service: createAnnouncementService({ prisma: createPrismaForRoute() }),
  }
}
