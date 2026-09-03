import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { ConflictError } from '../../../api/lib/errors'
import { postPaymentConfirmedSellerAccruals } from '../../../api/services/seller-payment-accrual.service'

type LedgerRow = {
  id: string
  sellerId: string
  type: string
  amount: InstanceType<typeof Decimal>
  eventKey?: string
  effectiveAt?: Date
  visibleToSeller?: boolean
}

function buildPrisma(lines: Array<{
  sellerId: string
  totalPrice: InstanceType<typeof Decimal>
  couponDiscountAmount: InstanceType<typeof Decimal>
}>) {
  const entries: LedgerRow[] = []
  const sellerLedgerEntry = {
    findUnique: vi.fn(async ({ where }: { where: { eventKey: string } }) =>
      entries.find((entry) => entry.eventKey === where.eventKey) ?? null,
    ),
    aggregate: vi.fn(async ({ where }: { where: { sellerId: string } }) => ({
      _sum: {
        amount: entries
          .filter((entry) => entry.sellerId === where.sellerId)
          .reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)),
      },
    })),
    create: vi.fn(async ({ data }: { data: Omit<LedgerRow, 'id'> }) => {
      const entry = { id: `ledger-${entries.length + 1}`, ...data }
      entries.push(entry)
      return entry
    }),
  }
  const prisma = {
    orderLine: { findMany: vi.fn(async () => lines) },
    sellerLedgerEntry,
  }
  return { prisma: prisma as never, entries, sellerLedgerEntry }
}

describe('payment-confirmed seller accruals', () => {
  it('posts visible gross sales and separate seller-coupon debits per seller', async () => {
    const effectiveAt = new Date('2026-09-03T08:00:00.000Z')
    const { prisma, entries } = buildPrisma([
      {
        sellerId: 'seller-a',
        totalPrice: new Decimal('600.00'),
        couponDiscountAmount: new Decimal('60.00'),
      },
      {
        sellerId: 'seller-a',
        totalPrice: new Decimal('400.00'),
        couponDiscountAmount: new Decimal('40.00'),
      },
      {
        sellerId: 'seller-b',
        totalPrice: new Decimal('250.00'),
        couponDiscountAmount: new Decimal('0.00'),
      },
    ])

    await postPaymentConfirmedSellerAccruals({
      prisma,
      tx: prisma,
      orderId: 'order-1',
      effectiveAt,
      actorId: 'system',
    })

    expect(entries).toHaveLength(3)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sellerId: 'seller-a',
        type: 'sale',
        amount: expect.objectContaining({}),
        eventKey: 'payment-confirmed:sale:order-1:seller-a',
        effectiveAt,
        visibleToSeller: true,
      }),
      expect.objectContaining({
        sellerId: 'seller-a',
        type: 'coupon_share',
        eventKey: 'payment-confirmed:coupon-share:order-1:seller-a',
        effectiveAt,
        visibleToSeller: true,
      }),
      expect.objectContaining({
        sellerId: 'seller-b',
        type: 'sale',
        eventKey: 'payment-confirmed:sale:order-1:seller-b',
      }),
    ]))
    expect(entries.find((entry) => entry.eventKey?.endsWith('seller-a') && entry.type === 'sale')?.amount.toFixed(2)).toBe('1000.00')
    expect(entries.find((entry) => entry.type === 'coupon_share')?.amount.toFixed(2)).toBe('-100.00')
    expect(entries.find((entry) => entry.eventKey?.endsWith('seller-b'))?.amount.toFixed(2)).toBe('250.00')
  })

  it('is idempotent when the same payment confirmation is handled twice', async () => {
    const effectiveAt = new Date('2026-09-03T08:00:00.000Z')
    const { prisma, entries } = buildPrisma([
      {
        sellerId: 'seller-a',
        totalPrice: new Decimal('1000.00'),
        couponDiscountAmount: new Decimal('100.00'),
      },
    ])
    const params = {
      prisma,
      tx: prisma,
      orderId: 'order-1',
      effectiveAt,
      actorId: 'system',
    }

    await postPaymentConfirmedSellerAccruals(params)
    await postPaymentConfirmedSellerAccruals(params)

    expect(entries).toHaveLength(2)
    expect(entries.reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)).toFixed(2)).toBe('900.00')
  })

  it('fails closed when a confirmed order has no seller lines', async () => {
    const { prisma } = buildPrisma([])

    await expect(postPaymentConfirmedSellerAccruals({
      prisma,
      tx: prisma,
      orderId: 'order-empty',
      effectiveAt: new Date('2026-09-03T08:00:00.000Z'),
      actorId: 'system',
    })).rejects.toBeInstanceOf(ConflictError)
  })
})
