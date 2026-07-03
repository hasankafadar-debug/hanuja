/**
 * Security test — 3DS callback sipariş bağlama doğrulaması.
 *
 * Saldırı senaryosu: ucuz bir siparişin geçerli paymentId'si, pahalı bir
 * siparişin conversationId'siyle callback'e POST edilir. Iyzico'nun
 * complete3DS cevabındaki conversationId hedef siparişle eşleşmiyorsa
 * onay çağrısı yapılmamalıdır.
 *
 * See: docs/05-security/payment-security.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { complete3DSMock, confirmCardPaymentMock } = vi.hoisted(() => ({
  complete3DSMock: vi.fn(),
  confirmCardPaymentMock: vi.fn(),
}))

vi.mock('@hanuja/api/lib/iyzico', () => ({
  complete3DS: complete3DSMock,
}))
vi.mock('@hanuja/api/services/payment.service', () => ({
  createPaymentService: () => ({ confirmCardPayment: confirmCardPaymentMock }),
}))
vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: () => ({}),
}))

function buildCallbackRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString()
  return new Request('http://localhost:3000/api/payment/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

async function postCallback(fields: Record<string, string>) {
  const route = await import(
    '../../apps/web/src/app/api/payment/callback/route'
  )
  return route.POST(
    buildCallbackRequest(fields) as unknown as Parameters<typeof route.POST>[0],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmCardPaymentMock.mockResolvedValue({ id: 'p1', status: 'confirmed' })
})

describe('POST /api/payment/callback — sipariş bağlama', () => {
  it('conversationId eşleşmezse onay çağrılmaz ve hataya yönlendirir', async () => {
    complete3DSMock.mockResolvedValue({
      success: true,
      paymentId: 'iyzi-1',
      conversationId: 'ucuz-siparis', // saldırganın ödediği sipariş
      paidPrice: '1.00',
    })

    const response = await postCallback({
      paymentId: 'iyzi-1',
      conversationId: 'pahali-siparis', // hedef alınan sipariş
      mdStatus: '1',
    })

    expect(confirmCardPaymentMock).not.toHaveBeenCalled()
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/odeme')
    expect(location).toContain('hata=')
  })

  it('fraudStatus=-1 olan ödeme onaylanmaz', async () => {
    complete3DSMock.mockResolvedValue({
      success: true,
      paymentId: 'iyzi-2',
      conversationId: 'o1',
      paidPrice: '100.00',
      fraudStatus: -1,
    })

    const response = await postCallback({
      paymentId: 'iyzi-2',
      conversationId: 'o1',
      mdStatus: '1',
    })

    expect(confirmCardPaymentMock).not.toHaveBeenCalled()
    expect(response.headers.get('location') ?? '').toContain('hata=')
  })

  it('eşleşen conversationId ile onay paidPrice tutarıyla çağrılır', async () => {
    complete3DSMock.mockResolvedValue({
      success: true,
      paymentId: 'iyzi-3',
      conversationId: 'o1',
      paidPrice: '1499.90',
      fraudStatus: 1,
    })

    const response = await postCallback({
      paymentId: 'iyzi-3',
      conversationId: 'o1',
      mdStatus: '1',
    })

    expect(confirmCardPaymentMock).toHaveBeenCalledTimes(1)
    const call = confirmCardPaymentMock.mock.calls[0]?.[0] as {
      orderId: string
      providerRef: string
      amount: { toFixed(dp: number): string }
    }
    expect(call.orderId).toBe('o1')
    expect(call.providerRef).toBe('iyzi-3')
    expect(call.amount.toFixed(2)).toBe('1499.90')
    expect(response.headers.get('location') ?? '').toContain('/siparis/o1')
  })

  it('mdStatus=1 değilse Iyzico tamamlaması hiç çağrılmaz', async () => {
    const response = await postCallback({
      paymentId: 'iyzi-4',
      conversationId: 'o1',
      mdStatus: '0',
    })

    expect(complete3DSMock).not.toHaveBeenCalled()
    expect(confirmCardPaymentMock).not.toHaveBeenCalled()
    expect(response.headers.get('location') ?? '').toContain('hata=')
  })
})
