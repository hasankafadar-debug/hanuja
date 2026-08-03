import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { NotFoundError } from '../../../api/lib/errors'
import { createDisputeService } from '../../../api/services/dispute.service'

function createPrismaMock() {
  return {
    dispute: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    disputeMessage: {
      create: vi.fn(),
    },
  }
}

function createService(prisma: ReturnType<typeof createPrismaMock>) {
  return createDisputeService({ prisma: prisma as unknown as PrismaClient })
}

const directDispute = {
  id: 'dispute-direct',
  orderId: 'order-1',
  status: 'open',
  reason: 'Damaged item',
  description: null,
  resolution: null,
  payoutBlocked: true,
  refundAmount: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  messages: [],
  evidence: [],
  escalatedFromReturn: null,
}

const escalatedDispute = {
  ...directDispute,
  id: 'dispute-escalated',
  escalatedFromReturn: {
    id: 'return-1',
    status: 'rejected',
    reason: 'Wrong item',
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    evidence: [],
  },
}

const openMessageTarget = { id: 'dispute-direct', status: 'open' }

describe('dispute authorization', () => {
  it('reads a direct dispute for its customer through an ownership-scoped query', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(directDispute)

    await expect(
      createService(prisma).getDispute('dispute-direct', {
        viewerId: 'customer-1',
        viewerRole: 'customer',
      }),
    ).resolves.toEqual(directDispute)

    expect(prisma.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'dispute-direct',
          OR: [
            { order: { customerId: 'customer-1' } },
            {
              order: { lines: { some: { seller: { userId: 'customer-1' } } } },
            },
          ],
        },
      }),
    )
  })

  it('reads a direct dispute for a seller with an order line', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(directDispute)

    await expect(
      createService(prisma).getDispute('dispute-direct', {
        viewerId: 'seller-user-1',
        viewerRole: 'seller',
      }),
    ).resolves.toEqual(directDispute)

    expect(prisma.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              order: {
                lines: { some: { seller: { userId: 'seller-user-1' } } },
              },
            },
          ]),
        }),
      }),
    )
  })

  it.each([
    ['another customer', 'customer-2', 'customer'],
    ['unrelated seller', 'seller-user-2', 'seller'],
  ] as const)('returns the same NotFound result for %s', async (_label, viewerId, viewerRole) => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(null)

    await expect(
      createService(prisma).getDispute('dispute-direct', {
        viewerId,
        viewerRole,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('allows staff with dispute:view_all to read an escalated dispute', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findUnique.mockResolvedValue(escalatedDispute)

    await expect(
      createService(prisma).getDispute('dispute-escalated', {
        viewerId: 'admin-1',
        viewerRole: 'admin',
      }),
    ).resolves.toEqual(escalatedDispute)

    expect(prisma.dispute.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dispute-escalated' } }),
    )
    expect(prisma.dispute.findFirst).not.toHaveBeenCalled()
  })

  it('gives the future support role its existing view-all read permission', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findUnique.mockResolvedValue(directDispute)

    await expect(
      createService(prisma).getDispute('dispute-direct', {
        viewerId: 'support-1',
        viewerRole: 'support',
      }),
    ).resolves.toEqual(directDispute)
  })

  it('uses a least-privilege projection for customer and seller reads, including escalated returns', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(escalatedDispute)

    await createService(prisma).getDispute('dispute-escalated', {
      viewerId: 'customer-1',
      viewerRole: 'customer',
    })

    const query = prisma.dispute.findFirst.mock.calls[0]![0]
    expect(query.select).not.toHaveProperty('order')
    expect(query.select).not.toHaveProperty('payments')
    expect(query.select.evidence.select).not.toHaveProperty('key')
    expect(query.select.escalatedFromReturn.select).not.toHaveProperty('order')
    expect(query.select.escalatedFromReturn.select.evidence.select).not.toHaveProperty('key')
  })

  it('keeps staff media references private while including case context', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findUnique.mockResolvedValue(escalatedDispute)

    await createService(prisma).getDispute('dispute-escalated', {
      viewerId: 'admin-1',
      viewerRole: 'admin',
    })

    const query = prisma.dispute.findUnique.mock.calls[0]![0]
    expect(query.select.order.select.publicNumber).toBe(true)
    expect(query.select).not.toHaveProperty('payments')
    expect(query.select.evidence.select).not.toHaveProperty('url')
    expect(query.select.escalatedFromReturn.select.evidence.select).not.toHaveProperty('url')
  })

  it.each([
    ['customer', 'customer-1', 'customer'],
    ['participating seller', 'seller-user-1', 'seller'],
  ] as const)('allows an authorized %s to add a message', async (_label, viewerId, viewerRole) => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(openMessageTarget)
    prisma.disputeMessage.create.mockResolvedValue({ id: 'message-1' })

    await expect(
      createService(prisma).addMessage({
        disputeId: 'dispute-direct',
        viewer: { viewerId, viewerRole },
        body: 'Case update',
      }),
    ).resolves.toEqual({ id: 'message-1' })

    expect(prisma.disputeMessage.create).toHaveBeenCalledWith({
      data: {
        disputeId: 'dispute-direct',
        authorId: viewerId,
        authorRole: viewerRole,
        body: 'Case update',
      },
    })
  })

  it.each([
    ['another customer', 'customer-2', 'customer'],
    ['unrelated seller', 'seller-user-2', 'seller'],
  ] as const)('does not allow %s to add a message', async (_label, viewerId, viewerRole) => {
    const prisma = createPrismaMock()
    prisma.dispute.findFirst.mockResolvedValue(null)

    await expect(
      createService(prisma).addMessage({
        disputeId: 'dispute-direct',
        viewer: { viewerId, viewerRole },
        body: 'Injected message',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(prisma.disputeMessage.create).not.toHaveBeenCalled()
  })

  it('allows an admin to add a message through the staff path', async () => {
    const prisma = createPrismaMock()
    prisma.dispute.findUnique.mockResolvedValue(openMessageTarget)
    prisma.disputeMessage.create.mockResolvedValue({ id: 'message-admin' })

    await expect(
      createService(prisma).addMessage({
        disputeId: 'dispute-direct',
        viewer: { viewerId: 'admin-1', viewerRole: 'admin' },
        body: 'Admin review update',
      }),
    ).resolves.toEqual({ id: 'message-admin' })

    expect(prisma.disputeMessage.create).toHaveBeenCalledWith({
      data: {
        disputeId: 'dispute-direct',
        authorId: 'admin-1',
        authorRole: 'admin',
        body: 'Admin review update',
      },
    })
  })
})
