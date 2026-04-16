/**
 * Delivery Confirmation Logic — 08-order-lifecycle-rules.md
 *
 * delivery_confirmed is DISTINCT from delivered.
 * Payout countdown starts ONLY from delivery_confirmed.
 *
 * Confirmation can come from:
 * 1. Explicit customer click ("Teslim Aldım")
 * 2. Admin manual confirmation after review
 * 3. Silent confirmation — delivered status + 72h with no customer objection
 * 4. Cargo integration delivery signal (treated as delivered, not confirmed)
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
 * Determine if an order is eligible for silent auto-confirmation.
 * Requires: status=delivered, 72 hours elapsed, no open return/dispute.
 */
export function isSilentConfirmationEligible(params: {
  deliveredAt: Date
  hasOpenReturn: boolean
  hasOpenDispute: boolean
  now?: Date
}): boolean {
  const now = params.now ?? new Date()

  if (params.hasOpenReturn || params.hasOpenDispute) return false

  const deadline = new Date(params.deliveredAt)
  deadline.setHours(deadline.getHours() + 72)
  return now >= deadline
}

/**
 * Build confirmation result for explicit customer confirmation.
 */
export function buildCustomerConfirmation(now = new Date()): DeliveryConfirmationResult {
  return { confirmed: true, source: 'customer_explicit', confirmedAt: now }
}

/**
 * Build confirmation result for admin-triggered confirmation.
 */
export function buildAdminConfirmation(now = new Date()): DeliveryConfirmationResult {
  return { confirmed: true, source: 'admin_manual', confirmedAt: now }
}

/**
 * Build confirmation result for silent auto-confirmation.
 * Only call this after isSilentConfirmationEligible returns true.
 */
export function buildSilentConfirmation(now = new Date()): DeliveryConfirmationResult {
  return { confirmed: true, source: 'silent_auto', confirmedAt: now }
}
