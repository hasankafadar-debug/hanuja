import { describe, expect, it, vi } from 'vitest'
import { getMarketingChannelStatus, updateMarketingChannel, releaseBlockedMarketingReservation } from '../../../api/services/marketing-channel.service'

function client(settings: unknown = { emailEnabled: false, smsEnabled: false, version: 1 }) {
  const db: any = {
    marketingChannelSettings: { findUnique: vi.fn().mockResolvedValue(settings), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    adminAuditLog: { create: vi.fn() }, campaignEmailDispatch: { updateMany: vi.fn() },
    notificationOutbox: { updateMany: vi.fn() },
  }
  db.$transaction = (fn: (tx: unknown) => unknown) => fn(db)
  return db
}

describe('central marketing channel control', () => {
  it('fails closed for missing and unreadable settings', async () => {
    const db = client(null)
    expect(await getMarketingChannelStatus(db, 'email')).toMatchObject({ canSend: false, reason: 'MARKETING_SETTINGS_UNAVAILABLE' })
    db.marketingChannelSettings.findUnique.mockRejectedValue(new Error('database unavailable'))
    expect((await getMarketingChannelStatus(db, 'email')).canSend).toBe(false)
  })
  it('does not allow raw enabled flags to bypass IYS or missing SMS provider', async () => {
    const db = client({ emailEnabled: true, smsEnabled: true, version: 1 })
    expect(await getMarketingChannelStatus(db, 'email')).toMatchObject({ canSend: false, reason: 'IYS_NOT_CONFIGURED' })
    expect(await getMarketingChannelStatus(db, 'sms')).toMatchObject({ canSend: false, reason: 'SMS_PROVIDER_NOT_CONFIGURED' })
    await expect(updateMarketingChannel(db, { channel: 'email', enabled: true, actorId: 'admin', version: 1 })).rejects.toThrow()
    expect(db.marketingChannelSettings.updateMany).not.toHaveBeenCalled()
  })
  it('audits switch-off and rejects stale writes', async () => {
    const db = client({ emailEnabled: true, smsEnabled: false, version: 1 })
    await updateMarketingChannel(db, { channel: 'email', enabled: false, actorId: 'admin', version: 1 })
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'admin', previousData: { enabled: true }, newData: { enabled: false } }) })
    await expect(updateMarketingChannel(db, { channel: 'email', enabled: false, actorId: 'admin', version: 0 })).rejects.toThrow()
  })
  it('releases only unattempted reservations so uncertain delivery remains counted', async () => {
    const db = client()
    await releaseBlockedMarketingReservation(db, 'event', 'MARKETING_CHANNEL_DISABLED')
    expect(db.campaignEmailDispatch.updateMany).toHaveBeenCalledWith({ where: { eventKey: 'event', status: 'reserved' }, data: { status: 'released', releaseReason: 'MARKETING_CHANNEL_DISABLED' } })
  })
})
