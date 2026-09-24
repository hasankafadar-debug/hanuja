import type { Prisma, PrismaClient } from '@prisma/client'
import { ConflictError, ValidationError } from '../lib/errors'

type Db = PrismaClient | Prisma.TransactionClient
export type MarketingChannel = 'email' | 'sms'
export type MarketingChannelReason = 'MARKETING_CHANNEL_DISABLED' | 'MARKETING_SETTINGS_UNAVAILABLE' | 'IYS_NOT_CONFIGURED' | 'SMS_PROVIDER_NOT_CONFIGURED'

/** No writable readiness flag: an audited IYS integration is required before enabling grants/sends. */
export async function getMarketingChannelStatus(db: Db, channel: MarketingChannel) {
  let enabled = false
  let version = 0
  let unavailable = false
  try {
    const settings = await db.marketingChannelSettings.findUnique({ where: { id: 'marketing' } })
    unavailable = !settings
    enabled = settings ? (channel === 'email' ? settings.emailEnabled : settings.smsEnabled) : false
    version = settings?.version ?? 0
  } catch {
    unavailable = true
  }
  const reason: MarketingChannelReason = unavailable ? 'MARKETING_SETTINGS_UNAVAILABLE'
    : !enabled ? 'MARKETING_CHANNEL_DISABLED'
    : channel === 'sms' ? 'SMS_PROVIDER_NOT_CONFIGURED' : 'IYS_NOT_CONFIGURED'
  return {
    channel, enabled, version, ready: false, captureReady: false, canSend: false,
    iysStatus: 'unconfigured' as const,
    providerStatus: channel === 'email' ? 'configured' as const : 'unconfigured' as const,
    reason,
  }
}

export async function assertMarketingChannelOpen(db: Db, channel: MarketingChannel) {
  const status = await getMarketingChannelStatus(db, channel)
  if (!status.canSend) throw new ValidationError(channel === 'sms'
    ? 'SMS sağlayıcısı ve İYS bağlantısı henüz yapılandırılmadı. Gönderim kapalı.'
    : 'İYS izin yönetimi henüz yapılandırılmadı. E-posta reklam gönderimi kapalı.')
}

export async function updateMarketingChannel(
  db: PrismaClient,
  input: { channel: MarketingChannel; enabled: boolean; actorId: string; version: number },
) {
  if (input.enabled) await assertMarketingChannelOpen(db, input.channel)
  return db.$transaction(async (tx) => {
    const before = await tx.marketingChannelSettings.findUnique({ where: { id: 'marketing' } })
    if (!before || before.version !== input.version) throw new ConflictError('Ayar değişti. Sayfayı yenileyin.')
    const changed = await tx.marketingChannelSettings.updateMany({
      where: { id: 'marketing', version: input.version },
      data: { [input.channel === 'email' ? 'emailEnabled' : 'smsEnabled']: false,
        version: { increment: 1 }, updatedBy: input.actorId },
    })
    if (!changed.count) throw new ConflictError('Ayar değişti. Sayfayı yenileyin.')
    await tx.adminAuditLog.create({ data: {
      actorId: input.actorId, actionType: 'marketing_channel_updated', targetType: 'marketing_channel', targetId: input.channel,
      previousData: { enabled: input.channel === 'email' ? before.emailEnabled : before.smsEnabled },
      newData: { enabled: false },
    } })
    return getMarketingChannelStatus(tx, input.channel)
  })
}

/** Only unattempted reservations are released. SMTP uncertainty must stay counted. */
export async function releaseBlockedMarketingReservation(db: Db, eventKey: string, reason: string) {
  await db.campaignEmailDispatch.updateMany({
    where: { eventKey, status: 'reserved' },
    data: { status: 'released', releaseReason: reason },
  })
}
