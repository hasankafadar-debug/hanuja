/**
 * Iyzico Payment Adapter — standart sanal POS, 3D Secure, taksit.
 *
 * Tüm Iyzico API çağrıları bu modül üzerinden yapılır; yalnızca service katmanından çağrılır.
 *
 * 3DS akışı (para yalnız auth adımında çekilir):
 *   1. getInstallmentOptions → BIN + tutar için taksit seçenekleri (vade farkı dahil toplamlar)
 *   2. initiate3DS → Iyzico paymentId + 3DS HTML (imzası doğrulanır)
 *   3. Banka doğrulaması → Iyzico callback URL'imize POST eder
 *   4. complete3DS (v2 auth) → paidPrice/basketId/currency bağlı tahsilat (imzası doğrulanır)
 *
 * Sonuç üç türlüdür: success, failure (Iyzico açıkça reddetti) ve unknown (ağ hatası, zaman
 * aşımı veya imzası doğrulanamayan yanıt). "unknown" hiçbir zaman "işlem gerçekleşmedi" sayılmaz.
 *
 * Ortam değişkenleri: IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL
 * See: docs/05-security/payment-security.md
 */
import crypto from 'node:crypto'

type IyzipayConstructor = new (opts: {
  apiKey: string
  secretKey: string
  uri: string
}) => IyzipayInstance

// iyzipay is CommonJS and triggers webpack warnings when statically analyzed.
// Load it lazily only when a payment/refund action actually runs.
function loadIyzipay(): IyzipayConstructor {
  // eslint-disable-next-line no-eval
  const runtimeRequire = eval('require') as NodeRequire
  return runtimeRequire('iyzipay') as IyzipayConstructor
}

// ─── Internal types for the iyzipay SDK ─────────────────────────────────────

type IyzipayCallback = (err: Error | null, result: IyzicoRawResult) => void

interface IyzipayCreatable {
  create(request: object, callback: IyzipayCallback): void
}

interface IyzipayRetrievable {
  retrieve(request: object, callback: IyzipayCallback): void
}

interface IyzipayInstance {
  threedsInitialize: IyzipayCreatable
  threedsV2Payment: IyzipayCreatable
  payment: IyzipayRetrievable
  refund: IyzipayCreatable
  cancel: IyzipayCreatable
  installmentInfo: IyzipayRetrievable
  reportingTransactionDetails: IyzipayRetrievable
}

interface IyzicoRawItemTransaction {
  itemId?: string
  paymentTransactionId?: string | number
  transactionStatus?: number
  price?: string | number
  paidPrice?: string | number
  merchantPayoutAmount?: string | number
  iyziCommissionFee?: string | number
  iyziCommissionRateAmount?: string | number
  refunds?: Array<{
    refundTxId?: string | number
    refundConversationId?: string
    refundPrice?: string | number
    refundStatus?: number
    createdDate?: string
  }>
}

interface IyzicoRawResult {
  status?: string
  locale?: string
  systemTime?: number
  conversationId?: string
  paymentConversationId?: string
  threeDSHtmlContent?: string
  paymentId?: string | number
  paymentStatus?: string | number
  fraudStatus?: number
  mdStatus?: number | string
  price?: string | number
  paidPrice?: string | number
  installment?: number
  currency?: string
  basketId?: string
  binNumber?: string
  lastFourDigits?: string
  cardType?: string
  cardAssociation?: string
  cardFamily?: string
  iyziCommissionFee?: string | number
  iyziCommissionRateAmount?: string | number
  signature?: string
  errorCode?: string
  errorMessage?: string
  errorGroup?: string
  paymentTransactionId?: string | number
  itemTransactions?: IyzicoRawItemTransaction[]
  installmentDetails?: Array<{
    binNumber?: string
    price?: string | number
    cardType?: string
    cardAssociation?: string
    cardFamilyName?: string
    bankName?: string
    force3ds?: number
    commercial?: number
    installmentPrices?: Array<{
      installmentNumber?: number
      installmentPrice?: string | number
      totalPrice?: string | number
    }>
  }>
  payments?: Array<{
    paymentId?: string | number
    paymentStatus?: number
    paymentRefundStatus?: string
    price?: string | number
    paidPrice?: string | number
    installment?: number
    threeDS?: boolean | number
    fraudStatus?: number
    basketId?: string
    paymentConversationId?: string
    cancels?: Array<{
      refundId?: string | number
      cancelConversationId?: string
      refundPrice?: string | number
      refundStatus?: number
      createdDate?: string
    }>
    itemTransactions?: IyzicoRawItemTransaction[]
  }>
}

