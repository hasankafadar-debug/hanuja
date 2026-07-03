/**
 * Integration test — confirmCardPayment tutar/sipariş bağlama doğrulaması.
 *
 * Invariants:
 * - Provider'ın bildirdiği tutar sipariş toplamına eşit değilse onay reddedilir
 *   ve amount_mismatch_rejected PaymentEvent kanıtı yazılır.
 * - Aynı providerRef (Iyzico paymentId) başka bir siparişi onaylayamaz.
 * - Idempotent tekrar onay (status=confirmed) hâlâ sessizce geçer.
 * - Unique kısıt yarışında P2002 → ConflictError çevrilir.
 *
 * See: docs/05-security/payment-security.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))
vi.mock('../../../api/services/order-document.service', () => ({
  createOrderDocumentService: () => ({
    ensureInvoiceAliasesForOrder: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { createPaymentService } from '../../../api/services/payment.service'
import { ConflictError } from '../../../api/lib/errors'

type FindFirstArgs = { where?: { orderId?: string; providerPaymentId?: string } }

function buildPrismaMock(options: {
  payment: { id: string; orderId: string; status: string } | null
  order: { totalAmount: InstanceType<typeof Decimal> } | null
  paymentByProviderRef?: { id: string; orderId: string } | null
}) {
  const prisma: Record<string, unknown> = {}

  const paymentFindFirst = vi.fn(async (args: FindFirstArgs) => {
    if (args.where?.providerPaymentId !== undefined) {
      return options.paymentByProviderRef ?? null
    }
    return options.payment
  })

  Object.assign(prisma, {
    payment: {
      findFirst: paymentFindFirst,
      update: vi.fn(async () => ({ ...options.payment, status: 'confirmed' })),
    },
    order: {
      findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) => {
        if (!options.order) return null
        if (args.select && 'totalAmount' in args.select) {
          return { totalAmount: options.order.totalAmount }
        }
        // transaction içi + bildirim yolu
        return {
          id: options.payment?.orderId ?? 'o1',
          status: 'payment_pending',
          customerId: 'c1',
          lines: [],
        }
      }),
      update: vi.fn(async () => ({})),
    },
    paymentEvent: { create: vi.fn(async () => ({})) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    orderLine: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    cartItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  })

  return prisma as unknown as import('@prisma/client').PrismaClient & {
    payment: { findFirst: typeof paymentFindFirst; update: ReturnType<typeof vi.fn> }
    paymentEvent: { create: ReturnType<typeof vi.fn> }
    order: { update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('confirmCardPayment — tutar bağlama', () => {
  it('tutar sipariş toplamından farklıysa reddeder ve kanıt eventi yazar', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p1', orderId: 'o1', status: 'pending' },
      order: { totalAmount: new Decimal('1499.90') },
    })
    const svc = createPaymentService({ prisma })

    await expect(
      svc.confirmCardPayment({
        orderId: 'o1',
        providerRef: 'iyzi-1',
        amount: new Decimal('1.00'),
      }),
    ).rejects.toThrow(ConflictError)

    expect(prisma.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'p1',
          eventType: 'amount_mismatch_rejected',
        }),
      }),
    )
    expect(prisma.order.update).not.toHaveBeenCalled()
  })

  it('ret mesajı idempotency yutma kalıbı "zaten işlendi" içermez', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p1', orderId: 'o1', status: 'pending' },
      order: { totalAmount: new Decimal('100.00') },
    })
    const svc = createPaymentService({ prisma })

    await expect(
      svc.confirmCardPayment({
        orderId: 'o1',
        providerRef: 'iyzi-1',
        amount: new Decimal('99.99'),
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('zaten işlendi'),
      }),
    )
  })

  it('tam tutar eşleşmesinde onaylar ve satıcı kuyruğuna alır', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p1', orderId: 'o1', status: 'pending' },
      order: { totalAmount: new Decimal('1499.90') },
    })
    const svc = createPaymentService({ prisma })

    await svc.confirmCardPayment({
      orderId: 'o1',
      providerRef: 'iyzi-1',
      amount: new Decimal('1499.90'),
    })

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'confirmed',
          providerPaymentId: 'iyzi-1',
        }),
      }),
    )
    const orderUpdates = prisma.order.update.mock.calls.map(
      (call: [{ data: { status?: string } }]) => call[0].data.status,
    )
    expect(orderUpdates).toContain('payment_confirmed')
    expect(orderUpdates).toContain('seller_queue_ready')
  })
})

describe('confirmCardPayment — providerRef tekrar kullanımı', () => {
  it('başka siparişte kullanılmış providerRef reddedilir', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p2', orderId: 'o2', status: 'pending' },
      order: { totalAmount: new Decimal('50.00') },
      paymentByProviderRef: { id: 'p1', orderId: 'o1' },
    })
    const svc = createPaymentService({ prisma })

    await expect(
      svc.confirmCardPayment({
        orderId: 'o2',
        providerRef: 'iyzi-1',
        amount: new Decimal('50.00'),
      }),
    ).rejects.toThrow(ConflictError)

    expect(prisma.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'p2',
          eventType: 'providerRef_reuse_rejected',
        }),
      }),
    )
    expect(prisma.order.update).not.toHaveBeenCalled()
  })

  it('aynı siparişin kendi providerRef kaydı reddedilmez', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p1', orderId: 'o1', status: 'pending' },
      order: { totalAmount: new Decimal('50.00') },
      paymentByProviderRef: { id: 'p1', orderId: 'o1' },
    })
    const svc = createPaymentService({ prisma })

    await expect(
      svc.confirmCardPayment({
        orderId: 'o1',
        providerRef: 'iyzi-1',
        amount: new Decimal('50.00'),
      }),
    ).resolves.toBeDefined()
  })

  it('unique kısıt yarışında P2002 ConflictError olarak çevrilir', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p2', orderId: 'o2', status: 'pending' },
      order: { totalAmount: new Decimal('50.00') },
    })
    prisma.payment.update.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )
    const svc = createPaymentService({ prisma })

    await expect(
      svc.confirmCardPayment({
        orderId: 'o2',
        providerRef: 'iyzi-1',
        amount: new Decimal('50.00'),
      }),
    ).rejects.toThrow(ConflictError)
  })
})

describe('confirmCardPayment — idempotency korunur', () => {
  it('zaten confirmed ödeme için sessizce geri döner, doğrulama eventi yazmaz', async () => {
    const prisma = buildPrismaMock({
      payment: { id: 'p1', orderId: 'o1', status: 'confirmed' },
      order: { totalAmount: new Decimal('1499.90') },
    })
    const svc = createPaymentService({ prisma })

    const result = await svc.confirmCardPayment({
      orderId: 'o1',
      providerRef: 'iyzi-1',
      amount: new Decimal('0.00'), // tutar bakılmadan idempotent dönüş
    })

    expect(result).toEqual(expect.objectContaining({ id: 'p1', status: 'confirmed' }))
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled()
    expect(prisma.order.update).not.toHaveBeenCalled()
  })
})
