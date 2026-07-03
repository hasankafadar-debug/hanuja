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
  createPenaltyService: () => ({ accrueDailyLateShipment: accrueDailyLateShipmentMock }),
}))
vi.mock('../../../api/services/notification.service', () => ({
  createNotificationService: () => ({
    notifySellerFulfillmentWarning: notifySellerFulfillmentWarningMock,
  }),
}))
vi.mock('../../../api/services/order.service', () => ({
  createOrderService: () => ({ autoCancelForFulfillmentBreach: autoCancelForFulfillmentBreachMock }),
}))

function makeJob(): Job<{ warnAtDays?: number }> {
  return { data: { warnAtDays: 18 } } as unknown as Job<{ warnAtDays?: number }>
}

// The job now calls findMany twice: once for warning risks and once for breached risks.
// Helper to return [] for warning lookups and supplied list for breached lookups.
function mockBreachedRisks(rows: unknown[]) {
  prismaMock.fulfillmentRisk.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) => {
    if (args.where?.status === 'warning') return []
    return rows
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshActiveRisksMock.mockResolvedValue({ breached: 0, warning: 0, resolved: 0 })
  prismaMock.notification.findFirst.mockResolvedValue(null)
})

describe('processFulfillmentRisk', () => {
  it('skips breaches whose order has no seller line', async () => {
    mockBreachedRisks([
      { orderId: 'o1', order: { id: 'o1', status: 'preparing', lines: [] } },
    ])

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(accrueDailyLateShipmentMock).not.toHaveBeenCalled()
    expect(autoCancelForFulfillmentBreachMock).not.toHaveBeenCalled()
    expect(result.accrued).toBe(0)
    expect(result.autoCancelled).toBe(0)
  })

  it('accrues penalty for a 19-day breach but does NOT auto-cancel', async () => {
    mockBreachedRisks([
      {
        orderId: 'o1',
        order: { id: 'o1', status: 'awaiting_shipment', lines: [{ sellerId: 's1' }] },
      },
    ])
    accrueDailyLateShipmentMock.mockResolvedValue({ accrualDayCount: 19 })

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(accrueDailyLateShipmentMock).toHaveBeenCalledWith({
      orderId: 'o1',
      asOf: expect.any(Date),
    })
    expect(autoCancelForFulfillmentBreachMock).not.toHaveBeenCalled()
    expect(result.accrued).toBe(1)
    expect(result.autoCancelled).toBe(0)
  })

  it('triggers auto-cancel when accrualDayCount reaches 20', async () => {
    mockBreachedRisks([
      {
        orderId: 'o2',
        order: { id: 'o2', status: 'awaiting_shipment', lines: [{ sellerId: 's2' }] },
      },
    ])
    accrueDailyLateShipmentMock.mockResolvedValue({ accrualDayCount: 20 })

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(autoCancelForFulfillmentBreachMock).toHaveBeenCalledWith({
      orderId: 'o2',
      sellerId: 's2',
      asOf: expect.any(Date),
    })
    expect(result.autoCancelled).toBe(1)
  })

  it('does not double-cancel an order that is already cancelled_due_to_20day_breach', async () => {
    mockBreachedRisks([
      {
        orderId: 'o3',
        order: { id: 'o3', status: 'cancelled_due_to_20day_breach', lines: [{ sellerId: 's3' }] },
      },
    ])
    accrueDailyLateShipmentMock.mockResolvedValue({ accrualDayCount: 21 })

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(autoCancelForFulfillmentBreachMock).not.toHaveBeenCalled()
    expect(result.autoCancelled).toBe(0)
  })

  it('skips orders where accrueDailyLateShipment returns null (deadline not breached)', async () => {
    mockBreachedRisks([
      {
        orderId: 'o4',
        order: { id: 'o4', status: 'preparing', lines: [{ sellerId: 's4' }] },
      },
    ])
    accrueDailyLateShipmentMock.mockResolvedValue(null)

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(autoCancelForFulfillmentBreachMock).not.toHaveBeenCalled()
    expect(result.accrued).toBe(0)
  })

  it('processes multiple breached orders independently', async () => {
    mockBreachedRisks([
      { orderId: 'o5', order: { id: 'o5', status: 'preparing', lines: [{ sellerId: 's5' }] } },
      { orderId: 'o6', order: { id: 'o6', status: 'awaiting_shipment', lines: [{ sellerId: 's6' }] } },
    ])
    accrueDailyLateShipmentMock
      .mockResolvedValueOnce({ accrualDayCount: 5 })
      .mockResolvedValueOnce({ accrualDayCount: 20 })

    const { processFulfillmentRisk } = await import('../../../api/jobs/fulfillment-risk.job')
    const result = await processFulfillmentRisk(makeJob())

    expect(result.accrued).toBe(2)
    expect(result.autoCancelled).toBe(1)
    expect(autoCancelForFulfillmentBreachMock).toHaveBeenCalledTimes(1)
    expect(autoCancelForFulfillmentBreachMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o6' }))
  })
})
