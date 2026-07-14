/**
 * Integration test — satıcı kuponu payının payout snapshot'ına yansıması.
 *
 * Invariant (07-marketplace-finance-rules.md, CLAUDE.md §15.3.3):
 * activateHold() OrderLine.couponDiscountAmount toplamını Payout.couponShareAmount
 * olarak yazmalı (önceden her zaman 0 hardcode ediliyordu — bu satıcı kuponu
 * maliyetini platforma yüklüyordu, yeni kural bunu satıcı hakedişinden düşürür).
 * netAmount = satır bazında zaten kupon payı düşülmüş netPayoutAmount toplamı.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'

import { createPayoutService } from '../../api/services/payout.service'

interface FakeLine {
  id: string
  sellerId: string
  totalPrice: InstanceType<typeof Decimal>
  commissionAmount: InstanceType<typeof Decimal>
  netPayoutAmount: InstanceType<typeof Decimal>
  couponDiscountAmount: InstanceType<typeof Decimal>
  commissionExemptedAt: Date | null
}

function buildActivateHoldPrisma(lines: FakeLine[]) {
  const createdPayouts: Array<Record<string, unknown>> = []

  const prisma: Record<string, unknown> = {
    order: {
      findUnique: vi.fn(async () => ({ id: 'o1', status: 'delivery_confirmed' })),
    },
    payout: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const payout = { id: `payout-${createdPayouts.length + 1}`, ...args.data }
        createdPayouts.push(payout)
        return payout
      }),
    },
    orderLine: {
      findMany: vi.fn(async () => lines),
    },
    sellerLedgerEntry: {
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { amount: new Decimal(0) } })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'ledger-1', ...args.data })),
    },
  }

  return { prisma: prisma as unknown as import('@prisma/client').PrismaClient, createdPayouts }
}

const DELIVERY_CONFIRMED_AT = new Date('2026-05-01T00:00:00Z')

describe('activateHold — satıcı kuponu payı payout snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('couponShareAmount satır bazlı couponDiscountAmount toplamından gelir', async () => {
    // Reference example line: gross 52690, coupon 5269, commission 8535.78, net 38885.22
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(52690),
        commissionAmount: new Decimal('8535.78'),
        netPayoutAmount: new Decimal('38885.22'),
        couponDiscountAmount: new Decimal(5269),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({ orderId: 'o1', deliveryConfirmedAt: DELIVERY_CONFIRMED_AT })

    const payout = createdPayouts[0] as {
      grossAmount: InstanceType<typeof Decimal>
      commissionAmount: InstanceType<typeof Decimal>
      couponShareAmount: InstanceType<typeof Decimal>
      netAmount: InstanceType<typeof Decimal>
    }

    expect(payout.grossAmount.toNumber()).toBe(52690)
    expect(payout.couponShareAmount.toNumber()).toBe(5269)
    expect(payout.commissionAmount.toNumber()).toBe(8535.78)
    expect(payout.netAmount.toNumber()).toBeCloseTo(38885.22, 2)
  })

  it('birden fazla satırda kupon payı toplanır', async () => {
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(300),
        commissionAmount: new Decimal(48.6), // (300-30)*0.15*1.2
        netPayoutAmount: new Decimal(221.4),
        couponDiscountAmount: new Decimal(30),
        commissionExemptedAt: null,
      },
      {
        id: 'lineB',
        sellerId: 'seller-1',
        totalPrice: new Decimal(700),
        commissionAmount: new Decimal(113.4), // (700-70)*0.15*1.2
        netPayoutAmount: new Decimal(516.6),
        couponDiscountAmount: new Decimal(70),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({ orderId: 'o1', deliveryConfirmedAt: DELIVERY_CONFIRMED_AT })

    const payout = createdPayouts[0] as { couponShareAmount: InstanceType<typeof Decimal> }
    expect(payout.couponShareAmount.toNumber()).toBe(100)
  })

  it('platform kuponunda (couponDiscountAmount 0) couponShareAmount 0 kalır — regresyon koruması', async () => {
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(1000),
        commissionAmount: new Decimal(180),
        netPayoutAmount: new Decimal(820),
        couponDiscountAmount: new Decimal(0),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({ orderId: 'o1', deliveryConfirmedAt: DELIVERY_CONFIRMED_AT })

    const payout = createdPayouts[0] as { couponShareAmount: InstanceType<typeof Decimal> }
    expect(payout.couponShareAmount.toNumber()).toBe(0)
  })
})
