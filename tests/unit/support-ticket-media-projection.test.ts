import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/services/notification.service', () => ({
  createNotificationService: vi.fn(() => ({ send: vi.fn() })),
}))

import { createCustomerSupportTicketService } from '../../api/services/customer-support-ticket.service'
import { createSupportTicketService } from '../../api/services/support-ticket.service'

describe('support ticket media projections', () => {
  it('selects only id and originalName for seller support attachments', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'ticket-1' })
    const service = createSupportTicketService({
      prisma: { supportTicket: { findFirst } } as any,
    })

    await service.getForSeller('ticket-1', 'seller-1')

    const mediaSelect =
      findFirst.mock.calls[0]?.[0].include.messages.include.attachments.include.mediaAsset.select
    expect(mediaSelect).toEqual({ id: true, originalName: true })
    expect(mediaSelect).not.toHaveProperty('url')
    expect(mediaSelect).not.toHaveProperty('key')
    expect(mediaSelect).not.toHaveProperty('variants')
  })

  it('selects only id and originalName for customer support attachments', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'ticket-1',
      customerId: 'customer-1',
    })
    const service = createCustomerSupportTicketService({
      prisma: { customerSupportTicket: { findUnique } } as any,
    })

    await service.getByIdForCustomer('ticket-1', 'customer-1')

    const mediaSelect =
      findUnique.mock.calls[0]?.[0].include.messages.include.attachments.include.mediaAsset.select
    expect(mediaSelect).toEqual({ id: true, originalName: true })
    expect(mediaSelect).not.toHaveProperty('url')
    expect(mediaSelect).not.toHaveProperty('key')
    expect(mediaSelect).not.toHaveProperty('variants')
  })
})
