/**
 * Penalty Calculator — 07-marketplace-finance-rules.md, CLAUDE.md 2.4
 *
 * Standard penalty rate: 20% of product amount.
 * Platform business constants (CLAUDE.md 15.3).
 * Do not change these values without documented policy approval.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { addBusinessDays } from './business-days'

// Platform constants — CLAUDE.md 15.3
export const STANDARD_PENALTY_RATE = new Decimal('0.2000') // 20%
export const FULFILLMENT_DAYS = 20 // 20-business-day shipment commitment
export const PAYOUT_HOLD_DAYS = 30 // Varsayılan: satıcı faturası tarihinden 30 gün (PlatformSettings.payoutHoldDays)
export const RETURN_WINDOW_DAYS = 14 // 14-day right-of-withdrawal
export const FULFILLMENT_EXTENSION_DAYS = 10 // Optional 10-business-day extension (admin only)

/**
 * Calculate penalty amount.
 * Default rate is 20% — override only with explicit policy approval.
 */
export function calculatePenalty(
  productAmount: Decimal,
  rate: Decimal = STANDARD_PENALTY_RATE,
): Decimal {
  return roundMoney(productAmount.mul(rate))
}

/** Returns true if the 20-business-day fulfillment deadline has passed. */
export function isFulfillmentDeadlineBreached(paymentConfirmedAt: Date, now = new Date()): boolean {
  return now > getFulfillmentDeadline(paymentConfirmedAt)
}

/** Returns the 20-business-day fulfillment deadline date. */
export function getFulfillmentDeadline(paymentConfirmedAt: Date): Date {
  return addBusinessDays(paymentConfirmedAt, FULFILLMENT_DAYS)
}

/** Returns the optional extended deadline (admin-granted 10-business-day extension). */
export function getExtendedFulfillmentDeadline(paymentConfirmedAt: Date): Date {
  return addBusinessDays(paymentConfirmedAt, FULFILLMENT_DAYS + FULFILLMENT_EXTENSION_DAYS)
}

/** Returns true if delivery_confirmed is within the 14-day return window */
export function isWithinReturnWindow(deliveryConfirmedAt: Date, now = new Date()): boolean {
  const windowEnd = new Date(deliveryConfirmedAt)
  windowEnd.setDate(windowEnd.getDate() + RETURN_WINDOW_DAYS)
  return now <= windowEnd
}
