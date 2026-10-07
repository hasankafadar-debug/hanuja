import { describe, expect, it } from 'vitest'
import { withoutAdminOrderNotes } from '../../api/lib/private-order-fields'
import { toSellerSafeOrderDto, buildSellerOrderCsv } from '../../api/lib/seller-order-projection'

describe('private order note projection', () => {
  const raw = {
    id: 'o1',
    createdAt: new Date(),
    status: 'shipped',
    lines: [],
    customer: { name: 'Customer' },
    adminNotes: [{ body: 'PRIVATE-ADMIN-NOTE' }],
  }
  it('strips accidental private relation includes at customer and seller boundaries', () => {
    expect(withoutAdminOrderNotes(raw)).not.toHaveProperty('adminNotes')
    expect(toSellerSafeOrderDto(raw)).not.toHaveProperty('adminNotes')
    expect(buildSellerOrderCsv([raw])).not.toContain('PRIVATE-ADMIN-NOTE')
  })
})
