/**
 * Delivery Confirmation Logic — 08-order-lifecycle-rules.md
 *
 * delivery_confirmed is DISTINCT from delivered.
 * Payout countdown starts ONLY from delivery_confirmed.
 *
 * New confirmations are admin-only. Source values retain historical record compatibility.
 */

export type ConfirmationSource =
  | 'customer_explicit'
  | 'admin_manual'
  | 'silent_auto'
  | 'cargo_integration'

export interface DeliveryConfirmationResult {
  confirmed: boolean
  source: ConfirmationSource
  confirmedAt: Date
}

/**
 * Build confirmation result for admin-triggered confirmation.
 */
export function buildAdminConfirmation(now = new Date()): DeliveryConfirmationResult {
  return { confirmed: true, source: 'admin_manual', confirmedAt: now }
}
