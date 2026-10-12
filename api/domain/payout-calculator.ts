/**
 * Payout Calculator — 07-marketplace-finance-rules.md
 *
 * Implements the net payout formula:
 *   net = gross - commission - coupon_share - cargo - ad_fee - penalty - refund + adjustment
 *
 * All calculations are server-side only. Never expose raw formula to client.
 * Uses Decimal for precision — never use JS floats for money.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { addReportingDateDays, getReportingDateKey, reportingDayStart } from '../lib/reporting-time'
import { PAYOUT_HOLD_DAYS } from './penalty-calculator'
import { isBusinessDay } from './tr-holidays'

export interface PayoutComponents {
  grossAmount: Decimal
  commissionAmount: Decimal
  couponShareAmount: Decimal
  cargoChargeAmount: Decimal
  adFeeAmount: Decimal
  penaltyAmount: Decimal
  refundAmount: Decimal
  adjustmentAmount: Decimal // Admin manual adjustment (positive = credit, negative = debit)
}

export interface PayoutSnapshotLine {
  totalPrice: Decimal
  commissionAmount: Decimal
  netPayoutAmount: Decimal
  /**
   * When set (admin commission exemption), the line's commission is treated as 0.
   * The commission that was subtracted at order creation is added back to net.
   * See docs/01-business/payout-policy.md — Komisyon muafiyeti.
   */
  commissionExemptedAt?: Date | null
  /**
   * Satır bazında satıcı kuponu payı snapshot'ı (OrderLine.couponDiscountAmount).
   * Yalnız satıcı kuponunda > 0 olur; platform kuponunda 0 kalır.
   */
  couponDiscountAmount?: Decimal | null
}

/**
 * Calculate net payout from all deduction components.
 * Result may be negative — that creates a seller debt.
 */
export function calculateNetPayout(c: PayoutComponents): Decimal {
  const rawNet = c.grossAmount
    .minus(c.commissionAmount)
    .minus(c.couponShareAmount)
    .minus(c.cargoChargeAmount)
    .minus(c.adFeeAmount)
    .minus(c.penaltyAmount)
    .minus(c.refundAmount)
    .plus(c.adjustmentAmount)
  return roundMoney(rawNet)
}

const FRIDAY = 5

function weekdayOfDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay()
}

// tr-holidays reads local calendar fields, so build the same calendar day locally.
function localCalendarDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

/** First Friday on or after the Türkiye calendar day; a Friday holiday moves to the next business day. */
function payoutDayOnOrAfter(dateKey: string) {
  let key = dateKey
  while (weekdayOfDateKey(key) !== FRIDAY) key = addReportingDateDays(key, 1)
  while (!isBusinessDay(localCalendarDate(key))) key = addReportingDateDays(key, 1)
  return key
}

/**
 * Hakediş vadesi: satıcının Hanuja'ya kestiği faturanın tarihinden `holdDays` gün sonraki
 * ilk cuma (Türkiye takvim günü; cuma resmi tatilse sonraki iş günü). Dönen an o günün
 * 00:00'ıdır (Europe/Istanbul). Vade bir alt sınırdır: teslim onayı, açık iade/uyuşmazlık
 * ve diğer engeller ayrıca kontrol edilir (payout-eligibility.ts).
 */
export function calculatePayoutDueDate(invoiceDate: Date, holdDays: number = PAYOUT_HOLD_DAYS): Date {
  const days = Number.isInteger(holdDays) && holdDays >= 0 ? holdDays : PAYOUT_HOLD_DAYS
  const dueKey = addReportingDateDays(getReportingDateKey(invoiceDate), days)
  return reportingDayStart(payoutDayOnOrAfter(dueKey))
}

/** Next payout day (Friday rule) on or after `from`; used when a blocker clears after the due date. */
export function nextPayoutDay(from: Date): Date {
  return reportingDayStart(payoutDayOnOrAfter(getReportingDateKey(from)))
}

/** Earliest date the seller can expect payment: the due date, or the next payout day once it passed. */
export function expectedPayoutDate(dueDate: Date, now = new Date()): Date {
  return dueDate.getTime() >= now.getTime() ? dueDate : nextPayoutDay(now)
}

export function isHoldExpired(holdUntil: Date, now = new Date()): boolean {
  return now >= holdUntil
}

/**
 * Commission resolution order (CLAUDE.md 15.1):
 * 1. Product-specific override
 * 2. Category rate
 * 3. Seller general rate
 * 4. System default rate
 */
export function resolveCommissionRate(
  productRate: Decimal | null,
  categoryRate: Decimal | null,
  sellerRate: Decimal | null,
  systemDefaultRate: Decimal,
): Decimal {
  return productRate ?? categoryRate ?? sellerRate ?? systemDefaultRate
}

