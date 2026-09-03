/**
 * Integration test — komisyon muafiyetinin payout hesabına yansıması.
 *
 * Denetim bulgusu: admin OrderLine.commissionExemptedAt yazsa bile
 * payout.service.activateHold komisyonu muafiyet kontrolü olmadan topluyordu,
 * yani muafiyet payout'a hiç yansımıyordu.
 *
 * Invariants (07-marketplace-finance-rules.md, docs/01-business/payout-policy.md):
 * - Muafiyetli satırın komisyonu payout'ta 0 sayılır; net payout o kadar artar.
 * - Gross tutar muafiyetten etkilenmez.
 * - `commission` ledger entry yalnız muafiyetsiz satırların komisyonunu içerir.
 * - Payout kaydı oluşmuşsa muafiyet uygulanamaz (rota 409).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

import { createPayoutService } from '../../../api/services/payout.service'

// ─── activateHold: muafiyet-farkında payout snapshot ─────────────────────────

interface FakeLine {
  id: string
  sellerId: string
  totalPrice: InstanceType<typeof Decimal>
  commissionAmount: InstanceType<typeof Decimal>
  netPayoutAmount: InstanceType<typeof Decimal>
  commissionExemptedAt: Date | null
}

function buildActivateHoldPrisma(lines: FakeLine[]) {
  const createdPayouts: Array<Record<string, unknown>> = []
  const createdLedgerEntries: Array<Record<string, unknown>> = []

  const prisma: Record<string, unknown> = {
    order: {
      findUnique: vi.fn(async () => ({ id: 'o1', status: 'delivery_confirmed' })),
    },
    payout: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
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
      findUnique: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { amount: new Decimal(0) } })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        createdLedgerEntries.push(args.data)
        return { id: `ledger-${createdLedgerEntries.length}`, ...args.data }
      }),
    },
  }

  return {
    prisma: prisma as unknown as import('@prisma/client').PrismaClient,
    createdPayouts,
    createdLedgerEntries,
  }
}

const DELIVERY_CONFIRMED_AT = new Date('2026-05-01T00:00:00Z')

describe('activateHold — komisyon muafiyeti payout snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('karma senaryo: muafiyetli satır komisyonsuz, muafiyetsiz satır komisyonlu', async () => {
    // Line A: gross 1000, %15 komisyon = 150, net 850 — MUAF
    // Line B: gross 2000, %15 komisyon = 300, net 1700 — normal
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(1000),
        commissionAmount: new Decimal(150),
        netPayoutAmount: new Decimal(850),
        commissionExemptedAt: new Date('2026-04-20T00:00:00Z'),
      },
      {
        id: 'lineB',
        sellerId: 'seller-1',
        totalPrice: new Decimal(2000),
        commissionAmount: new Decimal(300),
        netPayoutAmount: new Decimal(1700),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({
      orderId: 'o1',
      deliveryConfirmedAt: DELIVERY_CONFIRMED_AT,
    })

    expect(createdPayouts).toHaveLength(1)
    const payout = createdPayouts[0] as {
      grossAmount: InstanceType<typeof Decimal>
      commissionAmount: InstanceType<typeof Decimal>
      netAmount: InstanceType<typeof Decimal>
    }

    // Gross muafiyetten etkilenmez: 1000 + 2000 = 3000
    expect(payout.grossAmount.toNumber()).toBe(3000)
    // Komisyon yalnız muafiyetsiz satırdan: 300 (muaf satırın 150'si düşer)
    expect(payout.commissionAmount.toNumber()).toBe(300)
    // Net = 1000 (muaf satır: 850 + 150 komisyon geri eklendi) + 1700 = 2700
    expect(payout.netAmount.toNumber()).toBe(2700)
  })

  it('muafiyet olmadan komisyon tam düşülür (regresyon koruması)', async () => {
    const lines: FakeLine[] = [
      {
        id: 'lineB',
        sellerId: 'seller-1',
        totalPrice: new Decimal(2000),
        commissionAmount: new Decimal(300),
        netPayoutAmount: new Decimal(1700),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({
      orderId: 'o1',
      deliveryConfirmedAt: DELIVERY_CONFIRMED_AT,
    })

    const payout = createdPayouts[0] as {
      grossAmount: InstanceType<typeof Decimal>
      commissionAmount: InstanceType<typeof Decimal>
      netAmount: InstanceType<typeof Decimal>
    }
    expect(payout.grossAmount.toNumber()).toBe(2000)
    expect(payout.commissionAmount.toNumber()).toBe(300)
    expect(payout.netAmount.toNumber()).toBe(1700)
  })

  it('commission ledger entry tutarı yalnız muafiyetsiz komisyonu içerir', async () => {
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(1000),
        commissionAmount: new Decimal(150),
        netPayoutAmount: new Decimal(850),
        commissionExemptedAt: new Date('2026-04-20T00:00:00Z'),
      },
      {
        id: 'lineB',
        sellerId: 'seller-1',
        totalPrice: new Decimal(2000),
        commissionAmount: new Decimal(300),
        netPayoutAmount: new Decimal(1700),
        commissionExemptedAt: null,
      },
    ]

    const { prisma, createdLedgerEntries } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({
      orderId: 'o1',
      deliveryConfirmedAt: DELIVERY_CONFIRMED_AT,
    })

    const commissionEntry = createdLedgerEntries.find((e) => e.type === 'commission') as
      | { amount: InstanceType<typeof Decimal> }
      | undefined
    expect(commissionEntry).toBeDefined()
    // negated: -300 (muaf satırın 150'si dahil değil)
    expect(commissionEntry!.amount.toNumber()).toBe(-300)

    const saleEntry = createdLedgerEntries.find((e) => e.type === 'sale') as
      | { amount: InstanceType<typeof Decimal> }
      | undefined
    expect(saleEntry).toBeDefined()
    expect(saleEntry!.amount.toNumber()).toBe(3000)
  })

  it('tüm satırlar muafsa commission ledger entry hiç yazılmaz', async () => {
    const lines: FakeLine[] = [
      {
        id: 'lineA',
        sellerId: 'seller-1',
        totalPrice: new Decimal(1000),
        commissionAmount: new Decimal(150),
        netPayoutAmount: new Decimal(850),
        commissionExemptedAt: new Date('2026-04-20T00:00:00Z'),
      },
    ]

    const { prisma, createdLedgerEntries, createdPayouts } = buildActivateHoldPrisma(lines)
    const svc = createPayoutService({ prisma })

    await svc.activateHold({
      orderId: 'o1',
      deliveryConfirmedAt: DELIVERY_CONFIRMED_AT,
    })

    const payout = createdPayouts[0] as {
      commissionAmount: InstanceType<typeof Decimal>
      netAmount: InstanceType<typeof Decimal>
    }
    expect(payout.commissionAmount.toNumber()).toBe(0)
    // net = 850 + 150 (komisyon geri eklendi) = 1000
    expect(payout.netAmount.toNumber()).toBe(1000)

    const commissionEntry = createdLedgerEntries.find((e) => e.type === 'commission')
    expect(commissionEntry).toBeUndefined()
  })
})

// ─── Rota: payout kaydı varken muafiyet 409 ──────────────────────────────────

const {
  getSessionMock,
  prismaMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  prismaMock: {
    orderLine: { findUnique: vi.fn(), update: vi.fn() },
    payout: { findFirst: vi.fn() },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: () => prismaMock,
}))

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/order-lines/line-1/commission-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<
    typeof import('../../../apps/admin-panel/src/app/api/admin/order-lines/[id]/commission-exempt/route').POST
  >[0]
}

const ctx = { params: Promise.resolve({ id: 'line-1' }) }

describe('POST /api/admin/order-lines/[id]/commission-exempt — payout guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    prismaMock.orderLine.findUnique.mockResolvedValue({
      id: 'line-1',
      orderId: 'o1',
      sellerId: 'seller-1',
      commissionInvoiceId: null,
      commissionExemptedAt: null,
    })
    prismaMock.orderLine.update.mockResolvedValue({ id: 'line-1', commissionExemptedAt: new Date() })
  })

  it('payout kaydı varsa 409 döner ve muafiyet yazılmaz', async () => {
    prismaMock.payout.findFirst.mockResolvedValue({ id: 'payout-1' })

    const route = await import(
      '../../../apps/admin-panel/src/app/api/admin/order-lines/[id]/commission-exempt/route'
    )
    const response = await route.POST(buildRequest({ reason: 'sistem hatası' }), ctx)

    expect(response.status).toBe(409)
    const json = (await response.json()) as { message: string }
    expect(json.message).toContain('Hakediş kaydı oluşturulmuş')
    expect(prismaMock.orderLine.update).not.toHaveBeenCalled()
  })

  it('payout kaydı yoksa muafiyet uygulanır', async () => {
    prismaMock.payout.findFirst.mockResolvedValue(null)

    const route = await import(
      '../../../apps/admin-panel/src/app/api/admin/order-lines/[id]/commission-exempt/route'
    )
    const response = await route.POST(buildRequest({ reason: 'sistem hatası' }), ctx)

    expect(response.status).toBe(200)
    expect(prismaMock.orderLine.update).toHaveBeenCalledTimes(1)
  })
})
