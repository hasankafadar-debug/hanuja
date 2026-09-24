/**
 * Store follows. Following a store is not a notification reason any more (e-mail plan phase 6,
 * 2026-09-24): the old "indirim başladı" store e-mail is closed. The per-follow opt-out token and
 * the unsubscribe routes stay so links in e-mails sent before the change keep working.
 */
import type { PrismaClient } from '@prisma/client'

interface StoreFollowServiceDeps {
  prisma: PrismaClient
}

export function createStoreFollowService({ prisma }: StoreFollowServiceDeps) {
  return {
    async isFollowingStore(userId: string, sellerId: string) {
      const follow = await prisma.storeFollow.findUnique({
        where: { userId_sellerId: { userId, sellerId } },
        select: { id: true },
      })
      return Boolean(follow)
    },

    async followStore(userId: string, sellerId: string) {
      return prisma.storeFollow.upsert({
        where: { userId_sellerId: { userId, sellerId } },
        create: {
          userId,
          sellerId,
          emailOptOutToken: crypto.randomUUID(),
        },
        update: {
          emailOptOutAt: null,
        },
      })
    },

    async unfollowStore(userId: string, sellerId: string) {
      await prisma.storeFollow.deleteMany({
        where: { userId, sellerId },
      })
      return { ok: true }
    },

    async listFollowedSellerIds(userId: string) {
      const rows = await prisma.storeFollow.findMany({
        where: { userId },
        select: { sellerId: true },
      })
      return rows.map((row) => row.sellerId)
    },

    async unsubscribeByToken(token: string) {
      const follow = await prisma.storeFollow.findUnique({
        where: { emailOptOutToken: token },
      })
      if (!follow) return null

      return prisma.storeFollow.update({
        where: { id: follow.id },
        data: { emailOptOutAt: new Date() },
      })
    },

    async unsubscribeByReplyEmail(fromEmail: string) {
      const normalized = fromEmail.trim().toLowerCase()
      if (!normalized) return 0

      const users = await prisma.user.findMany({
        where: { email: { equals: normalized, mode: 'insensitive' } },
        select: { id: true },
      })
      if (users.length === 0) return 0

      const result = await prisma.storeFollow.updateMany({
        where: {
          userId: { in: users.map((user) => user.id) },
          emailOptOutAt: null,
        },
        data: { emailOptOutAt: new Date() },
      })

      return result.count
    },

    async getFollowerCount(sellerId: string): Promise<number> {
      return prisma.storeFollow.count({ where: { sellerId } })
    },
  }
}

export type StoreFollowService = ReturnType<typeof createStoreFollowService>
