/**
 * Kart ödemesi route işleyicileri (ince katman). İş mantığı card-payment.service'tedir.
 *
 * Yeni ödeme yalnız hosted CheckoutForm ile başlar. Eski kart başlangıç handler'ları
 * dışarı açık değildir; geçmiş callback ve mutabakat kodu korunur. Hata nesneleri loglanmaz.
 */
import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { DomainError } from '../lib/errors'
import { handleError, ok } from '../lib/response'
import { createPrismaForRoute } from '../lib/prisma'
import { buildLegalAcceptanceEvidence, extractTrustedClientIp } from '../lib/legal-acceptance'
import { isCardPaymentsEnabled } from '../lib/payment-capabilities'
import { verifyWebhookSignatureV3 } from '../lib/iyzico'
import { createCardPaymentService, type CallbackOutcome } from '../services/card-payment.service'
import { enqueueIyzicoWebhookEvent } from '../services/card-payment-queue'

function service() {
  return createCardPaymentService({ prisma: createPrismaForRoute() })
}

function privatePaymentResponse<T>(value: T) {
  const response = ok(value)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const startCheckoutFormSchema = z
  .object({
    previewId: z.string().min(1).max(100),
    startKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
    identityNumber: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
    turnstileToken: z.string().min(1),
    acceptedDistanceSales: z.literal(true),
    acceptedPreInformation: z.literal(true),
  })
  .strict()

export async function previewCheckoutForm(req: NextRequest, userId: string) {
  try {
    return privatePaymentResponse(
      await service().previewCheckoutForm({
        userId,
        ...(req.nextUrl.searchParams.get('orderId')
          ? { orderId: req.nextUrl.searchParams.get('orderId')! }
          : {}),
        ...(req.nextUrl.searchParams.get('addressId')
          ? { addressId: req.nextUrl.searchParams.get('addressId')! }
          : {}),
        ...(req.nextUrl.searchParams.get('billingAddressId')
          ? { billingAddressId: req.nextUrl.searchParams.get('billingAddressId')! }
          : {}),
      }),
    )
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function startCheckoutForm(
  req: NextRequest,
  userId: string,
  body: z.infer<typeof startCheckoutFormSchema>,
  callbackUrl: string,
) {
  try {
    const prisma = createPrismaForRoute()
    return privatePaymentResponse(
      await createCardPaymentService({ prisma }).startCheckoutForm({
        userId,
        previewId: body.previewId,
        startKey: body.startKey,
        ...(body.identityNumber ? { identityNumber: body.identityNumber } : {}),
        callbackUrl,
        buyerIp: extractTrustedClientIp(req) ?? '127.0.0.1',
        acceptance: await buildLegalAcceptanceEvidence({ prisma, req, userId }),
      }),
    )
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function reuseCheckoutForm(userId: string, previewId: string, startKey: string) {
  return service().reuseCheckoutForm(userId, previewId, startKey)
}

/** Token is only a lookup credential. Signed server results determine payment state. */
export async function handleCheckoutFormCallback(req: NextRequest, appUrl: string) {
  let path = '/odeme?hata=dogrulama'
  try {
    const token = new URLSearchParams(await req.text()).get('token')
    if (token && token.length <= 512) {
      const result = await service().handleCheckoutFormCallback(token)
      path = callbackRedirectPath(result.orderId, result.outcome)
    }
  } catch {
    /* Worker reconciles; never log callback tokens. */
  }
  const origin = new URL(appUrl).origin
  const nonce = crypto.randomUUID().replace(/-/g, '')
  return new NextResponse(
    `<!doctype html><html lang="tr"><meta charset="utf-8"><title>Ödeme durumu</title><body><p>Ödeme durumunuz kontrol ediliyor.</p><a href="${path.replace(/&/g, '&amp;')}" target="_top">Hanuja’ya dön</a><script nonce="${nonce}">if(window.parent!==window){window.parent.postMessage({type:'hanuja:checkout-form-result'},${JSON.stringify(origin)})}else{window.location.replace(${JSON.stringify(path)})}</script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors ${origin}; base-uri 'none'; form-action 'none'`,
      },
    },
  )
}

function cardsDisabled() {
  return NextResponse.json(
    {
      success: false,
      code: 'CARD_PAYMENTS_DISABLED',
      message: 'Kartla ödeme şu anda kullanılamıyor. Lütfen Havale / EFT seçeneğini kullanın.',
    },
    { status: 503 },
  )
}

/** Do not log request data, provider tokens, SDK errors or Prisma query arguments. */
export function handleCardPaymentError(error: unknown): NextResponse {
  if (error instanceof DomainError || error instanceof ZodError) return handleError(error)
  const name = error instanceof Error ? error.name : 'UnknownError'
  console.error('[card-payment] unexpected error', { name })
  return NextResponse.json(
    { success: false, code: 'INTERNAL_ERROR', message: 'Ödeme işlemi sırasında bir hata oluştu.' },
    { status: 500 },
  )
}

const quoteSchema = z
  .object({
    binNumber: z.string().regex(/^\d{8}$/, 'Kart numarasının ilk 8 hanesi gerekli'),
    installmentCount: z.number().int().min(1).max(36).default(1),
    addressId: z.string().min(1).optional(),
    billingAddressId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
  })
  .refine((data) => data.orderId || data.addressId, {
    message: 'Adres seçimi zorunludur',
    path: ['addressId'],
  })

export async function quoteCardPayment(req: NextRequest, userId: string) {
  if (!isCardPaymentsEnabled()) return cardsDisabled()
  try {
    const body = quoteSchema.parse(await req.json())
    const quote = await service().createQuote({
      userId,
      binNumber: body.binNumber,
      installmentCount: body.installmentCount,
      ...(body.orderId ? { orderId: body.orderId } : {}),
      ...(body.addressId ? { addressId: body.addressId } : {}),
      ...(body.billingAddressId ? { billingAddressId: body.billingAddressId } : {}),
    })
    return ok(quote)
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function previewCardQuoteContracts(userId: string, quoteId: string) {
  try {
    return ok(await service().previewQuoteDocuments(userId, quoteId))
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export const startCardPaymentSchema = z.object({
  quoteId: z.string().min(1),
  startKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/, 'Geçersiz ödeme isteği'),
  cardHolderName: z.string().trim().min(2, 'Kart üzerindeki ad zorunludur').max(80),
  cardNumber: z
    .string()
    .transform((value) => value.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{15,19}$/, 'Geçersiz kart numarası')),
  expireMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, 'Geçersiz ay'),
  expireYear: z.string().regex(/^\d{4}$/, 'Geçersiz yıl'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Geçersiz CVC'),
  identityNumber: z
    .string()
    .regex(/^\d{11}$/, 'TC kimlik numarası 11 haneli rakam olmalı')
    .optional(),
  turnstileToken: z.string().min(1, 'İnsan doğrulaması zorunludur'),
  acceptedDistanceSales: z.literal(true, {
    errorMap: () => ({ message: 'Mesafeli satış sözleşmesini kabul etmeniz zorunludur' }),
  }),
  acceptedPreInformation: z.literal(true, {
    errorMap: () => ({ message: 'Ön bilgilendirme formunu kabul etmeniz zorunludur' }),
  }),
})

export type StartCardPaymentInput = z.infer<typeof startCardPaymentSchema>

export async function startCardPayment(
  req: NextRequest,
  userId: string,
  body: StartCardPaymentInput,
  callbackUrl: string,
) {
  if (!isCardPaymentsEnabled()) return cardsDisabled()
  try {
    const prisma = createPrismaForRoute()
    const acceptance = await buildLegalAcceptanceEvidence({ prisma, req, userId })
    const result = await createCardPaymentService({ prisma }).startAttempt({
      userId,
      quoteId: body.quoteId,
      startKey: body.startKey,
      card: {
        cardHolderName: body.cardHolderName,
        cardNumber: body.cardNumber,
        expireMonth: body.expireMonth,
        expireYear: body.expireYear,
        cvc: body.cvc,
      },
      ...(body.identityNumber ? { identityNumber: body.identityNumber } : {}),
      acceptance,
      buyerIp: extractTrustedClientIp(req) ?? '127.0.0.1',
      callbackUrl,
    })
    if (result.kind === 'threeds') {
      return ok({ kind: 'threeds', orderId: result.orderId, html: result.html })
    }
    return ok({ kind: 'existing', orderId: result.orderId, status: result.status })
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function getCardAttemptState(userId: string, startKey: string) {
  try {
    const state = await service().getAttemptState(userId, startKey)
    if (!state) {
      return NextResponse.json({ success: false, code: 'NOT_FOUND' }, { status: 404 })
    }
    return privatePaymentResponse(state)
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

export async function getCardOrderPaymentState(userId: string, orderId: string) {
  try {
    const state = await service().getOrderPaymentState(userId, orderId)
    if (!state) {
      return NextResponse.json({ success: false, code: 'NOT_FOUND' }, { status: 404 })
    }
    return privatePaymentResponse(state)
  } catch (error) {
    return handleCardPaymentError(error)
  }
}

const CALLBACK_ERROR_CODES: Record<
  Exclude<CallbackOutcome, 'succeeded' | 'pending' | 'review'>,
  string
> = {
  failed: 'reddedildi',
  expired: 'sure',
  invalid: 'dogrulama',
}

/** Callback sonrası yönlendirme. 303: tarayıcı GET ile gelir, SameSite=Lax oturum çerezi gönderilir. */
export function callbackRedirectPath(orderId: string | null, outcome: CallbackOutcome | 'error') {
  if (orderId && outcome === 'succeeded') return `/siparis/${orderId}?yeni=1`
  if (orderId && (outcome === 'pending' || outcome === 'review')) {
    return `/siparis/${orderId}?odeme=kontrol`
  }
  const code =
    outcome === 'error'
      ? 'sistem'
      : CALLBACK_ERROR_CODES[outcome as keyof typeof CALLBACK_ERROR_CODES]
  return orderId
    ? `/odeme?siparis=${encodeURIComponent(orderId)}&hata=${code}`
    : `/odeme?hata=${code}`
}

/** iyzico 3DS callback (form POST). Bayrak kapalıyken de çalışır: başlamış ödemeler tamamlanmalı. */
export async function handleCardCallback(req: NextRequest, appUrl: string) {
  let orderId: string | null = null
  let outcome: CallbackOutcome | 'error' = 'invalid'
  try {
    const form = new URLSearchParams(await req.text())
    const field = (name: string) => {
      const value = form.get(name)
      return value === null || value === '' ? null : value
    }
    const result = await service().handleCallback({
      status: field('status'),
      paymentId: field('paymentId'),
      conversationId: field('conversationId'),
      conversationData: field('conversationData'),
      mdStatus: field('mdStatus'),
      signature: field('signature'),
    })
    orderId = result.orderId
    outcome = result.outcome
  } catch (error) {
    handleCardPaymentError(error)
    outcome = 'error'
  }
  return NextResponse.redirect(new URL(callbackRedirectPath(orderId, outcome), appUrl), 303)
}

/**
 * iyzico webhook (X-IYZ-SIGNATURE-V3). Önce kalıcı kayıt, sonra 2xx; kayıt yazılamazsa 5xx
 * (iyzico tekrar gönderir). Aynı iyziReferenceCode tekrar gelirse 2xx. Bayrak kapalıyken de çalışır.
 */
export async function handleIyzicoWebhook(req: NextRequest) {
  const rawBody = await req.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON' }, { status: 400 })
  }

  if (!verifyWebhookSignatureV3(req.headers.get('x-iyz-signature-v3'), payload)) {
    return NextResponse.json({ error: 'Geçersiz imza' }, { status: 401 })
  }

  const referenceCode = payload.iyziReferenceCode
  if (typeof referenceCode !== 'string' || referenceCode.length === 0) {
    return NextResponse.json({ error: 'Eksik alan' }, { status: 400 })
  }
  const text = (value: unknown) =>
    value === null || value === undefined || value === '' ? null : String(value)

  const prisma = createPrismaForRoute()
  let eventId: string
  try {
    const event = await prisma.iyzicoWebhookEvent.create({
      data: {
        iyziReferenceCode: referenceCode,
        iyziEventType: text(payload.iyziEventType) ?? 'UNKNOWN',
        paymentId: text(
          payload.iyziEventType === 'CHECKOUT_FORM_AUTH'
            ? payload.iyziPaymentId
            : payload.paymentId,
        ),
        checkoutFormToken: text(payload.token),
        paymentConversationId: text(payload.paymentConversationId),
        status: text(payload.status),
        payload: payload as object,
      },
    })
    eventId = event.id
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[iyzico-webhook] bildirim kaydedilemedi', {
      name: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ error: 'Geçici hata' }, { status: 503 })
  }

  await enqueueIyzicoWebhookEvent(eventId).catch((error) =>
    console.error('[iyzico-webhook] kuyruğa eklenemedi; bakım işi tarayacak', {
      eventId,
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    }),
  )
  return NextResponse.json({ received: true })
}
