import { describe, expect, it, vi } from 'vitest'
import { checkMarketingEmailRecipient } from '../../../api/services/marketing-recipient-policy'
import { getWebBaseUrl } from '../../../api/lib/platform-info'

function setup() {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'customer@example.com', role: 'customer', banned: false }) },
    marketingConsentAddress: { findFirst: vi.fn().mockResolvedValue({ optOutToken: 'address-token' }) },
    marketingConsent: { findUnique: vi.fn().mockResolvedValue({ optOutToken: 'legacy-token' }) },
  }
}
const link = (token: string) => `${getWebBaseUrl()}/api/marketing/unsubscribe?token=${token}`
describe('marketing recipient address and withdrawal binding', () => {
  it('requires a grant for the exact current address and verified IYS state', async () => {
    const db = setup()
    expect(await checkMarketingEmailRecipient(db as never, 'u', 'customer@example.com', link('address-token'))).toBeNull()
    expect(db.marketingConsentAddress.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ address: 'customer@example.com', channel: 'email', status: 'granted', revokedAt: null, verifiedIysAt: { not: null } }) }))
    db.marketingConsentAddress.findFirst.mockResolvedValue(null as never)
    expect(await checkMarketingEmailRecipient(db as never, 'u', 'customer@example.com', link('address-token'))).toBe('MARKETING_ADDRESS_CONSENT_MISSING')
  })
  it('blocks queued old addresses after an account address change', async () => {
    expect(await checkMarketingEmailRecipient(setup() as never, 'u', 'old@example.com')).toBe('MARKETING_ADDRESS_CHANGED')
  })
  it('accepts an old token owned by the same user but rejects another token or origin', async () => {
    const db = setup()
    expect(await checkMarketingEmailRecipient(db as never, 'u', 'customer@example.com', link('legacy-token'))).toBeNull()
    expect(await checkMarketingEmailRecipient(db as never, 'u', 'customer@example.com', link('other-token'))).toBe('MARKETING_UNSUBSCRIBE_INVALID')
    expect(await checkMarketingEmailRecipient(db as never, 'u', 'customer@example.com', 'https://other.example/api/marketing/unsubscribe?token=address-token')).toBe('MARKETING_UNSUBSCRIBE_INVALID')
  })
})