/**
 * Commission base = customer-paid line amount (KDV dahil, satıcı kuponu indirimi
 * düşülmüş). Seller-scoped kupon indirimi komisyon tabanını düşürür; platform
 * kuponu satır snapshot'larını etkilemez (bkz. allocateCouponDiscount).
 *
 * Komisyon kesintisi KDV DAHİL (07-marketplace-finance-rules.md):
 *   commissionAmount = roundMoney(base × rate × (1 + vatRate))
 * `vatRate` mutlaka PlatformSettings.commissionVatRate'ten gelmeli — hardcode etme.
 */
export function calculateCommission(base: Decimal, rate: Decimal, vatRate: Decimal): Decimal {
  return roundMoney(base.mul(rate).mul(vatRate.plus(1)))
}

/**
 * Bir satıcı-scope'lu kupon indirimini o satıcının sipariş satırlarına, satır
 * totalPrice'ına oransal olarak dağıtır. Largest-remainder yöntemiyle kuruş
 * farksız toplam eşitliği garanti edilir (sum(sonuç) === totalDiscount).
 *
 * Platform kuponunda (Coupon.sellerId null) bu fonksiyon hiç çağrılmaz — satır
 * snapshot'ları tam fiyat üzerinden kalır, indirim maliyetini platform emer.
 *
 * Kenar durumlar: boş satır listesi, sıfır/negatif indirim, indirim > satır
 * toplamı (indirim satır toplamına clamp edilir) güvenle ele alınır.
 */
export function allocateCouponDiscount(
  lines: { totalPrice: Decimal }[],
  totalDiscount: Decimal,
): Decimal[] {
  const zero = new Decimal(0)
  if (lines.length === 0) return []
  if (totalDiscount.lte(0)) return lines.map(() => zero)

  const sumTotalPrice = lines.reduce((sum, line) => sum.plus(line.totalPrice), zero)
  if (sumTotalPrice.lte(0)) return lines.map(() => zero)

  // İndirim satır toplamını asla aşmasın — savunmacı clamp.
  const clampedDiscount = Decimal.min(totalDiscount, sumTotalPrice)

  // Kuruş bazında (×100) tam sayı payları üzerinden largest-remainder uygula.
  const totalCents = clampedDiscount.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)

  const rawShares = lines.map((line) => {
    const shareCents = line.totalPrice.mul(totalCents).div(sumTotalPrice)
    const flooredCents = shareCents.toDecimalPlaces(0, Decimal.ROUND_DOWN)
    return {
      flooredCents,
      remainder: shareCents.minus(flooredCents),
    }
  })

  const allocatedCents = rawShares.reduce((sum, share) => sum.plus(share.flooredCents), zero)
  let remainingCents = totalCents.minus(allocatedCents).toNumber()

  // Kalan kuruşları en büyük kesirli kalana sahip satırlara sırayla dağıt
  // (largest-remainder method) — toplam kuruşu kuruşuna eşitlenir.
  const order = rawShares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder))

  const finalCents = rawShares.map((share) => share.flooredCents)
  for (let i = 0; i < order.length && remainingCents > 0; i++) {
    const idx = order[i]!.index
    finalCents[idx] = finalCents[idx]!.plus(1)
    remainingCents -= 1
  }

  return finalCents.map((cents) => cents.div(100).toDecimalPlaces(2))
}

/**
 * Aggregate seller payout figures from order-line snapshots.
 *
 * Commission exemption (admin decision, OrderLine.commissionExemptedAt) removes
 * the line's commission from BOTH the commission total and the net calculation:
 * - gross is never affected by exemption
 * - an exempt line contributes 0 commission
 * - the commission originally subtracted from netPayoutAmount at order creation
 *   is added back, so the seller receives the un-commissioned amount
 *
 * The commissionAmount returned here is what the payout snapshot and the
 * `commission` ledger entry must reflect — i.e. only non-exempt commission.
 */
export function sumPayoutSnapshot(lines: PayoutSnapshotLine[]) {
  const zero = new Decimal(0)
  return lines.reduce(
    (totals, line) => {
      const isExempt = line.commissionExemptedAt != null
      const lineCommission = isExempt ? zero : line.commissionAmount
      const lineNet = isExempt
        ? line.netPayoutAmount.plus(line.commissionAmount)
        : line.netPayoutAmount
      return {
        grossAmount: totals.grossAmount.plus(line.totalPrice),
        commissionAmount: totals.commissionAmount.plus(lineCommission),
        netAmount: totals.netAmount.plus(lineNet),
        couponShareAmount: totals.couponShareAmount.plus(line.couponDiscountAmount ?? zero),
      }
    },
    {
      grossAmount: new Decimal(0),
      commissionAmount: new Decimal(0),
      netAmount: new Decimal(0),
      couponShareAmount: new Decimal(0),
    },
  )
}
