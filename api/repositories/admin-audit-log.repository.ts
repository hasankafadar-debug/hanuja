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
    listRecent(params?: { skip?: number; take?: number }) {
      return prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        ...(params?.skip !== undefined ? { skip: params.skip } : {}),
        take: params?.take ?? 50,
      })
    },
  }
}

export type AdminAuditLogRepository = ReturnType<typeof createAdminAuditLogRepository>
