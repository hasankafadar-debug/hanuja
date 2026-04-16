/**
 * POST /api/payment/start
 *
 * Kart ödemesi akışını başlatır:
 *   1. Sipariş oluşturur (checkout.service)
 *   2. Iyzico 3DS initialize çağrısı yapar
 *   3. 3DS HTML sayfasını text/html olarak döner — tarayıcı bu sayfayı görüntüler
 *
 * EFT için bu endpoint kullanılmaz; EFT akışı /api/checkout/order üzerindendir.
 *
 * GÜVENLİK:
 *   - Session zorunlu (401 → giriş sayfasına)
 *   - Kart verileri sunucuya gelir, DB'ye kaydedilmez
 *   - Tutar sunucu tarafında hesaplanır (client'tan gelen değer kullanılmaz)
 *   - Rate limiting: SENSITIVE_RATE_LIMIT
 *
 * See: docs/05-security/payment-security.md
 */
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createCheckoutService } from '@hanuja/api/services/checkout.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { initiate3DS } from '@hanuja/api/lib/iyzico'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const startPaymentSchema = z.object({
  addressId: z.string().min(1, 'Adres seçimi zorunludur'),
  couponCode: z.string().optional(),
  notes: z.string().max(500).optional(),
  cardHolderName: z.string().min(2, 'Kart üzerindeki ad zorunludur'),
  cardNumber: z
    .string()
    .regex(/^\d{15,19}$/, 'Geçersiz kart numarası'),
  expireMonth: z
    .string()
    .regex(/^(0[1-9]|1[0-2])$/, 'Geçersiz ay'),
  expireYear: z
    .string()
    .regex(/^\d{4}$/, 'Geçersiz yıl'),
  cvc: z
    .string()
    .regex(/^\d{3,4}$/, 'Geçersiz CVC'),
})

function buildErrorHtml(message: string, orderId?: string): string {
  const backUrl = orderId ? `/siparis/${orderId}` : '/odeme'
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ödeme Hatası — Hanuja</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9f9f9; }
    .card { background: #fff; border-radius: 12px; padding: 2rem 2.5rem; max-width: 400px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
    h2 { color: #c0392b; margin-bottom: 1rem; }
    p { color: #555; margin-bottom: 1.5rem; }
    a { display: inline-block; padding: .6rem 1.5rem; background: #2c3e50; color: #fff; border-radius: 8px; text-decoration: none; font-size: .9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Ödeme Başlatılamadı</h2>
    <p>${message}</p>
    <a href="${backUrl}">Geri Dön</a>
  </div>
</body>
</html>`
}

function htmlResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError as NextResponse

  const rl = checkRateLimit(req, 'payment:start', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response! as NextResponse

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(new URL('/giris?redirect=/odeme', req.url))
  }

  const user = session.user

  // Parse + validate — form submit (x-www-form-urlencoded) veya JSON kabul edilir
  let body: z.infer<typeof startPaymentSchema>
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let raw: Record<string, unknown>
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      const params = new URLSearchParams(text)
      raw = Object.fromEntries(params.entries())
    } else {
      raw = await req.json()
    }
    body = startPaymentSchema.parse(raw)
  } catch {
    return htmlResponse(buildErrorHtml('Ödeme formu eksik veya hatalı.'), 400)
  }

  const prisma = createPrismaForRoute()
  const checkoutSvc = createCheckoutService({ prisma })

  let orderId: string
  let totalAmount: string

  try {
    // 1. Sipariş oluştur
    const { order } = await checkoutSvc.createOrder({
      userId: user.id,
      addressId: body.addressId,
      paymentMethod: 'card',
      ...(body.couponCode ? { couponCode: body.couponCode } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    })
    orderId = order.id
    totalAmount = order.totalAmount.toFixed(2)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sipariş oluşturulamadı'
    return htmlResponse(buildErrorHtml(msg), 422)
  }

  // 2. Iyzico 3DS başlat
  // Adres, alıcı ve sepet bilgilerini DB'den çek
  const orderDetail = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { product: { include: { category: true } } } },
      address: true,
      customer: true,
    },
  })

  if (!orderDetail || !orderDetail.address) {
    return htmlResponse(buildErrorHtml('Sipariş veya adres bulunamadı'), 500)
  }

  const addr = orderDetail.address
  const customer = orderDetail.customer

  const [firstName, ...rest] = (customer.name ?? 'Müşteri').split(' ')
  const lastName = rest.join(' ') || 'Kullanıcı'
  const email = customer.email ?? user.email ?? 'musteri@example.com'

  const basketItems = orderDetail.lines.map((line) => ({
    id: line.productId,
    name: line.productName.slice(0, 100),
    category1: (line.product as { category?: { name?: string } } | null)?.category?.name ?? 'Diğer',
    itemType: 'PHYSICAL' as const,
    price: line.totalPrice.toFixed(2),
  }))

  const addrLine2Part = addr.addressLine2 ? `, ${addr.addressLine2}` : ''
  const buyerAddress = `${addr.addressLine1}${addrLine2Part}, ${addr.district}, ${addr.city}`

  const iyzico3DSResult = await initiate3DS({
    conversationId: orderId,
    price: totalAmount,
    paidPrice: totalAmount,
    callbackUrl: `${APP_URL}/api/payment/callback`,
    buyer: {
      id: user.id,
      name: firstName ?? 'Müşteri',
      surname: lastName,
      email,
      identityNumber: '11111111111', // Sandbox için placeholder; prod'da gerçek TC alınmalı
      registrationAddress: buyerAddress,
      city: addr.city,
      country: 'Turkey',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    },
    shippingAddress: {
      contactName: addr.fullName,
      city: addr.city,
      country: 'Turkey',
      address: buyerAddress,
      ...(addr.postalCode ? { zipCode: addr.postalCode } : {}),
    },
    billingAddress: {
      contactName: addr.fullName,
      city: addr.city,
      country: 'Turkey',
      address: buyerAddress,
      ...(addr.postalCode ? { zipCode: addr.postalCode } : {}),
    },
    basketItems,
    paymentCard: {
      cardHolderName: body.cardHolderName,
      cardNumber: body.cardNumber.replace(/\s/g, ''),
      expireMonth: body.expireMonth,
      expireYear: body.expireYear,
      cvc: body.cvc,
    },
  })

  if (!iyzico3DSResult.success || !iyzico3DSResult.htmlContent) {
    const errMsg = iyzico3DSResult.errorMessage ?? 'Ödeme başlatılamadı'
    return htmlResponse(buildErrorHtml(errMsg, orderId), 502)
  }

  // 3. 3DS HTML'ini döndür — tarayıcı bu içeriği görüntüler
  return htmlResponse(iyzico3DSResult.htmlContent)
}
