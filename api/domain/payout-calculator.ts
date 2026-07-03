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
import { PAYOUT_HOLD_DAYS } from './penalty-calculator'

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

/**
 * Payout hold expires 30 days after delivery_confirmed.
 * Countdown starts from delivery_confirmed — not delivered, not shipped.
 */
export function calculateHoldUntil(deliveryConfirmedAt: Date): Date {
  const holdUntil = new Date(deliveryConfirmedAt)
  holdUntil.setDate(holdUntil.getDate() + PAYOUT_HOLD_DAYS)
  return holdUntil
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
 * Commission base = OrderLine.totalPrice (KDV dahil, pre-discount gross).
 * This is the agreed platform policy: commission is calculated on the KDV-inclusive price.
 */
export function calculateCommission(grossAmount: Decimal, rate: Decimal): Decimal {
  return roundMoney(grossAmount.mul(rate))
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
      }
    },
    {
      grossAmount: new Decimal(0),
      commissionAmount: new Decimal(0),
      netAmount: new Decimal(0),
    },
  )
}
