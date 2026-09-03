import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { initiate3DS } from '@hanuja/api/lib/iyzico'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'
import { buildLegalAcceptanceEvidence, extractClientIp } from '@hanuja/api/lib/legal-acceptance'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { verifyTurnstileToken } from '@hanuja/api/lib/turnstile'
import { createCheckoutService } from '@hanuja/api/services/checkout.service'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('NEXT_PUBLIC_APP_URL is required in production')
      })()
    : 'http://localhost:3000')

const startPaymentSchema = z.object({
  addressId: z.string().min(1, 'Adres seçimi zorunludur'),
  billingAddressId: z.string().min(1).optional(),
  couponCode: z.string().optional(),
  notes: z.string().max(500).optional(),
  cardHolderName: z.string().min(2, 'Kart üzerindeki ad zorunludur'),
  cardNumber: z.string().regex(/^\d{15,19}$/, 'Geçersiz kart numarası'),
  expireMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, 'Geçersiz ay'),
  expireYear: z.string().regex(/^\d{4}$/, 'Geçersiz yıl'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Geçersiz CVC'),
  identityNumber: z
    .string()
    .regex(/^\d{11}$/, 'TC kimlik numarası 11 haneli rakam olmalı'),
  turnstileToken: z.string().min(1, 'İnsan doğrulaması zorunludur'),
  acceptedDistanceSales: z.literal(true, {
    errorMap: () => ({ message: 'Mesafeli satış sözleşmesini kabul etmeniz zorunludur' }),
  }),
  acceptedPreInformation: z.literal(true, {
    errorMap: () => ({ message: 'Ön bilgilendirme formunu kabul etmeniz zorunludur' }),
  }),
})

function buildErrorHtml(message: string, orderId?: string): string {
  const backUrl = orderId ? `/siparis/${orderId}` : '/odeme'

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ödeme Hatası - Hanuja</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9f9f9; }
    .card { background: #fff; border-radius: 12px; padding: 2rem 2.5rem; max-width: 420px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
    h2 { color: #c0392b; margin-bottom: 1rem; }
    p { color: #555; margin-bottom: 1.5rem; line-height: 1.5; }
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
  if (!isCardPaymentsEnabled()) {
    return NextResponse.json(
      {
        error: 'Kartla ödeme geçici olarak kullanılamıyor. Lütfen Havale / EFT seçeneğini kullanın.',
        code: 'CARD_PAYMENTS_DISABLED',
      },
      { status: 503 },
    )
  }

  const csrfError = checkCsrf(req)
  if (csrfError) {
    return csrfError as NextResponse
  }

  const rl = await checkRateLimit(req, 'payment:start', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) {
    return rl.response! as NextResponse
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(new URL('/giris?redirect=/odeme', req.url))
  }

  const user = session.user

  if (!user.emailVerified) {
    return htmlResponse(
      buildErrorHtml('Sipariş oluşturmadan önce e-posta adresinizi doğrulamanız gerekir.'),
      403,
    )
  }

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

  const turnstileResult = await verifyTurnstileToken({
    token: body.turnstileToken,
    ip: extractClientIp(req),
    action: 'checkout-submit',
  })

  if (!turnstileResult.success) {
    return htmlResponse(
      buildErrorHtml(turnstileResult.message ?? 'İnsan doğrulaması tamamlanamadı.'),
      400,
    )
  }

  const prisma = createPrismaForRoute()
  const checkoutSvc = createCheckoutService({ prisma })

  let orderId: string
  let totalAmount: string

  try {
    const legalAcceptance = await buildLegalAcceptanceEvidence({
      prisma,
      req,
      userId: user.id,
    })

    const { order } = await checkoutSvc.createOrder({
      userId: user.id,
      addressId: body.addressId,
      ...(body.billingAddressId ? { billingAddressId: body.billingAddressId } : {}),
      paymentMethod: 'card',
      ...(body.couponCode ? { couponCode: body.couponCode } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      legalAcceptance,
    })

    orderId = order.id
    totalAmount = order.totalAmount.toFixed(2)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Siparis olusturulamadi'
    return htmlResponse(buildErrorHtml(message), 422)
  }

  const orderDetail = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { product: { include: { category: true } } } },
      address: true,
      customer: true,
    },
  })

  if (!orderDetail || !orderDetail.address) {
    return htmlResponse(buildErrorHtml('Sipariş veya adres bulunamadı.'), 500)
  }

  const addr = orderDetail.address
  const customer = orderDetail.customer
  const [firstName, ...rest] = (customer.name ?? 'Musteri').split(' ')
  const lastName = rest.join(' ') || 'Kullanici'
  const email = customer.email ?? user.email ?? 'musteri@example.com'

  const basketItems = [
    ...orderDetail.lines.map((line) => ({
      id: `line:${line.id}`,
      name: line.productName.slice(0, 100),
      category1: (line.product as { category?: { name?: string } } | null)?.category?.name ?? 'Diger',
      itemType: 'PHYSICAL' as const,
      price: (line.customerPaidProductAmount ?? line.totalPrice).toFixed(2),
    })),
    ...(orderDetail.shippingAmount.gt(0)
      ? [{
          id: `shipping:${orderDetail.id}`,
          name: 'Kargo',
          category1: 'Kargo',
          itemType: 'VIRTUAL' as const,
          price: orderDetail.shippingAmount.toFixed(2),
        }]
      : []),
  ]

  const addrLine2Part = addr.addressLine2 ? `, ${addr.addressLine2}` : ''
  const buyerAddress = `${addr.addressLine1}${addrLine2Part}, ${addr.district}, ${addr.city}`

  const iyzico3DSResult = await initiate3DS({
    conversationId: orderId,
    price: totalAmount,
    paidPrice: totalAmount,
    callbackUrl: `${APP_URL}/api/payment/callback`,
    buyer: {
      id: user.id,
      name: firstName ?? 'Musteri',
      surname: lastName,
      email,
      identityNumber: body.identityNumber,
      registrationAddress: buyerAddress,
      city: addr.city,
      country: 'Turkey',
      ip: extractClientIp(req) ?? '127.0.0.1',
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
    return htmlResponse(
      buildErrorHtml(iyzico3DSResult.errorMessage ?? 'Ödeme başlatılamadı.', orderId),
      502,
    )
  }

  return htmlResponse(iyzico3DSResult.htmlContent)
}
