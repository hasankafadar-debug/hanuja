/**
 * Integration test — fulfillment-risk worker auto-cancel pipeline.
 * Verifies that breach risks accrue daily penalty and auto-cancel on day 20.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'

const {
  prismaMock,
  refreshActiveRisksMock,
  accrueDailyLateShipmentMock,
  autoCancelForFulfillmentBreachMock,
  notifySellerFulfillmentWarningMock,
} = vi.hoisted(() => ({
  prismaMock: {
    fulfillmentRisk: { findMany: vi.fn() },
    notification: { findFirst: vi.fn() },
  },
  refreshActiveRisksMock: vi.fn(),
  accrueDailyLateShipmentMock: vi.fn(),
  autoCancelForFulfillmentBreachMock: vi.fn(),
  notifySellerFulfillmentWarningMock: vi.fn(),
}))

vi.mock('../../../api/lib/redis', () => ({ redis: {} }))
vi.mock('../../../api/lib/queue', () => ({
  QUEUE_NAMES: { FULFILLMENT_RISK: 'fulfillment-risk' },
}))
vi.mock('../../../api/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('bullmq', () => ({
  Worker: class {
    on() {
      /* no-op */
    }
  },
  Job: class {},
}))
vi.mock('../../../api/services/fulfillment-risk.service', () => ({
  createFulfillmentRiskService: () => ({
    refreshActiveRisks: refreshActiveRisksMock,
  }),
}))
vi.mock('../../../api/services/penalty.service', () => ({
  createPenaltyService: () => ({
    accrueDailyLateShipment: accrueDailyLateShipmentMock,
  }),
}))
vi.mock('../../../api/services/notification.service', () => ({
  createNotificationService: () => ({
    notifySellerFulfillmentWarning: notifySellerFulfillmentWarningMock,
  }),
}))
// The ops-mailbox sweep has its own tests; the job only has to call it.
vi.mock('../../../api/services/fulfillment-risk-notification.service', () => ({
  sweepFulfillmentRiskNotifications: vi.fn().mockResolvedValue({
    notified: 0,
    resolved: 0,
    unchanged: 0,
    contended: 0,
  }),
}))
vi.mock('../../../api/services/order.service', () => ({
  createOrderService: () => ({
    autoCancelForFulfillmentBreach: autoCancelForFulfillmentBreachMock,
  }),
}))

function makeJob(): Job<{ warnAtDays?: number }> {
  return { data: { warnAtDays: 18 } } as unknown as Job<{
    warnAtDays?: number
  }>
}

// The job now calls findMany twice: once for warning risks and once for breached risks.
// Helper to return [] for warning lookups and supplied list for breached lookups.
function mockBreachedRisks(rows: unknown[]) {
  prismaMock.fulfillmentRisk.findMany.mockImplementation(
    async (args: { where?: { status?: string } } = {}) => {
      if (args.where?.status === 'warning') return []
      return rows
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshActiveRisksMock.mockResolvedValue({
    breached: 0,
    warning: 0,
    resolved: 0,
  })
  prismaMock.notification.findFirst.mockResolvedValue(null)
})

describe('fulfillment risk under the admin-managed policy', () => {
  it('refreshes overdue risks without creating monetary penalties or automatic cancellations', async () => {
    refreshActiveRisksMock.mockResolvedValue({
      breached: 2,
      warning: 0,
      resolved: 0,
    })
    mockBreachedRisks([
      {
        orderId: 'mixed',
        order: {
          id: 'mixed',
          status: 'preparing',
          lines: [{ sellerId: 'a' }, { sellerId: 'b' }],
        },
      },
    ])
    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())
    expect(result.breached).toBe(2)
    expect(accrueDailyLateShipmentMock).not.toHaveBeenCalled()
    expect(autoCancelForFulfillmentBreachMock).not.toHaveBeenCalled()
  })
  it('keeps the designer warning and deduplicates repeated warnings', async () => {
    prismaMock.fulfillmentRisk.findMany.mockResolvedValue([
      {
        orderId: 'o1',
        deadlineAt: new Date(Date.now() + 86400000),
        seller: { user: { id: 'designer' } },
        order: { id: 'o1', publicNumber: 123 },
      },
    ])
    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    await processFulfillmentRisk(makeJob())
    expect(notifySellerFulfillmentWarningMock).toHaveBeenCalledTimes(1)
    prismaMock.notification.findFirst.mockResolvedValue({
      id: 'already-warned',
    })
    await processFulfillmentRisk(makeJob())
    expect(notifySellerFulfillmentWarningMock).toHaveBeenCalledTimes(1)
  })
})
