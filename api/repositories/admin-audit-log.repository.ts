/**
 * Admin Audit Log Repository — append-only.
 * Never update or delete audit log entries.
 * All high-impact admin actions must call createEntry().
 */
import type { AdminActionType, PrismaClient } from '@prisma/client'

export function createAdminAuditLogRepository(prisma: PrismaClient) {
  return {
    /**
     * Append a new audit entry. Never call update or delete on this table.
     */
    createEntry(data: {
      actorId: string
      actionType: AdminActionType
      targetType: string
      targetId: string
      previousData?: object
      newData?: object
      reason?: string
      note?: string
      ipAddress?: string
    }) {
      return prisma.adminAuditLog.create({
        data: {
          ...data,
          previousData: data.previousData as never,
          newData: data.newData as never,
        },
      })
    },

    listByTarget(targetType: string, targetId: string) {
      return prisma.adminAuditLog.findMany({
        where: { targetType, targetId },
        orderBy: { createdAt: 'asc' },
      })
    },

    listByActor(actorId: string, params?: { skip?: number; take?: number }) {
      return prisma.adminAuditLog.findMany({
        where: { actorId },
        orderBy: { createdAt: 'desc' },
        ...(params?.skip !== undefined ? { skip: params.skip } : {}),
        take: params?.take ?? 30,
      })
    },

    listByAction(actionType: AdminActionType, params?: { skip?: number; take?: number }) {
      return prisma.adminAuditLog.findMany({
        where: { actionType },
        orderBy: { createdAt: 'desc' },
        ...(params?.skip !== undefined ? { skip: params.skip } : {}),
        take: params?.take ?? 30,
      })
    },

    /** List all recent audit log entries across all actors and actions. */
    async listRecent(params?: {
      skip?: number
      take?: number
      from?: Date
      to?: Date
      actionTypes?: AdminActionType[]
      actorEmail?: string
    }) {
      let actorIds: string[] | undefined

      if (params?.actorEmail?.trim()) {
        const actors = await prisma.user.findMany({
          where: {
            email: {
              contains: params.actorEmail.trim(),
              mode: 'insensitive',
            },
          },
          select: {
            id: true,
            email: true,
            name: true,
          },
        })
        actorIds = actors.map((actor) => actor.id)
        if (actorIds.length === 0) return []
      }

      const logs = await prisma.adminAuditLog.findMany({
        where: {
          ...(params?.actionTypes && params.actionTypes.length > 0
            ? { actionType: { in: params.actionTypes } }
            : {}),
          ...(actorIds !== undefined ? { actorId: { in: actorIds } } : {}),
          ...(params?.from !== undefined || params?.to !== undefined
            ? {
                createdAt: {
                  ...(params.from !== undefined ? { gte: params.from } : {}),
                  ...(params.to !== undefined ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        ...(params?.skip !== undefined ? { skip: params.skip } : {}),
        take: params?.take ?? 50,
      })

      const uniqueActorIds = [...new Set(logs.map((log) => log.actorId))]
      const actors = uniqueActorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: uniqueActorIds } },
            select: { id: true, email: true, name: true },
          })
        : []
      const actorMap = new Map(actors.map((actor) => [actor.id, actor]))

      return logs.map((log) => ({
        ...log,
        actor: actorMap.get(log.actorId) ?? null,
      }))
    },
  }
}

export type AdminAuditLogRepository = ReturnType<typeof createAdminAuditLogRepository>
