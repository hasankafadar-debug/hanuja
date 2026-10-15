import { describe, it, expect } from 'vitest'
import { buildAdminConfirmation } from '../../../api/domain/delivery-confirmation'
describe('admin delivery confirmation', () => {
  it('preserves the verified admin timestamp and source', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    expect(buildAdminConfirmation(now)).toEqual({
      confirmed: true,
      source: 'admin_manual',
      confirmedAt: now,
    })
  })
})
