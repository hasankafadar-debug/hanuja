import type { Prisma, PrismaClient } from '@prisma/client'
import { isValidMarketingUnsubscribeUrl } from '../lib/email-templates/marketing-footer'

/** Re-read the actual address immediately before sending; user-level historical grants are insufficient. */
export async function checkMarketingEmailRecipient(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  emailTo: string,
  unsubscribeUrl?: string,
): Promise<string | null> {
  const address = emailTo.trim().toLowerCase()
  if (!address) return 'MARKETING_ADDRESS_MISSING'
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true, banned: true } })
  if (!user || user.role !== 'customer' || user.banned || user.email.trim().toLowerCase() !== address)
    return 'MARKETING_ADDRESS_CHANGED'
  const consent = await db.marketingConsentAddress.findFirst({
    where: { userId, brand: 'hanuja', channel: 'email', address, status: 'granted', revokedAt: null, verifiedIysAt: { not: null } },
    select: { optOutToken: true },
  })
  if (!consent) return 'MARKETING_ADDRESS_CONSENT_MISSING'
  if (unsubscribeUrl !== undefined) {
    if (!isValidMarketingUnsubscribeUrl(unsubscribeUrl)) return 'MARKETING_UNSUBSCRIBE_INVALID'
    const token = new URL(unsubscribeUrl).searchParams.get('token')
    if (token !== consent.optOutToken) {
      const legacy = await db.marketingConsent.findUnique({ where: { userId }, select: { optOutToken: true } })
      if (!legacy || token !== legacy.optOutToken) return 'MARKETING_UNSUBSCRIBE_INVALID'
    }
  }
  return null
}
