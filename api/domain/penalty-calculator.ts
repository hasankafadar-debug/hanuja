/**
 * Penalty Calculator — 07-marketplace-finance-rules.md, CLAUDE.md 2.4
 *
 * Standard penalty rate: 20% of product amount.
 * Platform business constants (CLAUDE.md 15.3).
 * Do not change these values without documented policy approval.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { addBusinessDays, countBusinessDaysBetween } from './business-days'

// Platform constants — CLAUDE.md 15.3
export const STANDARD_PENALTY_RATE = new Decimal('0.2000') // 20%
export const DAILY_LATE_SHIPMENT_PENALTY_RATE = new Decimal('0.0100') // 1%
export const FULFILLMENT_DAYS = 20 // 20-business-day shipment commitment
export const PAYOUT_HOLD_DAYS = 30 // 30-day hold after delivery_confirmed
export const RETURN_WINDOW_DAYS = 14 // 14-day right-of-withdrawal
export const SILENT_DELIVERY_CONFIRMATION_HOURS = 72 // 72-hour auto-confirm
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

export function calculateDailyLateShipmentPenalty(
  orderAmount: Decimal,
  breachDayCount: number,
  dailyRate: Decimal = DAILY_LATE_SHIPMENT_PENALTY_RATE,
): Decimal {
  if (breachDayCount <= 0) return new Decimal(0)
  return roundMoney(orderAmount.mul(dailyRate).mul(breachDayCount))
}

export function getLateShipmentPenaltyRate(
  breachDayCount: number,
  dailyRate: Decimal = DAILY_LATE_SHIPMENT_PENALTY_RATE,
): Decimal {
  if (breachDayCount <= 0) return new Decimal(0)
  return dailyRate.mul(breachDayCount).toDecimalPlaces(4)
}

/**
 * Count overdue business days between the deadline and `asOf`.
 * Weekends and Turkish official holidays do not contribute to the breach count.
 */
export function getLateShipmentBreachDayCount(deadlineAt: Date, asOf = new Date()): number {
  return countBusinessDaysBetween(deadlineAt, asOf)
}

/** Returns true if the 20-business-day fulfillment deadline has passed. */
export function isFulfillmentDeadlineBreached(
  paymentConfirmedAt: Date,
  now = new Date(),
): boolean {
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
