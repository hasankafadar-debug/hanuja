/**
 * Iyzico Payment Adapter
 *
 * Tüm Iyzico API çağrıları bu modül üzerinden yapılır.
 * Doğrudan route handler veya UI'dan çağrılmamalı — yalnızca service katmanından.
 *
 * 3DS Akışı:
 *   1. initiate3DS → Iyzico 3DS HTML içeriği döner (base64)
 *   2. Kullanıcı banka 3DS sayfasını görür
 *   3. Iyzico callback URL'imize POST eder
 *   4. complete3DS → ödeme tamamlanır
 *
 * Ortam değişkenleri:
 *   IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL, IYZICO_WEBHOOK_SECRET
 *
 * See: docs/05-security/payment-security.md
 */
import crypto from 'node:crypto'

// iyzipay is a CommonJS package with no official TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Iyzipay = require('iyzipay') as new (opts: {
  apiKey: string
  secretKey: string
  uri: string
}) => IyzipayInstance

// ─── Internal types for the iyzipay SDK ─────────────────────────────────────

interface IyzipayResource {
  create(request: object, callback: (err: Error | null, result: IyzicoRawResult) => void): void
}

interface IyzipayInstance {
  threeDSInitialize: IyzipayResource
  threeDSPayment: IyzipayResource
  refund: IyzipayResource
}

interface IyzicoRawResult {
  status: string
  locale?: string
  systemTime?: number
  conversationId?: string
  threeDSHtmlContent?: string
  paymentId?: string
  fraudStatus?: number
  price?: string
  paidPrice?: string
  currency?: string
  errorCode?: string
  errorMessage?: string
  errorGroup?: string
  paymentTransactionId?: string
}

// ─── Public API types ────────────────────────────────────────────────────────

export interface IyzicoBuyer {
  id: string
  name: string
  surname: string
  email: string
  /** TC kimlik veya benzeri — sandbox'ta 11 haneli gerekli */
  identityNumber: string
  registrationAddress: string
  city: string
  country: string
  ip: string
  gsmNumber?: string
}

export interface IyzicoAddress {
  contactName: string
  city: string
  country: string
  address: string
  zipCode?: string
}

export interface IyzicoBasketItem {
  id: string
  name: string
  category1: string
  itemType: 'PHYSICAL' | 'VIRTUAL'
  price: string
}

export interface IyzicoCard {
  cardHolderName: string
  cardNumber: string
  expireMonth: string
  expireYear: string
  cvc: string
}

export interface Initiate3DSParams {
  conversationId: string
  price: string
  paidPrice: string
  currency?: string
  installment?: number
  callbackUrl: string
  buyer: IyzicoBuyer
  shippingAddress: IyzicoAddress
  billingAddress: IyzicoAddress
  basketItems: IyzicoBasketItem[]
  paymentCard: IyzicoCard
}

export interface Initiate3DSResult {
  success: boolean
  htmlContent?: string
  errorCode?: string
  errorMessage?: string
}

export interface Complete3DSParams {
  paymentId: string
  conversationId: string
}

export interface Complete3DSResult {
  success: boolean
  paymentId?: string
  conversationId?: string
  price?: string
  paidPrice?: string
  fraudStatus?: number
  errorCode?: string
  errorMessage?: string
}

export interface IyzicoRefundParams {
  paymentTransactionId: string
  price: string
  currency?: string
  conversationId: string
  ip: string
}

export interface IyzicoRefundResult {
  success: boolean
  paymentTransactionId?: string
  errorCode?: string
  errorMessage?: string
}

// ─── Client factory ───────────────────────────────────────────────────────────

function createClient(): IyzipayInstance {
  if (!process.env.IYZICO_API_KEY || !process.env.IYZICO_SECRET_KEY) {
    throw new Error('IYZICO_API_KEY veya IYZICO_SECRET_KEY tanımlı değil')
  }
  return new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_BASE_URL ?? 'https://sandbox-api.iyzipay.com',
  })
}

