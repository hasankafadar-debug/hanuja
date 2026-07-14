/**
 * POST /api/payment/callback
 *
 * Iyzico 3D Secure doğrulaması tamamlandıktan sonra Iyzico'nun çağırdığı endpoint.
 *
 * Akış:
 *   1. Iyzico form-encoded POST → paymentId, conversationId, status
 *   2. complete3DS ile ödeme tamamlanır (Iyzico'ya ikinci istek)
 *   3. Başarılıysa: confirmCardPayment → sipariş satıcı kuyruğuna düşer
 *   4. Tarayıcı sipariş sayfasına yönlendirilir
 *
 * GÜVENLİK:
 *   - paymentId Iyzico'dan alınır, client'tan güvenilmez
 *   - confirmCardPayment idempotent: çift çağrı güvenli
 *
 * See: docs/05-security/payment-security.md, .claude/rules/07-marketplace-finance-rules.md
 */
import { NextRequest, NextResponse } from 'next/server'
import { complete3DS } from '@hanuja/api/lib/iyzico'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'
import { createPaymentService } from '@hanuja/api/services/payment.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { Decimal } from '@prisma/client/runtime/client'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('NEXT_PUBLIC_APP_URL is required in production') })()
    : 'http://localhost:3000')

function redirectToError(message: string): NextResponse {
  const url = new URL('/odeme', APP_URL)
  url.searchParams.set('hata', message)
  return NextResponse.redirect(url)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCardPaymentsEnabled()) {
    return NextResponse.json(
      { error: 'Kartla ödeme geçici olarak kullanılamıyor.', code: 'CARD_PAYMENTS_DISABLED' },
      { status: 503 },
    )
  }

  // Iyzico callback body: application/x-www-form-urlencoded
  let formData: URLSearchParams
  try {
    const text = await req.text()
    formData = new URLSearchParams(text)
  } catch {
    return redirectToError('Geçersiz callback verisi')
  }

  const paymentId = formData.get('paymentId')
  const conversationId = formData.get('conversationId') // order ID
  const mdStatus = formData.get('mdStatus') // 3DS doğrulama sonucu

  // mdStatus=1 → başarılı, diğerleri → başarısız/iptal
  if (!paymentId || !conversationId || mdStatus !== '1') {
    const errMsg = formData.get('mdErrorMsg') ?? '3DS doğrulaması başarısız'
    return redirectToError(errMsg)
  }

  // Iyzico ile ödeme tamamla
  const complete3DSResult = await complete3DS({ paymentId, conversationId })

  if (!complete3DSResult.success) {
    return redirectToError(complete3DSResult.errorMessage ?? 'Ödeme onaylanamadı')
  }

  // Iyzico'nun döndürdüğü conversationId hedef siparişle eşleşmeli —
  // başka bir siparişin paymentId'siyle replay girişimini engeller
  if (
    complete3DSResult.conversationId !== undefined &&
    complete3DSResult.conversationId !== conversationId
  ) {
    console.error(
      `[payment/callback] conversationId uyuşmazlığı: beklenen=${conversationId} gelen=${complete3DSResult.conversationId} paymentId=${paymentId}`,
    )
    return redirectToError('Ödeme doğrulanamadı')
  }

  // Iyzico fraud kontrolünden geçemeyen ödemeyi onaylama
  if (complete3DSResult.fraudStatus === -1) {
    console.error(
      `[payment/callback] fraudStatus=-1 reddedildi: orderId=${conversationId} paymentId=${paymentId}`,
    )
    return redirectToError('Ödeme güvenlik kontrolünden geçemedi')
  }

  // DB'de ödemi onayla + siparişi satıcı kuyruğuna al
  const prisma = createPrismaForRoute()
  const paymentSvc = createPaymentService({ prisma })

  try {
    await paymentSvc.confirmCardPayment({
      orderId: conversationId,
      providerRef: paymentId,
      amount: new Decimal(complete3DSResult.paidPrice ?? '0'),
    })
  } catch (err: unknown) {
    // Zaten confirm edilmişse (idempotency) devam et
    const msg = err instanceof Error ? err.message : ''
    if (!msg.includes('zaten işlendi')) {
      return redirectToError('Ödeme kaydedilemedi')
    }
  }

  // Başarı → sipariş sayfasına yönlendir
  return NextResponse.redirect(
    new URL(`/siparis/${conversationId}?yeni=1`, APP_URL),
  )
}
