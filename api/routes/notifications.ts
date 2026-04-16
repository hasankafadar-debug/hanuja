/**
 * Notifications route handlers.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createNotificationService } from '../services/notification.service'
import { createPrismaForRoute } from '../lib/prisma'

function getNotificationService() {
  return createNotificationService({ prisma: createPrismaForRoute() })
}

const listQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

// GET /api/notifications
export async function listNotifications(req: NextRequest, userId: string) {
  try {
    const url = new URL(req.url)
    const opts = listQuerySchema.parse(Object.fromEntries(url.searchParams))
    const svc = getNotificationService()
    const [items, unreadCount] = await Promise.all([
      svc.listForUser(userId, opts),
      svc.countUnread(userId),
    ])
    return ok({ items, unreadCount })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/notifications/:id/read
export async function markNotificationRead(notificationId: string, userId: string) {
  try {
    const svc = getNotificationService()
    const notification = await svc.markRead(notificationId, userId)
    return ok({ notification })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/notifications/read-all
export async function markAllNotificationsRead(userId: string) {
  try {
    const svc = getNotificationService()
    const count = await svc.markAllRead(userId)
    return ok({ markedCount: count })
  } catch (err) {
    return handleError(err)
  }
}
