/**
 * POST /api/webhooks/iyzico
 *
 * Iyzico'nun genel webhook endpoint'i.
 * 3DS callback'ten farklı: ödeme durum bildirimleri, iade sonuçları vb.
 *
 * Güvenlik:
 *   - X-IYZ-SIGNATURE header'ı HMAC-SHA1 ile doğrulanır
 *   - Raw body imzalamada kullanılır (parsed değil)
 *   - İdempotency: aynı providerRef ikinci kez gelirse atlanan
 *
 * Desteklenen event'ler:
 *   - PAYMENT.SUCCESS → ödeme onayı (3DS callback'tan gelmeyenler için)
 *   - PAYMENT.FAILURE → ödeme başarısız
 *   - REFUND.SUCCESS  → iade başarısı (kayıt güncelleme)
 *
 * See: docs/05-security/payment-security.md
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@hanuja/api/lib/iyzico'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'
import { createPaymentService } from '@hanuja/api/services/payment.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { Decimal } from '@prisma/client/runtime/client'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCardPaymentsEnabled()) {
    return NextResponse.json(
      { error: 'Kartla ödeme geçici olarak kullanılamıyor.', code: 'CARD_PAYMENTS_DISABLED' },
      { status: 503 },
    )
  }

  // Raw body'yi önce oku — imza doğrulaması raw text üzerinden yapılır
  const rawBody = await req.text()
  const signature = req.headers.get('x-iyz-signature') ?? ''

  if (!verifyWebhookSignature(signature, rawBody)) {
    return NextResponse.json({ error: 'Geçersiz imza' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON' }, { status: 400 })
  }

  const eventType = payload.eventType as string | undefined
  const prisma = createPrismaForRoute()
  const paymentSvc = createPaymentService({ prisma })

  try {
    switch (eventType) {
      case 'PAYMENT.SUCCESS': {
        const orderId = payload.conversationId as string
        const providerRef = payload.paymentId as string
        const paidPrice = payload.paidPrice as string | undefined

        if (!orderId || !providerRef) {
          return NextResponse.json({ error: 'Eksik alan' }, { status: 400 })
        }

        await paymentSvc.confirmCardPayment({
          orderId,
          providerRef,
          amount: new Decimal(paidPrice ?? '0'),
        })

        break
      }

      case 'PAYMENT.FAILURE': {
        const orderId = payload.conversationId as string
        if (!orderId) break

        const payment = await prisma.payment.findFirst({ where: { orderId } })
        if (payment && payment.status === 'pending') {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'failed' },
          })
          await prisma.order.update({
            where: { id: orderId },
            data: { status: 'cancelled_due_to_payment_failure' },
          })
          await prisma.orderStatusHistory.create({
            data: {
              orderId,
              toStatus: 'cancelled_due_to_payment_failure',
              actorId: 'system',
              reason: `Iyzico webhook: PAYMENT.FAILURE — ${payload.errorMessage ?? ''}`,
            },
          })
        }
        break
      }

      case 'REFUND.SUCCESS': {
        // İade başarıyla tamamlandı — log event ekle
        const orderId = payload.conversationId as string
        const providerRef = payload.paymentId as string
        if (orderId && providerRef) {
          const payment = await prisma.payment.findFirst({ where: { orderId } })
          if (payment) {
            await prisma.paymentEvent.create({
              data: {
                paymentId: payment.id,
                eventType: 'refund_confirmed_by_provider',
                payload: {
                  ...payload,
                  note: `Iyzico REFUND.SUCCESS — ref: ${providerRef}`,
                },
              },
            })
          }
        }
        break
      }

      default:
        // Bilinmeyen event — 200 döndür, geçip git
        break
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Bilinmeyen hata'
    // Idempotency hatalarını bastır (zaten işlendi)
    if (msg.includes('zaten işlendi')) {
      return NextResponse.json({ received: true })
    }
    console.error('[webhooks/iyzico] İşleme hatası:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
