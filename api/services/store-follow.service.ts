import type { PrismaClient } from '@prisma/client'
import { createNotificationService } from './notification.service'

interface StoreFollowServiceDeps {
  prisma: PrismaClient
}

function buildStoreUrl(storeSlug: string) {
  const baseUrl = process.env['APP_BASE_URL']?.replace(/\/$/, '') ?? 'http://localhost:3000'
  return `${baseUrl}/magaza/${storeSlug}`
}

function buildUnsubscribeUrl(token: string) {
  const baseUrl = process.env['APP_BASE_URL']?.replace(/\/$/, '') ?? 'http://localhost:3000'
  return `${baseUrl}/api/store-follows/unsubscribe?token=${encodeURIComponent(token)}`
}

function buildReplyToAddress() {
  return process.env['STORE_DISCOUNT_INBOUND_EMAIL']?.trim() || undefined
}

export function createStoreFollowService({ prisma }: StoreFollowServiceDeps) {
  const notifications = createNotificationService({ prisma })

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

    async notifyFollowersAboutDiscount(params: {
      sellerId: string
      sellerName: string
      sellerSlug: string
      discountRuleId?: string | null
      discountFingerprint: string
    }) {
      const follows = await prisma.storeFollow.findMany({
        where: { sellerId: params.sellerId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      })

      const replyTo = buildReplyToAddress()
      const storeUrl = buildStoreUrl(params.sellerSlug)

      for (const follow of follows) {
        try {
          await prisma.storeDiscountDispatch.create({
            data: {
              userId: follow.userId,
              sellerId: params.sellerId,
              discountRuleId: params.discountRuleId ?? null,
              discountFingerprint: params.discountFingerprint,
              ...(follow.emailOptOutAt === null && follow.user.email
                ? { emailSentAt: new Date() }
                : {}),
            },
          })
        } catch {
          continue
        }

        await notifications.send({
          userId: follow.userId,
          type: 'store_discount_followed_seller',
          title: `${params.sellerName} mağazasında indirim başladı`,
          body: 'Takip ettiğiniz mağazanın indirimli ürünlerini keşfedin.',
          data: {
            sellerId: params.sellerId,
            sellerSlug: params.sellerSlug,
            sellerName: params.sellerName,
            discountRuleId: params.discountRuleId ?? null,
            storeUrl,
            unsubscribeUrl: buildUnsubscribeUrl(follow.emailOptOutToken),
            customerName: follow.user.name ?? 'Değerli Müşterimiz',
          },
          ...(follow.emailOptOutAt === null && follow.user.email
            ? { emailTo: follow.user.email, ...(replyTo ? { replyTo } : {}) }
            : {}),
        })
      }
    },
  }
}

export type StoreFollowService = ReturnType<typeof createStoreFollowService>
