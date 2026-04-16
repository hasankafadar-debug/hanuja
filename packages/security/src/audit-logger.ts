/**
 * Audit log entry builder.
 * Returns a typed plain object ready for DB insertion (no DB dependency here).
 * The service/repository layer is responsible for persisting these entries.
 *
 * Every high-impact action — payout release, penalty waiver, EFT approval,
 * order cancellation by admin, dispute resolution — MUST produce an audit entry.
 */

// ── Action categories ─────────────────────────────────────────────────────────

export type AuditAction =
  // Payment
  | 'payment.eft_approved'
  | 'payment.eft_rejected'
  | 'payment.manual_confirmed'
  // Payout
  | 'payout.released'
  | 'payout.blocked'
  | 'payout.hold_released'
  // Penalty
  | 'penalty.applied'
  | 'penalty.waived'
  | 'penalty.reversed'
  // Order
  | 'order.cancelled_admin'
  | 'order.delivery_confirmed_manual'
  | 'order.fulfillment_extended'
  // Seller
  | 'seller.suspended'
  | 'seller.reactivated'
  | 'seller.bank_detail_changed'
  | 'seller.bank_detail_approved'
  // Return / Dispute
  | 'return.approved'
  | 'return.rejected'
  | 'dispute.resolved'
  | 'dispute.opened'
  // Finance
  | 'finance.manual_adjustment'
  // Auth
  | 'auth.admin_login'
  | 'auth.forced_logout'
  // Catalog
  | 'catalog.product_moderated'
  | 'catalog.product_hidden'

// ── Entry shape ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  action: AuditAction
  actorId: string
  actorRole: string
  targetEntityType: string
  targetEntityId: string
  previousState?: Record<string, unknown>
  newState?: Record<string, unknown>
  reason?: string
  note?: string
  ipAddress?: string
  userAgent?: string
  createdAt: Date
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildAuditEntryInput {
  action: AuditAction
  actorId: string
  actorRole: string
  targetEntityType: string
  targetEntityId: string
  previousState?: Record<string, unknown>
  newState?: Record<string, unknown>
  reason?: string
  note?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Builds a typed audit entry ready for DB insertion.
 *
 * @example
 * const entry = buildAuditEntry({
 *   action: 'penalty.waived',
 *   actorId: adminId,
 *   actorRole: 'admin',
 *   targetEntityType: 'Penalty',
 *   targetEntityId: penaltyId,
 *   reason: 'Sistem hatası nedeniyle muafiyet',
 * })
 * await prisma.adminAuditLog.create({ data: entry })
 */
export function buildAuditEntry(input: BuildAuditEntryInput): AuditEntry {
  return {
    ...input,
    createdAt: new Date(),
  }
}

// ── Convenience builders for common high-impact actions ───────────────────────

export function auditPayoutReleased(opts: {
  actorId: string
  payoutId: string
  sellerId: string
  amount: number
  reason?: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'payout.released',
    actorId: opts.actorId,
    actorRole: 'admin',
    targetEntityType: 'Payout',
    targetEntityId: opts.payoutId,
    newState: { sellerId: opts.sellerId, amount: opts.amount },
    ...(opts.reason ? { reason: opts.reason } : {}),
  })
}

export function auditPenaltyWaived(opts: {
  actorId: string
  penaltyId: string
  sellerId: string
  amount: number
  reason: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'penalty.waived',
    actorId: opts.actorId,
    actorRole: 'admin',
    targetEntityType: 'Penalty',
    targetEntityId: opts.penaltyId,
    previousState: { amount: opts.amount, status: 'active' },
    newState: { status: 'waived' },
    reason: opts.reason,
  })
}

export function auditEftApproved(opts: {
  actorId: string
  orderId: string
  evidenceNote?: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'payment.eft_approved',
    actorId: opts.actorId,
    actorRole: 'admin',
    targetEntityType: 'Order',
    targetEntityId: opts.orderId,
    ...(opts.evidenceNote ? { note: opts.evidenceNote } : {}),
  })
}

export function auditSellerSuspended(opts: {
  actorId: string
  sellerId: string
  reason: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'seller.suspended',
    actorId: opts.actorId,
    actorRole: 'admin',
    targetEntityType: 'Seller',
    targetEntityId: opts.sellerId,
    reason: opts.reason,
  })
}

export function auditBankDetailChanged(opts: {
  actorId: string
  sellerId: string
  maskedOldIban: string
  maskedNewIban: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'seller.bank_detail_changed',
    actorId: opts.actorId,
    actorRole: 'seller',
    targetEntityType: 'SellerBankDetail',
    targetEntityId: opts.sellerId,
    previousState: { iban: opts.maskedOldIban },
    newState: { iban: opts.maskedNewIban },
  })
}

export function auditManualFinanceAdjustment(opts: {
  actorId: string
  sellerId: string
  amount: number
  direction: 'credit' | 'debit'
  reason: string
}): AuditEntry {
  return buildAuditEntry({
    action: 'finance.manual_adjustment',
    actorId: opts.actorId,
    actorRole: 'admin',
    targetEntityType: 'SellerLedger',
    targetEntityId: opts.sellerId,
    newState: { amount: opts.amount, direction: opts.direction },
    reason: opts.reason,
  })
}