/** Callback-tabanlı iyzipay metodunu Promise'e çevirir */
function promisifyCreate(
  resource: IyzipayResource,
  request: object,
): Promise<IyzicoRawResult> {
  return new Promise((resolve, reject) => {
    resource.create(request, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Iyzico 3D Secure ödemeyi başlatır.
 * Başarılıysa kullanıcıya gösterilecek HTML içeriğini (decoded) döner.
 * threeDSHtmlContent Iyzico tarafından base64 olarak gönderilir.
 */
export async function initiate3DS(params: Initiate3DSParams): Promise<Initiate3DSResult> {
  const client = createClient()
  const result = await promisifyCreate(client.threeDSInitialize, {
    locale: 'tr',
    conversationId: params.conversationId,
    price: params.price,
    paidPrice: params.paidPrice,
    currency: params.currency ?? 'TRY',
    installment: params.installment ?? 1,
    paymentChannel: 'WEB',
    paymentGroup: 'PRODUCT',
    callbackUrl: params.callbackUrl,
    buyer: params.buyer,
    shippingAddress: params.shippingAddress,
    billingAddress: params.billingAddress,
    basketItems: params.basketItems,
    paymentCard: {
      ...params.paymentCard,
      registerCard: '0',
    },
  })

  if (result.status !== 'success' || !result.threeDSHtmlContent) {
    return {
      success: false,
      ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
      errorMessage: result.errorMessage ?? 'Ödeme başlatılamadı',
    }
  }

  // Iyzico HTML içeriğini base64 olarak döner — decode et
  const htmlContent = Buffer.from(result.threeDSHtmlContent, 'base64').toString('utf-8')

  return { success: true, htmlContent }
}

/**
 * 3DS doğrulaması tamamlandıktan sonra ödemeyi confirm eder.
 * Iyzico'nun callback POST'unda aldığımız paymentId ile çağrılır.
 */
export async function complete3DS(params: Complete3DSParams): Promise<Complete3DSResult> {
  const client = createClient()
  const result = await promisifyCreate(client.threeDSPayment, {
    locale: 'tr',
    conversationId: params.conversationId,
    paymentId: params.paymentId,
  })

  if (result.status !== 'success') {
    return {
      success: false,
      ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
      errorMessage: result.errorMessage ?? '3DS onayı başarısız',
    }
  }

  return {
    success: true,
    ...(result.paymentId !== undefined ? { paymentId: result.paymentId } : {}),
    ...(result.conversationId !== undefined ? { conversationId: result.conversationId } : {}),
    ...(result.price !== undefined ? { price: result.price } : {}),
    ...(result.paidPrice !== undefined ? { paidPrice: result.paidPrice } : {}),
    ...(result.fraudStatus !== undefined ? { fraudStatus: result.fraudStatus } : {}),
  }
}

/**
 * Iyzico üzerinden iade (refund) işlemi başlatır.
 * Return service'in markItemReceived → refundPayment akışında çağrılır.
 */
export async function refundPayment(params: IyzicoRefundParams): Promise<IyzicoRefundResult> {
  const client = createClient()
  const result = await promisifyCreate(client.refund, {
    locale: 'tr',
    conversationId: params.conversationId,
    paymentTransactionId: params.paymentTransactionId,
    price: params.price,
    currency: params.currency ?? 'TRY',
    ip: params.ip,
  })

  if (result.status !== 'success') {
    return {
      success: false,
      ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
      errorMessage: result.errorMessage ?? 'İade başarısız',
    }
  }

  return {
    success: true,
    ...(result.paymentTransactionId !== undefined
      ? { paymentTransactionId: result.paymentTransactionId }
      : {}),
  }
}

/**
 * Iyzico webhook imzasını doğrular.
 * Header: X-IYZ-SIGNATURE (HMAC-SHA1 base64)
 *
 * Ortam: IYZICO_WEBHOOK_SECRET tanımlı olmalı.
 */
export function verifyWebhookSignature(
  iyzicoSignature: string,
  rawBody: string,
): boolean {
  const secret = process.env.IYZICO_WEBHOOK_SECRET
  if (!secret) {
    // Sandbox'ta webhook secret olmayabilir — geliştirme modunda geç
    if (process.env.NODE_ENV !== 'production') return true
    return false
  }
  const expected = crypto
    .createHmac('sha1', secret)
    .update(rawBody, 'utf-8')
    .digest('base64')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(iyzicoSignature))
}
