import { describe, expect, it } from 'vitest'
import { formatEmailMoney } from '../../api/lib/email-money'
describe('transactional email amounts', () => {
  it('preserves the actual EFT refund kuruş instead of displaying a rounded lira', () => {
    expect(formatEmailMoney('1167.74')).toBe('1.167,74 TL')
    expect(formatEmailMoney(642.26)).toBe('642,26 TL')
    expect(formatEmailMoney({ toString: () => '-912.13' })).toBe('-912,13 TL')
    expect(formatEmailMoney(1200)).toBe('1.200 TL')
  })
  it('refuses non-finite financial amounts', () => {
    expect(() => formatEmailMoney(Number.NaN)).toThrow('EMAIL_AMOUNT_INVALID')
  })
})