// ─── Public types ────────────────────────────────────────────────────────────

/** success: Iyzico onayladı; failure: Iyzico açıkça reddetti; unknown: sonuç kanıtlanamadı. */
export type IyzicoOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'failure'; errorCode?: string; errorMessage: string }
  | { kind: 'unknown'; reason: string }

export interface IyzicoBuyer {
  id: string
  name: string
  surname: string
  email: string
  identityNumber: string
  registrationAddress: string
  city: string
  country: string
  ip: string
  gsmNumber?: string
  zipCode?: string
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
  /** Kuruş hassasiyetinde ondalık string, ör. "1250.50". 0 olamaz. */
  price: string
}

export interface IyzicoCard {
  cardHolderName: string
  cardNumber: string
  expireMonth: string
  expireYear: string
  cvc: string
}

export interface InstallmentOption {
  installmentNumber: number
  installmentPrice: string
  totalPrice: string
}

export interface InstallmentQuoteResult {
  binNumber: string
  cardType: string | null
  cardAssociation: string | null
  cardFamily: string | null
  bankName: string | null
  commercial: boolean
  options: InstallmentOption[]
}

export interface Initiate3DSParams {
  conversationId: string
  basketId: string
  price: string
  paidPrice: string
  installment: number
  callbackUrl: string
  buyer: IyzicoBuyer
  shippingAddress: IyzicoAddress
  billingAddress: IyzicoAddress
  basketItems: IyzicoBasketItem[]
  paymentCard: IyzicoCard
}

export interface Initiate3DSData {
  paymentId: string
  htmlContent: string
}

export interface Complete3DSParams {
  paymentId: string
  conversationId: string
  basketId: string
  paidPrice: string
}

export interface IyzicoPaymentItemTransaction {
  itemId: string
  paymentTransactionId: string
  transactionStatus?: number
  price: string
  paidPrice: string
  merchantPayoutAmount?: string
}

export interface IyzicoPaymentDetail {
  paymentId: string
  conversationId: string | null
  basketId: string | null
  currency: string | null
  price: string
  paidPrice: string
  installment: number | null
  fraudStatus: number | null
  mdStatus: string | null
  paymentStatus: string | null
  binNumber: string | null
  lastFourDigits: string | null
  cardType: string | null
  cardAssociation: string | null
  cardFamily: string | null
  iyziCommissionFee: string | null
  iyziCommissionRateAmount: string | null
  merchantPayoutAmount: string | null
  itemTransactions: IyzicoPaymentItemTransaction[]
}

export interface CallbackFields {
  status: string | null
  paymentId: string | null
  conversationId: string | null
  conversationData: string | null
  mdStatus: string | null
  signature: string | null
}

export interface PaymentReportRefund {
  scope: 'cancel' | 'refund'
  paymentTransactionId: string | null
  conversationId: string | null
  price: string | null
  status: number | null
  providerReference: string | null
}

export interface PaymentReport {
  paymentId: string
  paymentStatus: number | null
  refundStatus: string | null
  threeDS: boolean
  fraudStatus: number | null
  price: string | null
  paidPrice: string | null
  installment: number | null
  basketId: string | null
  refunds: PaymentReportRefund[]
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
  /** true: Iyzico yanıtı alındı ama imzası doğrulanamadı — sonuç kanıtlanamaz, tekrar denenmemeli. */
  uncertain?: boolean
  paymentTransactionId?: string
  errorCode?: string
  errorMessage?: string
}

// ─── Price and signature helpers ─────────────────────────────────────────────

/**
 * Iyzico SDK'nın `formatPrice` biçimi: sondaki sıfırlar atılır, tam sayıya ".0" eklenir
 * ("1250.50" → "1250.5", "100.00" → "100.0"). Float'a çevirmeden string üzerinden çalışır.
 * initialize ile v2 auth aynı string'i göndermelidir.
 */
