import { describe, expect, it, vi } from 'vitest'
import { createMarketingConsentService } from '../../../api/services/marketing-consent.service'

function createDb() {
  const legacy = {
    userId: 'customer-1',
    emailConsentAt: new Date('2026-07-01T00:00:00Z'),
    emailRevokedAt: null as Date | null,
    smsConsentAt: new Date('2026-07-01T00:00:00Z'),
    smsRevokedAt: null as Date | null,
    optOutToken: 'legacy-token',
  }
  const address = {
    id: 'address-1',
    userId: 'customer-1',
    brand: 'hanuja',
    channel: 'email',
    address: 'customer@example.com',
    status: 'legacy_unverified',
    revokedAt: null as Date | null,
    textVersion: null,
    verifiedIysAt: null,
    optOutToken: 'new-token',
  }
  const events: Array<Record<string, unknown>> = []
  const db = {
    marketingConsent: {
      findUnique: vi.fn(async ({ where }: { where: { userId?: string; optOutToken?: string } }) =>
        where.userId === legacy.userId || where.optOutToken === legacy.optOutToken ? legacy : null),
      updateMany: vi.fn(async ({ where, data }: { where: { userId: string; emailRevokedAt?: null; smsRevokedAt?: null }; data: { emailRevokedAt?: Date; smsRevokedAt?: Date } }) => {
        if (where.userId !== legacy.userId) return { count: 0 }
        if ('emailRevokedAt' in where && legacy.emailRevokedAt) return { count: 0 }
        if ('smsRevokedAt' in where && legacy.smsRevokedAt) return { count: 0 }
        if (data.emailRevokedAt) legacy.emailRevokedAt = data.emailRevokedAt
        if (data.smsRevokedAt) legacy.smsRevokedAt = data.smsRevokedAt
        return { count: 1 }
      }),
    },
    marketingConsentAddress: {
      findUnique: vi.fn(async ({ where }: { where: { optOutToken: string } }) =>
        where.optOutToken === address.optOutToken ? address : null),
      findMany: vi.fn(async ({ where }: { where: { userId?: string; channel?: string; address?: string; status?: unknown } }) =>
        (where.userId && where.userId !== address.userId) ||
        (where.channel && where.channel !== address.channel) ||
        (where.address && where.address !== address.address) ||
        (where.status && address.status === 'revoked') ? [] : [address]),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; revokedAt: Date } }) => {
        if (where.id !== address.id || address.status === 'revoked') return { count: 0 }
        address.status = data.status
        address.revokedAt = data.revokedAt
        return { count: 1 }
      }),
    },
    marketingConsentEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data }) },
    user: { findMany: vi.fn(async () => [{ id: legacy.userId }]) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  }
  return { db, legacy, address, events }
}

describe('marketing consent revocation', () => {
  it('records an email withdrawal once and leaves SMS unchanged', async () => {
    const { db, legacy, address, events } = createDb()
    const service = createMarketingConsentService(db as never)

    expect(await service.revokeByToken('legacy-token', 'unsubscribe_post')).toEqual({ revoked: true })
    expect(await service.revokeByToken('legacy-token', 'unsubscribe_post')).toEqual({ revoked: true })
    expect(legacy.emailRevokedAt).toBeInstanceOf(Date)
    expect(legacy.smsRevokedAt).toBeNull()
    expect(address.status).toBe('revoked')
    expect(events).toMatchObject([{
      userId: 'customer-1', channel: 'email', address: 'customer@example.com',
      action: 'revoke', source: 'unsubscribe_post',
    }])
  })

  it('keeps old consents unverified and records an SMS withdrawal without inventing a phone', async () => {
    const { db, events } = createDb()
    const service = createMarketingConsentService(db as never)
    expect(await service.getStatus('customer-1')).toMatchObject({
      emailConsented: false, smsConsented: false, captureReady: false,
      emailLegacyUnverified: true, smsLegacyUnverified: true,
    })
    await service.revokeByUser('customer-1', 'sms', 'account_settings')
    expect(events).toMatchObject([{
      channel: 'sms', address: null, action: 'revoke', source: 'account_settings',
    }])
  })
})
