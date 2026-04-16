/**
 * Role-based permission matrix.
 * Defines which actions each role is allowed to perform.
 * Use this as the single source of truth for authorization decisions.
 */

// ── Role definitions ──────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'seller' | 'admin' | 'support'

// ── Action definitions ────────────────────────────────────────────────────────

export type Action =
  // Order actions
  | 'order:view_own'
  | 'order:view_all'
  | 'order:cancel_own'
  | 'order:cancel_admin'
  | 'order:accept_seller'
  | 'order:reject_seller'
  | 'order:view_seller_queue'
  // Payment actions
  | 'payment:view_own'
  | 'payment:view_all'
  | 'payment:approve_eft'
  | 'payment:reject_eft'
  | 'payment:confirm_manual'
  // Payout actions
  | 'payout:view_own'
  | 'payout:view_all'
  | 'payout:release'
  | 'payout:block'
  | 'payout:release_hold'
  // Penalty actions
  | 'penalty:view_own'
  | 'penalty:view_all'
  | 'penalty:apply'
  | 'penalty:waive'
  // Catalog actions
  | 'catalog:view_public'
  | 'catalog:manage_own'
  | 'catalog:manage_all'
  | 'catalog:moderate'
  // Seller management
  | 'seller:view_own_profile'
  | 'seller:update_own_profile'
  | 'seller:view_all'
  | 'seller:suspend'
  | 'seller:reactivate'
  | 'seller:update_bank_detail'
  // Return / dispute actions
  | 'return:request'
  | 'return:view_own'
  | 'return:view_all'
  | 'return:review_seller'
  | 'return:approve_admin'
  | 'return:reject_admin'
  | 'dispute:open'
  | 'dispute:view_own'
  | 'dispute:view_all'
  | 'dispute:resolve'
  // Shipment actions
  | 'shipment:create_seller'
  | 'shipment:view_own'
  | 'shipment:view_all'
  // Finance admin actions
  | 'finance:view_summary'
  | 'finance:adjust_manual'
  | 'finance:view_ledger_own'
  | 'finance:view_ledger_all'
  // Audit
  | 'audit:view'
  // Admin user management
  | 'admin:manage_admins'

// ── Permission matrix ─────────────────────────────────────────────────────────

const PERMISSIONS: Record<UserRole, Set<Action>> = {
  customer: new Set<Action>([
    'order:view_own',
    'order:cancel_own',
    'payment:view_own',
    'catalog:view_public',
    'return:request',
    'return:view_own',
    'dispute:open',
    'dispute:view_own',
    'shipment:view_own',
  ]),

  seller: new Set<Action>([
    'catalog:view_public',
    'catalog:manage_own',
    'order:view_seller_queue',
    'order:accept_seller',
    'order:reject_seller',
    'shipment:create_seller',
    'shipment:view_own',
    'payout:view_own',
    'penalty:view_own',
    'return:view_own',
    'return:review_seller',
    'dispute:view_own',
    'finance:view_ledger_own',
    'seller:view_own_profile',
    'seller:update_own_profile',
    'seller:update_bank_detail',
  ]),

  support: new Set<Action>([
    'catalog:view_public',
    'order:view_all',
    'payment:view_all',
    'return:view_all',
    'dispute:view_all',
    'shipment:view_all',
    'seller:view_all',
    'payout:view_all',
    'penalty:view_all',
    'finance:view_summary',
    'finance:view_ledger_all',
  ]),

  admin: new Set<Action>([
    // All support permissions
    'catalog:view_public',
    'catalog:manage_all',
    'catalog:moderate',
    'order:view_all',
    'order:cancel_admin',
    'payment:view_all',
    'payment:approve_eft',
    'payment:reject_eft',
    'payment:confirm_manual',
    'payout:view_all',
    'payout:release',
    'payout:block',
    'payout:release_hold',
    'penalty:view_all',
    'penalty:apply',
    'penalty:waive',
    'seller:view_all',
    'seller:suspend',
    'seller:reactivate',
    'return:view_all',
    'return:approve_admin',
    'return:reject_admin',
    'dispute:view_all',
    'dispute:resolve',
    'shipment:view_all',
    'finance:view_summary',
    'finance:adjust_manual',
    'finance:view_ledger_all',
    'audit:view',
    'admin:manage_admins',
  ]),
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks whether a role has permission to perform an action.
 */
export function can(role: UserRole, action: Action): boolean {
  return PERMISSIONS[role]?.has(action) ?? false
}

/**
 * Returns all actions permitted for a role.
 */
export function permissionsFor(role: UserRole): Action[] {
  return [...(PERMISSIONS[role] ?? [])]
}

/**
 * Asserts that a role has permission to perform an action.
 * Throws a structured error if the check fails — suitable for use in route handlers.
 */
export function assertCan(role: UserRole, action: Action): void {
  if (!can(role, action)) {
    throw new PermissionDeniedError(role, action)
  }
}

export class PermissionDeniedError extends Error {
  readonly role: UserRole
  readonly action: Action

  constructor(role: UserRole, action: Action) {
    super(`Role '${role}' is not permitted to perform '${action}'`)
    this.name = 'PermissionDeniedError'
    this.role = role
    this.action = action
  }
}
