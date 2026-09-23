import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import type { RateLimitConfig } from '@hanuja/security'
import { auth } from '@/lib/auth'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkRateLimit, checkUserRateLimit } from '@hanuja/api/lib/rate-limit'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'

const ANNOUNCEMENT_READ_IP_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 }
const ANNOUNCEMENT_READ_USER_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 }

// POST /api/seller/announcements/:id/read — duyuru ekranda gösterildi; yalnız ilk görüntüleme yazılır
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const ipLimit = await checkRateLimit(req, 'seller-announcements', ANNOUNCEMENT_READ_IP_RATE_LIMIT)
  if (!ipLimit.allowed && ipLimit.response) return ipLimit.response

  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getOperationalSellerIdOrThrow()

    const userLimit = await checkUserRateLimit(
      session.user.id,
      'announcements:read',
      ANNOUNCEMENT_READ_USER_RATE_LIMIT,
    )
    if (!userLimit.allowed && userLimit.response) return userLimit.response

    const { id } = await params
    const result = await createAnnouncementService({ prisma: createPrismaForRoute() }).markRead(sellerId, id)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
