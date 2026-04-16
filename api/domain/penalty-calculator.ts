/**
 * Penalty Calculator — 07-marketplace-finance-rules.md, CLAUDE.md 2.4
 *
 * Standard penalty rate: 20% of product amount.
 * Platform business constants (CLAUDE.md 15.3).
 * Do not change these values without documented policy approval.
 */
import { Decimal } from '@prisma/client/runtime/client'

// Platform constants — CLAUDE.md 15.3
export const STANDARD_PENALTY_RATE = new Decimal('0.2000') // 20%
export const FULFILLMENT_DAYS = 20 // 20-day shipment commitment
export const PAYOUT_HOLD_DAYS = 30 // 30-day hold after delivery_confirmed
export const RETURN_WINDOW_DAYS = 14 // 14-day right-of-withdrawal
export const SILENT_DELIVERY_CONFIRMATION_HOURS = 72 // 72-hour auto-confirm
export const FULFILLMENT_EXTENSION_DAYS = 10 // Optional 10-day extension (admin only)

/**
 * Calculate penalty amount.
 * Default rate is 20% — override only with explicit policy approval.
 */
export function calculatePenalty(
  productAmount: Decimal,
  rate: Decimal = STANDARD_PENALTY_RATE,
): Decimal {
  return productAmount.mul(rate).toDecimalPlaces(2)
}

/** Returns true if the 20-day fulfillment deadline has passed */
export function isFulfillmentDeadlineBreached(
  paymentConfirmedAt: Date,
  now = new Date(),
): boolean {
  const deadline = new Date(paymentConfirmedAt)
  deadline.setDate(deadline.getDate() + FULFILLMENT_DAYS)
  return now > deadline
}

/** Returns the 20-day fulfillment deadline date */
export function getFulfillmentDeadline(paymentConfirmedAt: Date): Date {
  const deadline = new Date(paymentConfirmedAt)
  deadline.setDate(deadline.getDate() + FULFILLMENT_DAYS)
  return deadline
}

/** Returns the optional extended deadline (admin-granted 10-day extension) */
export function getExtendedFulfillmentDeadline(paymentConfirmedAt: Date): Date {
  const deadline = new Date(paymentConfirmedAt)
  deadline.setDate(deadline.getDate() + FULFILLMENT_DAYS + FULFILLMENT_EXTENSION_DAYS)
  return deadline
}

/** Returns true if delivery_confirmed is within the 14-day return window */
export function isWithinReturnWindow(
  deliveryConfirmedAt: Date,
  now = new Date(),
): boolean {
  const windowEnd = new Date(deliveryConfirmedAt)
  windowEnd.setDate(windowEnd.getDate() + RETURN_WINDOW_DAYS)
  return now <= windowEnd
}

/** Returns the deadline for silent delivery confirmation (delivered + 72h) */
export function getSilentConfirmDeadline(deliveredAt: Date): Date {
  const deadline = new Date(deliveredAt)
  deadline.setHours(deadline.getHours() + SILENT_DELIVERY_CONFIRMATION_HOURS)
  return deadline
}

/** Returns true if silent confirmation deadline has passed since delivery */
export function isSilentConfirmDue(deliveredAt: Date, now = new Date()): boolean {
  return now >= getSilentConfirmDeadline(deliveredAt)
}
