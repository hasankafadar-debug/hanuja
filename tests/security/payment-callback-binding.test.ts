/**
 * Security test — 3DS callback route'u.
 *
 * Route callback alanlarını olduğu gibi servise iletir; başarıya yalnız servis karar verir
 * (deneme conversationId ile bulunur, paymentId başlatmadaki kayıtla eşleşmeli, imzalı v2 auth).
 * Yönlendirmeler 303'tür ve hata metni URL'de taşınmaz, yalnız kod taşınır.
 *
 * Servis düzeyindeki bağlama kuralları: tests/postgres/card-payment-flow.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleCallbackMock } = vi.hoisted(() => ({ handleCallbackMock: vi.fn() }))

vi.mock('@hanuja/api/services/card-payment.service', () => ({
  createCardPaymentService: () => ({ handleCallback: handleCallbackMock }),
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/card-payment-queue', () => ({ enqueueIyzicoWebhookEvent: vi.fn() }))

async function postCallback(body: string) {
  const route = await import('../../apps/web/src/app/api/payment/callback/route')
  const request = new Request('http://localhost:3000/api/payment/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return route.POST(request as unknown as Parameters<typeof route.POST>[0])
}

function location(response: Response) {
  const value = response.headers.get('location')
  return value ? new URL(value).pathname + new URL(value).search : null
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/payment/callback', () => {
  it('iyzico alanlarını servise iletir; değeri olmayan alan null olur', async () => {
    handleCallbackMock.mockResolvedValue({ orderId: 'o1', outcome: 'succeeded' })
    await postCallback(
      new URLSearchParams({
        status: 'success',
        paymentId: '22416035',
        conversationId: 'hnj-1',
        mdStatus: '1',
        conversationData: '',
        signature: 'abc',
      }).toString(),
    )
    expect(handleCallbackMock).toHaveBeenCalledWith({
      status: 'success',
      paymentId: '22416035',
      conversationId: 'hnj-1',
      conversationData: null,
      mdStatus: '1',
      signature: 'abc',
    })
  })

  it.each([
    ['succeeded', '/siparis/o1?yeni=1'],
    ['pending', '/siparis/o1?odeme=kontrol'],
    ['review', '/siparis/o1?odeme=kontrol'],
    ['failed', '/odeme?siparis=o1&hata=reddedildi'],
    ['expired', '/odeme?siparis=o1&hata=sure'],
    ['invalid', '/odeme?siparis=o1&hata=dogrulama'],
  ])('%s sonucunda 303 ile %s adresine yönlendirir', async (outcome, expected) => {
    handleCallbackMock.mockResolvedValue({ orderId: 'o1', outcome })
    const response = await postCallback('conversationId=hnj-1')
    expect(response.status).toBe(303)
    expect(location(response)).toBe(expected)
  })

  it('deneme bulunamazsa sipariş bilgisi olmadan doğrulama hatasına yönlendirir', async () => {
    handleCallbackMock.mockResolvedValue({ orderId: null, outcome: 'invalid' })
    const response = await postCallback('conversationId=unknown')
    expect(location(response)).toBe('/odeme?hata=dogrulama')
  })

  it('beklenmeyen hata başarı sayfasına götürmez ve kart verisi loglanmaz', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    handleCallbackMock.mockRejectedValue(new Error('db down 4111111111111111'))
    const response = await postCallback('conversationId=hnj-1')
    expect(location(response)).toBe('/odeme?hata=sistem')
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('4111111111111111')
    errorSpy.mockRestore()
  })
})
