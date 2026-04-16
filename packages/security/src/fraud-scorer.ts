/**
 * Rule-based order risk scorer.
 * Returns a numeric score (0–100) and a list of triggered risk signals.
 * High scores should trigger admin review before fulfillment.
 */

export interface OrderRiskInput {
  /** Order total in TRY */
  orderTotal: number
  /** Is this the customer's first-ever order? */
  isFirstOrder: boolean
  /** Number of failed payment attempts on this order */
  failedPaymentAttempts: number
  /** Customer account age in days */
  accountAgeDays: number
  /** Number of orders the customer placed in the last 24h */
  ordersInLast24h: number
  /** Has the customer used a coupon? */
  hasCoupon: boolean
  /** Number of disputes the customer has opened in the last 90 days */
  recentDisputeCount: number
  /** Number of returns the customer has made in the last 90 days */
  recentReturnCount: number
  /** Payment method */
  paymentMethod: 'card' | 'eft'
}

export interface FraudScoreResult {
  /** Aggregate risk score 0–100 */
  score: number
  /** Risk level derived from score */
  level: 'low' | 'medium' | 'high' | 'critical'
  /** Human-readable list of triggered signals */
  signals: string[]
  /** Whether this order should be held for admin review */
  requiresReview: boolean
}

const THRESHOLDS = {
  review: 40,
  high: 60,
  critical: 80,
} as const

export function scoreOrderRisk(input: OrderRiskInput): FraudScoreResult {
  let score = 0
  const signals: string[] = []

  // High order value
  if (input.orderTotal > 10_000) {
    score += 20
    signals.push('Yüksek sipariş tutarı (>10.000 ₺)')
  } else if (input.orderTotal > 5_000) {
    score += 10
    signals.push('Orta-yüksek sipariş tutarı (>5.000 ₺)')
  }

  // First order
  if (input.isFirstOrder) {
    score += 10
    signals.push('Müşterinin ilk siparişi')
  }

  // New account
  if (input.accountAgeDays < 1) {
    score += 20
    signals.push('Yeni hesap (<1 gün)')
  } else if (input.accountAgeDays < 7) {
    score += 10
    signals.push('Genç hesap (<7 gün)')
  }

  // Failed payment attempts
  if (input.failedPaymentAttempts >= 3) {
    score += 25
    signals.push(`Çoklu başarısız ödeme denemesi (${input.failedPaymentAttempts}x)`)
  } else if (input.failedPaymentAttempts >= 1) {
    score += 10
    signals.push(`Başarısız ödeme denemesi (${input.failedPaymentAttempts}x)`)
  }

  // High order velocity
  if (input.ordersInLast24h >= 5) {
    score += 20
    signals.push(`Yüksek sipariş sıklığı — son 24s'te ${input.ordersInLast24h} sipariş`)
  } else if (input.ordersInLast24h >= 3) {
    score += 10
    signals.push(`Artmış sipariş sıklığı — son 24s'te ${input.ordersInLast24h} sipariş`)
  }

  // Recent disputes
  if (input.recentDisputeCount >= 3) {
    score += 20
    signals.push(`Çok sayıda son uyuşmazlık (${input.recentDisputeCount} adet)`)
  } else if (input.recentDisputeCount >= 1) {
    score += 8
    signals.push(`Son uyuşmazlık geçmişi (${input.recentDisputeCount} adet)`)
  }

  // Recent returns
  if (input.recentReturnCount >= 5) {
    score += 15
    signals.push(`Yüksek iade oranı (${input.recentReturnCount} iade)`)
  } else if (input.recentReturnCount >= 3) {
    score += 7
    signals.push(`Artmış iade sayısı (${input.recentReturnCount} iade)`)
  }

  // First order + high value + new account combo (amplify)
  if (input.isFirstOrder && input.orderTotal > 5_000 && input.accountAgeDays < 7) {
    score += 15
    signals.push('Yeni hesap + ilk sipariş + yüksek tutar kombinasyonu')
  }

  const capped = Math.min(score, 100)

  let level: FraudScoreResult['level']
  if (capped >= THRESHOLDS.critical) level = 'critical'
  else if (capped >= THRESHOLDS.high) level = 'high'
  else if (capped >= THRESHOLDS.review) level = 'medium'
  else level = 'low'

  return {
    score: capped,
    level,
    signals,
    requiresReview: capped >= THRESHOLDS.review,
  }
}