export function toIyzicoPrice(
  value: string | number | { toFixed(digits: number): string },
): string {
  const fixed =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? value.toFixed(2)
        : value.toFixed(2)
  if (!/^-?\d+(\.\d+)?$/.test(fixed)) throw new Error(`Geçersiz tutar: ${fixed}`)
  const [integerPart, fractionPart = ''] = fixed.split('.')
  const trimmed = fractionPart.replace(/0+$/, '')
  return `${integerPart}.${trimmed.length > 0 ? trimmed : '0'}`
}

/** Response Signature Validation: fiyatlarda sondaki sıfırlar ve nokta atılır ("10.0" → "10"). */
export function toSignaturePrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

/** "1250.50" ve "1250.5" gibi biçim farklarını yok sayarak iki Iyzico tutarını karşılaştırır. */
export function iyzicoAmountsEqual(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false
  return toSignaturePrice(left) === toSignaturePrice(right)
}

function secretKey(): string {
  const key = process.env.IYZICO_SECRET_KEY
  if (!key) throw new Error('IYZICO_SECRET_KEY tanımlı değil')
  return key
}

export function computeIyzicoSignature(parts: Array<string | number | null | undefined>): string {
  return crypto
    .createHmac('sha256', secretKey())
    .update(
      parts.map((part) => (part === null || part === undefined ? '' : String(part))).join(':'),
    )
    .digest('hex')
}

function safeEqualHex(received: string, expected: string): boolean {
  const left = Buffer.from(received.trim().toLowerCase())
  const right = Buffer.from(expected.toLowerCase())
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function verifySignature(
  signature: string | null | undefined,
  parts: Array<string | number | null | undefined>,
): boolean {
  if (!signature) return false
  return safeEqualHex(signature, computeIyzicoSignature(parts))
}

// ─── Client ───────────────────────────────────────────────────────────────────

function createClient(): IyzipayInstance {
  if (!process.env.IYZICO_API_KEY || !process.env.IYZICO_SECRET_KEY) {
    throw new Error('IYZICO_API_KEY veya IYZICO_SECRET_KEY tanımlı değil')
  }
  const Iyzipay = loadIyzipay()
  return new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_BASE_URL ?? 'https://sandbox-api.iyzipay.com',
  })
}

