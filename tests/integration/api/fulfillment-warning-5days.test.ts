import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'

const {
  prismaMock,
  refreshActiveRisksMock,
  notifySellerFulfillmentWarningMock,
} = vi.hoisted(() => ({
  prismaMock: {
    fulfillmentRisk: { findMany: vi.fn() },
    notification: { findFirst: vi.fn() },
  },
  refreshActiveRisksMock: vi.fn(),
  notifySellerFulfillmentWarningMock: vi.fn(),
}))

vi.mock('../../../api/lib/redis', () => ({ redis: {} }))
vi.mock('../../../api/lib/queue', () => ({ QUEUE_NAMES: { FULFILLMENT_RISK: 'fulfillment-risk' } }))
vi.mock('../../../api/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('bullmq', () => ({
  Worker: class {
    on() { /* no-op */ }
  },
  Job: class {},
}))
vi.mock('../../../api/services/fulfillment-risk.service', () => ({
  createFulfillmentRiskService: () => ({ refreshActiveRisks: refreshActiveRisksMock }),
}))
vi.mock('../../../api/services/penalty.service', () => ({
  createPenaltyService: () => ({ accrueDailyLateShipment: vi.fn() }),
}))
vi.mock('../../../api/services/order.service', () => ({
  createOrderService: () => ({ autoCancelForFulfillmentBreach: vi.fn() }),
}))
vi.mock('../../../api/services/notification.service', () => ({
  createNotificationService: () => ({
    notifySellerFulfillmentWarning: notifySellerFulfillmentWarningMock,
  }),
}))

function makeJob(): Job<{ warnAtDays?: number }> {
  return { data: { warnAtDays: 5 } } as unknown as Job<{ warnAtDays?: number }>
}

describe('fulfillment warning 5 days notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refreshActiveRisksMock.mockResolvedValue({ breached: 0, warning: 1, resolved: 0 })
  })

  it('sends a warning notification once for a warning risk', async () => {
    prismaMock.fulfillmentRisk.findMany
      .mockResolvedValueOnce([
        {
          orderId: 'order-1',
          deadlineAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
          seller: { user: { id: 'seller-user-1' } },
          order: { id: 'order-1', publicNumber: 26000011 },
        },
      ])
      .mockResolvedValueOnce([])
    prismaMock.notification.findFirst.mockResolvedValue(null)

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    await processFulfillmentRisk(makeJob())

    expect(notifySellerFulfillmentWarningMock).toHaveBeenCalledWith(
      'seller-user-1',
      'order-1',
      '26000011',
      expect.any(Number),
    )
  })

  it('does not send a duplicate warning when one already exists', async () => {
    prismaMock.fulfillmentRisk.findMany
      .mockResolvedValueOnce([
        {
          orderId: 'order-2',
          deadlineAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
          seller: { user: { id: 'seller-user-2' } },
          order: { id: 'order-2', publicNumber: 26000012 },
        },
      ])
      .mockResolvedValueOnce([])
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'notif-1' })

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    await processFulfillmentRisk(makeJob())

    expect(notifySellerFulfillmentWarningMock).not.toHaveBeenCalled()
  })
})
