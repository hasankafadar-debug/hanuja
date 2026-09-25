import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'

export type MarketingChannel = 'email' | 'sms'
export type MarketingRevocationSource = 'account_settings' | 'unsubscribe_link' | 'unsubscribe_post' | 'reply_email'

const BRAND = 'hanuja'

/**
 * IYS capture is deliberately unavailable in this release. A local checkbox
 * must never turn an unregistered address into a sendable marketing recipient.
 */
export const MARKETING_CONSENT_CAPTURE_READY = false

async function revokeChannelInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  channel: MarketingChannel,
  source: MarketingRevocationSource,
) {
  const now = new Date()
  const legacy = await tx.marketingConsent.updateMany({
    where: {
      userId,
      ...(channel === 'email'
        ? { emailConsentAt: { not: null }, emailRevokedAt: null }
        : { smsConsentAt: { not: null }, smsRevokedAt: null }),
    },
    data: channel === 'email' ? { emailRevokedAt: now } : { smsRevokedAt: now },
  })

  const addresses = await tx.marketingConsentAddress.findMany({
    where: { userId, brand: BRAND, channel, status: { not: 'revoked' } },
    select: { id: true, address: true, textVersion: true },
  })
  let changed = legacy.count > 0
  for (const address of addresses) {
    const updated = await tx.marketingConsentAddress.updateMany({
      where: { id: address.id, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: now },
    })
    if (updated.count === 0) continue
    changed = true
    await tx.marketingConsentEvent.create({
      data: {
        userId,
        brand: BRAND,
        channel,
        address: address.address,
        action: 'revoke',
        source,
        textVersion: address.textVersion,
        operationId: randomUUID(),
      },
    })
  }

  // A legacy SMS consent may have no verified phone address. Preserve its
  // withdrawal as an event without fabricating an address from order data.
  if (legacy.count > 0 && addresses.length === 0) {
    await tx.marketingConsentEvent.create({
      data: {
        userId,
        brand: BRAND,
        channel,
        address: null,
        action: 'revoke',
        source,
        textVersion: null,
        operationId: randomUUID(),
      },
    })
  }
  return changed
}

export function createMarketingConsentService(prisma: PrismaClient) {
  return {
    async getStatus(userId: string) {
      const [legacy, addresses] = await Promise.all([
        prisma.marketingConsent.findUnique({
          where: { userId },
          select: {
            emailConsentAt: true,
            emailRevokedAt: true,
            smsConsentAt: true,
            smsRevokedAt: true,
          },
        }),
        prisma.marketingConsentAddress.findMany({
          where: { userId, brand: BRAND },
          select: { channel: true, status: true, address: true, revokedAt: true, verifiedIysAt: true },
        }),
      ])
      const emailLegacyUnverified = Boolean(
        legacy?.emailConsentAt && !legacy.emailRevokedAt &&
        !addresses.some((entry) => entry.channel === 'email' && entry.status === 'revoked'),
      )
      const smsLegacyUnverified = Boolean(legacy?.smsConsentAt && !legacy.smsRevokedAt)
      return {
        emailConsented: false,
        smsConsented: false,
        emailLegacyUnverified,
        smsLegacyUnverified,
        captureReady: MARKETING_CONSENT_CAPTURE_READY,
        iysStatus: 'unconfigured' as const,
      }
    },

    async revokeByUser(userId: string, channel: MarketingChannel, source: MarketingRevocationSource) {
      return prisma.$transaction((tx) => revokeChannelInTransaction(tx, userId, channel, source))
    },

    async revokeByToken(token: string, source: MarketingRevocationSource) {
      const normalized = token.trim()
      if (!normalized) return null
      const address = await prisma.marketingConsentAddress.findUnique({
        where: { optOutToken: normalized },
        select: { userId: true, channel: true },
      })
      if (address?.channel === 'email') {
        await this.revokeByUser(address.userId, 'email', source)
        return { revoked: true as const }
      }
      const legacy = await prisma.marketingConsent.findUnique({
        where: { optOutToken: normalized },
        select: { userId: true },
      })
      if (!legacy) return null
      await this.revokeByUser(legacy.userId, 'email', source)
      return { revoked: true as const }
    },

    async revokeByEmail(email: string) {
      const normalized = email.trim().toLowerCase()
      if (!normalized) return 0
      const [users, addresses] = await Promise.all([
        prisma.user.findMany({
          where: { email: { equals: normalized, mode: 'insensitive' } },
          select: { id: true },
        }),
        prisma.marketingConsentAddress.findMany({
          where: { brand: BRAND, channel: 'email', address: normalized },
          select: { userId: true },
        }),
      ])
      let changed = 0
      for (const userId of new Set([...users.map((user) => user.id), ...addresses.map((address) => address.userId)])) {
        if (await this.revokeByUser(userId, 'email', 'reply_email')) changed += 1
      }
      return changed
    },
  }
}