function call(
  method: (request: object, callback: IyzipayCallback) => void,
  request: object,
): Promise<IyzicoRawResult> {
  return new Promise((resolve, reject) => {
    method(request, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

/**
 * Hata mesajları kart verisi içermez: istek nesnesi asla loglanmaz/döndürülmez,
 * yalnız SDK hata mesajının kısaltılmış hali taşınır.
 */
function transportReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'bağlantı hatası'
  return message.replace(/\d{12,19}/g, '[kart]').slice(0, 200)
}

function str(value: string | number | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function failureOf(result: IyzicoRawResult, fallback: string) {
  return {
    kind: 'failure' as const,
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    errorMessage: result.errorMessage ?? fallback,
  }
}

function mapItemTransactions(
  items: IyzicoRawItemTransaction[] | undefined,
): IyzicoPaymentItemTransaction[] {
  return (items ?? [])
    .filter((item) => item.itemId && item.paymentTransactionId !== undefined)
    .map((item) => ({
      itemId: String(item.itemId),
      paymentTransactionId: String(item.paymentTransactionId),
      ...(item.transactionStatus !== undefined
        ? { transactionStatus: item.transactionStatus }
        : {}),
      price: str(item.price) ?? '0',
      paidPrice: str(item.paidPrice) ?? '0',
      ...(item.merchantPayoutAmount !== undefined
        ? { merchantPayoutAmount: String(item.merchantPayoutAmount) }
        : {}),
    }))
}

function mapPaymentDetail(result: IyzicoRawResult): IyzicoPaymentDetail {
  const items = mapItemTransactions(result.itemTransactions)
  const payout = (result.itemTransactions ?? []).reduce<number | null>((sum, item) => {
    if (item.merchantPayoutAmount === undefined) return sum
    return (sum ?? 0) + Math.round(Number(item.merchantPayoutAmount) * 100)
  }, null)
  return {
    paymentId: String(result.paymentId),
    conversationId: str(result.conversationId),
    basketId: str(result.basketId),
    currency: str(result.currency),
    price: str(result.price) ?? '0',
    paidPrice: str(result.paidPrice) ?? '0',
    installment: result.installment ?? null,
    fraudStatus: result.fraudStatus ?? null,
    mdStatus: str(result.mdStatus),
    paymentStatus: str(result.paymentStatus),
    binNumber: str(result.binNumber),
    lastFourDigits: str(result.lastFourDigits),
    cardType: str(result.cardType),
    cardAssociation: str(result.cardAssociation),
    cardFamily: str(result.cardFamily),
    iyziCommissionFee: str(result.iyziCommissionFee),
    iyziCommissionRateAmount: str(result.iyziCommissionRateAmount),
    merchantPayoutAmount: payout === null ? null : (payout / 100).toFixed(2),
    itemTransactions: items,
  }
}

/** Ödeme yanıtı imzası: paymentId:currency:basketId:conversationId:paidPrice:price */
function verifyPaymentSignature(result: IyzicoRawResult): boolean {
  return verifySignature(result.signature, [
    result.paymentId,
    result.currency,
    result.basketId,
    result.conversationId,
    toSignaturePrice(result.paidPrice),
    toSignaturePrice(result.price),
  ])
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * BIN (ilk 8 hane) + tutar için taksit seçenekleri. Tutarlar Iyzico panelindeki
 * "Taksit ve Komisyon Yönetimi" oranlarını içerir (vade farkı müşteriye yansıtıldığında totalPrice > price).
 * success + data=null: BIN bulunamadı (çoğunlukla yabancı kart).
 */
export async function getInstallmentOptions(params: {
  binNumber: string
  price: string
  conversationId: string
}): Promise<IyzicoOutcome<InstallmentQuoteResult | null>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(client.installmentInfo.retrieve.bind(client.installmentInfo), {
      locale: 'tr',
      conversationId: params.conversationId,
      binNumber: params.binNumber,
      price: params.price,
    })
  } catch (error) {
    return { kind: 'unknown', reason: transportReason(error) }
  }
  if (result.status !== 'success') return failureOf(result, 'Taksit bilgisi alınamadı')

  const detail = (result.installmentDetails ?? [])[0]
  if (!detail) return { kind: 'success', data: null }
  return {
    kind: 'success',
    data: {
      binNumber: detail.binNumber ?? params.binNumber,
      cardType: detail.cardType ?? null,
      cardAssociation: detail.cardAssociation ?? null,
      cardFamily: detail.cardFamilyName ?? null,
      bankName: detail.bankName ?? null,
      commercial: detail.commercial === 1,
      options: (detail.installmentPrices ?? [])
        .filter(
          (option) =>
            Number.isInteger(option.installmentNumber) &&
            option.installmentPrice !== undefined &&
            option.totalPrice !== undefined,
        )
        .map((option) => ({
          installmentNumber: option.installmentNumber as number,
          installmentPrice: String(option.installmentPrice),
          totalPrice: String(option.totalPrice),
        }))
        .sort((a, b) => a.installmentNumber - b.installmentNumber),
    },
  }
}

/**
 * 3D Secure başlatır. Başarılıysa Iyzico paymentId ve gösterilecek HTML döner.
 * Yanıt imzası (paymentId:conversationId) doğrulanamazsa 3DS gösterilmez — bu adımda para çekilmez,
 * bu yüzden doğrulanamayan yanıt "failure" sayılır.
 */
export async function initiate3DS(
  params: Initiate3DSParams,
): Promise<IyzicoOutcome<Initiate3DSData>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(client.threedsInitialize.create.bind(client.threedsInitialize), {
      locale: 'tr',
      conversationId: params.conversationId,
      price: params.price,
      paidPrice: params.paidPrice,
      currency: 'TRY',
      installment: params.installment,
      basketId: params.basketId,
      paymentChannel: 'WEB',
      paymentGroup: 'PRODUCT',
      callbackUrl: params.callbackUrl,
      buyer: params.buyer,
      shippingAddress: params.shippingAddress,
      billingAddress: params.billingAddress,
      basketItems: params.basketItems,
      paymentCard: { ...params.paymentCard, registerCard: '0' },
    })
  } catch (error) {
    return {
      kind: 'failure',
      errorCode: 'TRANSPORT',
      errorMessage: transportReason(error),
    }
  }

  if (result.status !== 'success' || !result.threeDSHtmlContent || result.paymentId === undefined) {
    return failureOf(result, 'Ödeme başlatılamadı')
  }
  if (
    result.conversationId !== params.conversationId ||
    !verifySignature(result.signature, [result.paymentId, result.conversationId])
  ) {
    return {
      kind: 'failure',
      errorCode: 'SIGNATURE_MISMATCH',
      errorMessage: 'Ödeme yanıtı doğrulanamadı',
    }
  }

  return {
    kind: 'success',
    data: {
      paymentId: String(result.paymentId),
      htmlContent: Buffer.from(result.threeDSHtmlContent, 'base64').toString('utf-8'),
    },
  }
}

/**
 * 3DS callback alanlarının imzasını doğrular (conversationData:conversationId:mdStatus:paymentId:status).
 * 'absent': Iyzico alanı göndermedi — güvence paymentId eşleşmesi ve imzalı v2 auth yanıtıdır.
 */
export function verifyCallbackSignature(fields: CallbackFields): 'valid' | 'invalid' | 'absent' {
  if (!fields.signature) return 'absent'
  return verifySignature(fields.signature, [
    fields.conversationData,
    fields.conversationId,
    fields.mdStatus,
    fields.paymentId,
    fields.status,
  ])
    ? 'valid'
    : 'invalid'
}

/**
 * 3DS v2 auth — parayı bu çağrı çeker. paidPrice/basketId/currency initialize ile birebir aynı olmalı.
 * Ağ hatası ve imzası doğrulanamayan başarılı yanıt "unknown" döner (mutabakat gerekir).
 */
export async function complete3DS(
  params: Complete3DSParams,
): Promise<IyzicoOutcome<IyzicoPaymentDetail>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(client.threedsV2Payment.create.bind(client.threedsV2Payment), {
      locale: 'tr',
      conversationId: params.conversationId,
      paymentId: params.paymentId,
      paidPrice: params.paidPrice,
      basketId: params.basketId,
      currency: 'TRY',
    })
  } catch (error) {
    return { kind: 'unknown', reason: transportReason(error) }
  }
  if (result.status !== 'success') return failureOf(result, '3DS onayı başarısız')
  if (result.paymentId === undefined || !verifyPaymentSignature(result)) {
    return {
      kind: 'unknown',
      reason: 'Iyzico auth yanıtının imzası doğrulanamadı',
    }
  }
  return { kind: 'success', data: mapPaymentDetail(result) }
}

