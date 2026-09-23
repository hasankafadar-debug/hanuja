import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { recordAdminOperationNotificationMock } = vi.hoisted(() => ({
  recordAdminOperationNotificationMock: vi.fn(),
}))

vi.mock('../../../api/services/admin-notification.service', () => ({
  recordAdminOperationNotification: recordAdminOperationNotificationMock,
  adminPanelLink: (path: string) => `https://admin.hanuja.com.tr${path}`,
}))

import {
  aggregateRiskLevel,
  processRiskGroup,
  sweepFulfillmentRiskNotifications,
} from '../../../api/services/fulfillment-risk-notification.service'

const ASOF = new Date('2026-09-22T09:00:00.000Z')
const GROUP = { orderId: 'order-1', sellerId: 'seller-1' }

function risk(status: 'warning' | 'breached' | 'resolved') {
  return {
    id: `risk-${status}`,
    orderId: GROUP.orderId,
    sellerId: GROUP.sellerId,
    status,
    deadlineAt: new Date('2026-09-18T09:00:00.000Z'),
    order: { id: GROUP.orderId, publicNumber: 26050042 },
    seller: { id: GROUP.sellerId, displayName: 'Atelier Noa' },
    orderLine: {
      productId: 'product-1',
      productName: 'Gea Berjer',
      variantName: null,
      quantity: 2,
      unitPrice: new Decimal('100.00'),
    },
  }
}

/** Minimal transaction client with a single in-memory state row. */
function buildPrisma(options: {
  risks: ReturnType<typeof risk>[]
  state?: {
    id: string
    notifiedStatus: string
    transitionSeq: number
    version: number
  } | null
  claimWins?: boolean
}) {
  const state = options.state ?? null
  const tx = {
    fulfillmentRisk: { findMany: vi.fn().mockResolvedValue(options.risks) },
    fulfillmentRiskNotificationState: {
      findUnique: vi.fn().mockResolvedValue(state),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'state-1',
        ...data,
      })),
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: options.claimWins === false ? 0 : 1 }),
    },
    productImage: { findMany: vi.fn().mockResolvedValue([]) },
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  }
  return { prisma, tx }
}

describe('fulfillment risk notification transitions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ranks breached above warning and treats an empty group as resolved', () => {
    expect(aggregateRiskLevel(['warning', 'breached'])).toBe('breached')
    expect(aggregateRiskLevel(['warning'])).toBe('warning')
    expect(aggregateRiskLevel([])).toBe('resolved')
  })

  it('notifies the first risk with sequence 1', async () => {
    const { prisma, tx } = buildPrisma({ risks: [risk('warning')] })
    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'notified',
    )
    expect(tx.fulfillmentRiskNotificationState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notifiedStatus: 'warning', transitionSeq: 1 }),
      }),
    )
    const payload = recordAdminOperationNotificationMock.mock.calls[0]![1]
    expect(payload.eventKey).toBe('fulfillment-risk:order-1:seller-1:1:warning')
    expect(payload.data).toMatchObject({
      riskLevel: 'warning',
      sellerName: 'Atelier Noa',
      adminUrl: 'https://admin.hanuja.com.tr/siparisler/order-1',
    })
    expect(payload.data.items).toHaveLength(1)
  })

  it('notifies a level change with the next sequence', async () => {
    const { prisma } = buildPrisma({
      risks: [risk('breached')],
      state: { id: 'state-1', notifiedStatus: 'warning', transitionSeq: 1, version: 3 },
    })
    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'notified',
    )
    expect(recordAdminOperationNotificationMock.mock.calls[0]![1].eventKey).toBe(
      'fulfillment-risk:order-1:seller-1:2:breached',
    )
  })

  it('writes nothing when the level is unchanged', async () => {
    const { prisma, tx } = buildPrisma({
      risks: [risk('warning')],
      state: { id: 'state-1', notifiedStatus: 'warning', transitionSeq: 1, version: 0 },
    })
    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'unchanged',
    )
    expect(tx.fulfillmentRiskNotificationState.updateMany).not.toHaveBeenCalled()
    expect(recordAdminOperationNotificationMock).not.toHaveBeenCalled()
  })

  it('records a resolved risk without sending an e-mail', async () => {
    const { prisma, tx } = buildPrisma({
      risks: [risk('resolved')],
      state: { id: 'state-1', notifiedStatus: 'breached', transitionSeq: 2, version: 1 },
    })
    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'resolved',
    )
    expect(tx.fulfillmentRiskNotificationState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notifiedStatus: 'resolved', transitionSeq: 2 }),
      }),
    )
    expect(recordAdminOperationNotificationMock).not.toHaveBeenCalled()
  })

  it('notifies again when a resolved risk recurs at the same level', async () => {
    const { prisma } = buildPrisma({
      risks: [risk('breached')],
      state: { id: 'state-1', notifiedStatus: 'resolved', transitionSeq: 2, version: 4 },
    })
    await processRiskGroup(prisma as never, GROUP, ASOF)
    expect(recordAdminOperationNotificationMock.mock.calls[0]![1].eventKey).toBe(
      'fulfillment-risk:order-1:seller-1:3:breached',
    )
  })

  it('skips the group and writes no notification when the version claim is lost', async () => {
    const { prisma, tx } = buildPrisma({
      risks: [risk('breached')],
      state: { id: 'state-1', notifiedStatus: 'warning', transitionSeq: 1, version: 7 },
      claimWins: false,
    })
    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'contended',
    )
    expect(tx.fulfillmentRiskNotificationState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'state-1', version: 7 } }),
    )
    expect(recordAdminOperationNotificationMock).not.toHaveBeenCalled()
  })

  it('retries a unique-violation race in a new transaction', async () => {
    const tx = {
      fulfillmentRisk: { findMany: vi.fn().mockResolvedValue([risk('warning')]) },
      fulfillmentRiskNotificationState: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            id: 'state-1',
            notifiedStatus: 'resolved',
            transitionSeq: 1,
            version: 0,
          }),
        create: vi.fn().mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }

    await expect(processRiskGroup(prisma as never, GROUP, ASOF)).resolves.toBe(
      'notified',
    )
    // Two separate transactions: the failed one cannot be continued.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(tx.fulfillmentRiskNotificationState.findUnique).toHaveBeenCalledTimes(2)
    expect(recordAdminOperationNotificationMock).toHaveBeenCalledTimes(1)
  })

  it('sweeps groups that fell off the active risk list so a recurrence is notifiable', async () => {
    const prisma = {
      fulfillmentRisk: {
        findMany: vi
          .fn()
          // Outer scan: no active risks at all.
          .mockResolvedValueOnce([])
          // Inner read for the tracked group.
          .mockResolvedValue([]),
      },
      fulfillmentRiskNotificationState: {
        findMany: vi.fn().mockResolvedValue([
          { orderId: 'order-9', sellerId: 'seller-9' },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          id: 'state-9',
          notifiedStatus: 'breached',
          transitionSeq: 1,
          version: 0,
        }),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(prisma)),
    }

    const result = await sweepFulfillmentRiskNotifications(prisma as never, ASOF)

    expect(result).toMatchObject({ resolved: 1, notified: 0 })
    expect(prisma.fulfillmentRiskNotificationState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notifiedStatus: 'resolved' }),
      }),
    )
    expect(recordAdminOperationNotificationMock).not.toHaveBeenCalled()
  })
})
