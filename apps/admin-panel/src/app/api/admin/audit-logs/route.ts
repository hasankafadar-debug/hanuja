import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import type { AdminActionType } from '@prisma/client'

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const url = new URL(req.url)
    const actionType = url.searchParams.get('actionType')
    const actionTypes = actionType
      ? actionType.split(',').map((value) => value.trim()).filter(Boolean) as AdminActionType[]
      : []
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const actorEmail = url.searchParams.get('actorEmail') ?? undefined
    const take = Number(url.searchParams.get('take') ?? '50')
    const skip = Number(url.searchParams.get('skip') ?? '0')

    const prisma = createPrismaForRoute()
    const repo = createAdminAuditLogRepository(prisma)

    const logs = await repo.listRecent({
      skip,
      take,
      ...(actionTypes.length > 0 ? { actionTypes } : {}),
      ...(from ? { from: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
      ...(actorEmail ? { actorEmail } : {}),
    })

    return ok(logs)
  } catch (err) {
    return handleError(err)
  }
}