/** Ödeme sorgusu. Tahsilat kanıtı için ayrıca paymentStatus === 'SUCCESS' aranmalıdır. */
export async function retrievePayment(params: {
  paymentId: string
  paymentConversationId: string
  conversationId: string
}): Promise<IyzicoOutcome<IyzicoPaymentDetail>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(client.payment.retrieve.bind(client.payment), {
      locale: 'tr',
      conversationId: params.conversationId,
      paymentId: params.paymentId,
      paymentConversationId: params.paymentConversationId,
    })
  } catch (error) {
    return { kind: 'unknown', reason: transportReason(error) }
  }
  if (result.status !== 'success') return failureOf(result, 'Ödeme detayı alınamadı')
  if (result.paymentId === undefined || !verifyPaymentSignature(result)) {
    return {
      kind: 'unknown',
      reason: 'Iyzico ödeme sorgusunun imzası doğrulanamadı',
    }
  }
  return { kind: 'success', data: mapPaymentDetail(result) }
}

/**
 * Raporlama servisi (/v2/reporting/payment/details). İade/iptal kanıtı burada aranır:
 * bizim gönderdiğimiz conversationId, refundConversationId / cancelConversationId olarak döner.
 * SDK yalnız paymentConversationId ile sorgular.
 */
export async function getPaymentReport(params: {
  paymentConversationId: string
  conversationId: string
}): Promise<IyzicoOutcome<PaymentReport[]>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(
      client.reportingTransactionDetails.retrieve.bind(client.reportingTransactionDetails),
      {
        locale: 'tr',
        conversationId: params.conversationId,
        paymentConversationId: params.paymentConversationId,
      },
    )
  } catch (error) {
    return { kind: 'unknown', reason: transportReason(error) }
  }
  if (result.status !== 'success') return failureOf(result, 'Ödeme raporu alınamadı')
  return {
    kind: 'success',
    data: (result.payments ?? [])
      .filter((payment) => payment.paymentId !== undefined)
      .map((payment) => ({
        paymentId: String(payment.paymentId),
        paymentStatus: payment.paymentStatus ?? null,
        refundStatus: payment.paymentRefundStatus ?? null,
        threeDS: payment.threeDS === true || payment.threeDS === 1,
        fraudStatus: payment.fraudStatus ?? null,
        price: str(payment.price),
        paidPrice: str(payment.paidPrice),
        installment: payment.installment ?? null,
        basketId: payment.basketId ?? null,
        refunds: [
          ...(payment.cancels ?? []).map((cancel) => ({
            scope: 'cancel' as const,
            paymentTransactionId: null,
            conversationId: cancel.cancelConversationId ?? null,
            price: str(cancel.refundPrice),
            status: cancel.refundStatus ?? null,
            providerReference: str(cancel.refundId),
          })),
          ...(payment.itemTransactions ?? []).flatMap((item) =>
            (item.refunds ?? []).map((refund) => ({
              scope: 'refund' as const,
              paymentTransactionId: str(item.paymentTransactionId),
              conversationId: refund.refundConversationId ?? null,
              price: str(refund.refundPrice),
              status: refund.refundStatus ?? null,
              providerReference: str(refund.refundTxId),
            })),
          ),
        ],
      })),
  }
}

