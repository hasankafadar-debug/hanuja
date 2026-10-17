/**
 * POST /api/checkout/order sözleşmesi: Havale/EFT "Siparişi tamamla" isteği istemcinin ürettiği
 * bir anahtar taşır; aynı anahtarın tekrarı ilk siparişi 200 ile döndürür, yeni sipariş 201'dir.
 * Tek sipariş garantisinin kendisi gerçek PostgreSQL ile
 * tests/postgres/eft-checkout-idempotency.test.ts içinde test edilir.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createOrder: vi.fn() }))
vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('../../api/lib/legal-acceptance', () => ({
  buildLegalAcceptanceEvidence: async () => ({
    acceptedAt: new Date('2026-10-17T10:00:00Z'),
    ipAddress: '203.0.113.5',
    userAgent: 'vitest',
    sessionId: null,
  }),
}))
vi.mock('../../api/services/checkout.service', () => ({
  createCheckoutService: () => ({ createOrder: mocks.createOrder }),
}))

import { createOrder, createOrderSchema, type CreateOrderInput } from '../../api/routes/checkout'

/** Mirrors newEftOrderKey() in apps/web/src/app/(storefront)/odeme/client-page.tsx. */
const clientKey = () => `eft-${randomUUID()}`

const body = (overrides: Record<string, unknown> = {}) => ({
  addressId: 'address-1',
  paymentMethod: 'eft',
  turnstileToken: 'token',
  acceptedDistanceSales: true,
  acceptedPreInformation: true,
  idempotencyKey: clientKey(),
  ...overrides,
})

describe('EFT order request key', () => {
  it('accepts the key the checkout page generates', () => {
    expect(createOrderSchema.safeParse(body()).success).toBe(true)
  })

  it('is required: a request without a key is refused', () => {
    const { idempotencyKey: _key, ...withoutKey } = body()
    expect(createOrderSchema.safeParse(withoutKey).success).toBe(false)
  })

  it.each(['kisa', 'eft-<script>alert(1)</script>-xxxx', 'x'.repeat(81)])(
    'refuses a malformed key %j',
    (idempotencyKey) => {
      expect(createOrderSchema.safeParse(body({ idempotencyKey })).success).toBe(false)
    },
  )
})

describe('createOrder route', () => {
  beforeEach(() => mocks.createOrder.mockReset())

  const call = (input: CreateOrderInput) =>
    createOrder(
      new NextRequest('https://shop.example.test/api/checkout/order', { method: 'POST' }),
      'user-1',
      input,
    )

  it('passes the key to the service and answers a new order with 201', async () => {
    const input = createOrderSchema.parse(body())
    mocks.createOrder.mockResolvedValue({ order: { id: 'order-1' }, replayed: false })

    const response = await call(input)

    expect(response.status).toBe(201)
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', idempotencyKey: input.idempotencyKey }),
    )
  })

  it('answers a repeated request with the existing order and 200', async () => {
    const input = createOrderSchema.parse(body())
    mocks.createOrder.mockResolvedValue({ order: { id: 'order-1' }, replayed: true })

    const response = await call(input)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { order: { id: 'order-1' } } })
  })
})