/**
 * iyzico iptal/iade sebebi. Açıklama (description) gönderilen istekte zorunludur; yoksa iyzico
 * "iade sebebi (reason) alanı zorunludur" hatasıyla reddeder (sandbox, 2026-10-17).
 */
export type IyzicoReversalReason = 'double_payment' | 'buyer_request' | 'fraud' | 'other'

/** Aynı gün iptal (void). Kısmi iptal desteklenmez; ödemenin tamamını iptal eder. */
export async function cancelPayment(params: {
  paymentId: string
  conversationId: string
  ip: string
  reason: IyzicoReversalReason
  description?: string
}): Promise<IyzicoOutcome<{ price: string | null }>> {
  let result: IyzicoRawResult
  try {
    const client = createClient()
    result = await call(client.cancel.create.bind(client.cancel), {
      locale: 'tr',
      conversationId: params.conversationId,
      paymentId: params.paymentId,
      ip: params.ip,
      reason: params.reason,
      ...(params.description ? { description: params.description.slice(0, 200) } : {}),
    })
  } catch (error) {
    return { kind: 'unknown', reason: transportReason(error) }
  }
  if (result.status !== 'success') return failureOf(result, 'İptal başarısız')
  if (result.paymentId !== undefined && String(result.paymentId) !== params.paymentId) {
    return { kind: 'unknown', reason: 'İptal yanıtı başka bir ödemeye ait' }
  }
  return { kind: 'success', data: { price: str(result.price) } }
}

/**
 * Kalem bazlı iade (paymentTransactionId). Tavan: kalemin paidPrice'ı eksi önceki iadeler.
 * Yanıt imzası paymentId:price:currency:conversationId ile doğrulanır; doğrulanamazsa uncertain.
 */
export async function refundPayment(params: IyzicoRefundParams): Promise<IyzicoRefundResult> {
  const client = createClient()
  const result = await call(client.refund.create.bind(client.refund), {
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

  const signed = verifySignature(result.signature, [
    result.paymentId,
    toSignaturePrice(result.price),
    result.currency,
    result.conversationId,
  ])
  if (!signed || result.conversationId !== params.conversationId) {
    return {
      success: false,
      uncertain: true,
      errorMessage: 'İade yanıtının imzası doğrulanamadı',
    }
  }

  return {
    success: true,
    ...(result.paymentTransactionId !== undefined
      ? { paymentTransactionId: String(result.paymentTransactionId) }
      : {}),
  }
}

/**
 * Webhook imzası (X-IYZ-SIGNATURE-V3, doğrudan API bildirimleri):
 * HMAC-SHA256(secretKey, secretKey + iyziEventType + paymentId + paymentConversationId + status), hex.
 * Secret yoksa her ortamda reddeder.
 */
export function verifyWebhookSignatureV3(
  signature: string | null | undefined,
  payload: {
    iyziEventType?: unknown
    paymentId?: unknown
    paymentConversationId?: unknown
    status?: unknown
  },
): boolean {
  const key = process.env.IYZICO_SECRET_KEY
  if (!key || !signature) return false
  const message =
    key +
    String(payload.iyziEventType ?? '') +
    String(payload.paymentId ?? '') +
    String(payload.paymentConversationId ?? '') +
    String(payload.status ?? '')
  const expected = crypto.createHmac('sha256', key).update(message).digest('hex')
  return safeEqualHex(signature, expected)
}
