# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Admin Action Policy

## Purpose

This document maps each high-impact admin action to its required permission level,
confirmation requirements, and the audit log fields that must be written.

Source of truth for permission enforcement: `packages/security/src/permission-matrix.ts`
Source of truth for audit entry shape: `packages/security/src/audit-logger.ts`
Related schema: `AdminAuditLog` in `db/schema/schema.prisma`

---

## Permission Levels

The platform uses a single `admin` role in the current permission matrix. Within
that role, the following functional tiers apply for documentation and UI control
purposes. These tiers must be enforced at the service layer, not only in the UI.

| Tier | Label | Description |
|---|---|---|
| T1 | super-admin | Full access; can perform all actions below |
| T2 | finance-admin | Finance, payout, penalty, ledger adjustment |
| T3 | ops-admin | Order lifecycle, delivery, fulfillment, seller management |
| T4 | support-admin | Read-only access plus return and dispute participation |

The current `permission-matrix.ts` grants all listed actions to the `admin` role.
When sub-role differentiation is implemented, the permission matrix must be updated
before any UI enforcement is added.

---

## High-Impact Action Reference

Each section below covers one high-impact action. Fields listed under
"Audit log fields written" correspond to `AuditEntry` from `audit-logger.ts`
and to `AdminActionType` enum values in `schema.prisma`.

---

### 1. Payout Release

**Permission required:** T1 (super-admin) or T2 (finance-admin)
**Permission matrix action:** `payout:release`
**Confirmation step:** Admin must review payout detail screen showing hold period
end date, open return status, open dispute status, and seller bank detail
verification state before confirming. A "Release Payout" button must not be
accessible unless all blocking checks pass.

**Reason required:** Recommended; required when releasing ahead of standard maturity.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `payout_released` |
| `targetType` | `Payout` |
| `targetId` | payout ID |
| `previousData` | `{ status: 'payout_ready' }` |
| `newData` | `{ status: 'payout_paid', sellerId, amount }` |
| `reason` | If provided |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |
| `ipAddress` | Request IP |

Use convenience builder: `auditPayoutReleased()`.

---

### 2. Penalty Waiver

**Permission required:** T1 (super-admin) or T2 (finance-admin)
**Permission matrix action:** `penalty:waive`
**Confirmation step:** Admin must see the original penalty amount, the triggering
order, and the seller ledger impact before confirming. Confirmation dialog must
display: "This waiver will credit the seller's ledger. This action is permanent."

**Reason required:** Yes — mandatory. Minimum 10 characters. Waiver must not
proceed without a reason string stored in the audit log.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `penalty_waived` |
| `targetType` | `Penalty` |
| `targetId` | penalty ID |
| `previousData` | `{ amount, status: 'active' }` |
| `newData` | `{ status: 'waived' }` |
| `reason` | Waiver justification (mandatory) |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

Use convenience builder: `auditPenaltyWaived()`.

The original `penalty_applied` audit row is preserved. Waiver creates a new row.

---

### 3. EFT / Havale Approval

**Permission required:** T1 or T2 (finance-admin)
**Permission matrix action:** `payment:approve_eft`
**Confirmation step:** Admin must view the EFT detail screen showing sender name,
transfer amount, reference number, and evidence note before clicking "Approve."
Approval must be a dedicated action, not an inline table toggle.

**Reason required:** No. Evidence note is recorded in the `note` field.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `bank_transfer_approved` |
| `targetType` | `Order` |
| `targetId` | order ID |
| `newData` | `{ status: 'bank_transfer_confirmed' }` |
| `note` | Evidence note or transfer reference |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

Use convenience builder: `auditEftApproved()`.

**EFT rejection** follows the same structure. Use `bank_transfer_rejected` as
`actionType`. Reason required if customer is to be informed.

---

### 4. Order Cancellation by Admin

**Permission required:** T1 (super-admin) or T3 (ops-admin)
**Permission matrix action:** `order:cancel_admin`
**Confirmation step:** Admin must see order status, seller assignment, and finance
impact summary before confirming. If payment was confirmed, the screen must show
refund path and whether a seller penalty applies.

**Reason required:** Yes — mandatory. Reason is shown to seller and triggers
penalty evaluation logic in the service layer.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `order_cancelled` |
| `targetType` | `Order` |
| `targetId` | order ID |
| `previousData` | `{ status: <previous order status> }` |
| `newData` | `{ status: 'cancelled_by_admin' }` |
| `reason` | Admin's stated reason (mandatory) |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

---

### 5. Manual Delivery Confirmation Override

**Permission required:** T1 (super-admin) or T3 (ops-admin)
**Permission matrix action:** `order:cancel_admin` (delivery confirmation override
is not separately gated in current matrix; service layer must enforce admin session)
**Confirmation step:** Admin must confirm the order is in `delivered` or
`delivery_confirmation_pending` state before the override proceeds. Screen must
warn: "This will start the 30-day payout hold countdown."

**Reason required:** Recommended. Required if cargo integration shows no delivery signal.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `delivery_confirmed_manual` |
| `targetType` | `Order` |
| `targetId` | order ID |
| `previousData` | `{ status: 'delivered' }` |
| `newData` | `{ status: 'delivery_confirmed', deliveryConfirmedAt }` |
| `reason` | Optional; required if cargo shows no delivery signal |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

---

### 6. Seller Suspension

**Permission required:** T1 (super-admin) or T3 (ops-admin)
**Permission matrix action:** `seller:suspend`
**Confirmation step:** Admin must see seller's active order count and pending
payout balance before confirming. Screen must warn: "Active orders will remain
assigned to this seller. Payout will be blocked until seller is reactivated."

**Reason required:** Yes — mandatory.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `seller_suspended` |
| `targetType` | `Seller` |
| `targetId` | seller ID |
| `previousData` | `{ status: 'active' }` |
| `newData` | `{ status: 'suspended' }` |
| `reason` | Suspension justification (mandatory) |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

Use convenience builder: `auditSellerSuspended()`.

**Seller reactivation** (`seller:reactivate`) follows the same structure with
`seller_activated` as `actionType`. Reason recommended but not mandatory.

---

### 7. Seller Bank Detail Approval

**Permission required:** T1 (super-admin) or T2 (finance-admin)
**Permission matrix action:** `seller:view_all` (read) and `finance:adjust_manual` (approve)
**Confirmation step:** Admin must view masked old IBAN and masked new IBAN side by
side. Screen must warn: "Approving this change will make the new account the
target for future payouts." Admin must not see unmasked IBAN values.

**Reason required:** No. IBAN values appear masked in `previousData` / `newData`.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `seller_bank_detail_changed` |
| `targetType` | `SellerBankDetail` |
| `targetId` | seller ID |
| `previousData` | `{ iban: maskIban(oldIban) }` |
| `newData` | `{ iban: maskIban(newIban), approvedAt }` |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

Use `maskIban()` from `packages/security/src/data-masker.ts` before passing
values to `auditBankDetailChanged()`.

Seller-initiated IBAN change (without admin approval step) also uses
`seller.bank_detail_changed` and `actorRole: 'seller'` per `auditBankDetailChanged()`.

---

### 8. Manual Finance Adjustment (Ledger Credit / Debit)

**Permission required:** T1 (super-admin) or T2 (finance-admin)
**Permission matrix action:** `finance:adjust_manual`
**Confirmation step:** Admin must specify direction (`credit` or `debit`), amount,
and reason before confirming. Screen must show the seller's current ledger balance
and the projected balance after the adjustment.

**Reason required:** Yes — mandatory. Minimum 10 characters. Vague reasons such
as "correction" are not acceptable; the reason must reference the originating
order, dispute, or policy exception.

**Audit log fields written:**

| Field | Value |
|---|---|
| `actionType` | `manual_ledger_adjustment` |
| `targetType` | `SellerLedger` |
| `targetId` | seller ID |
| `newData` | `{ amount, direction: 'credit' | 'debit' }` |
| `reason` | Adjustment justification with reference (mandatory) |
| `actorId` | Admin user ID |
| `actorRole` | `admin` |

Use convenience builder: `auditManualFinanceAdjustment()`.

---

### 9. Return Resolution

**Permission required:** T1, T2, or T3
**Permission matrix actions:** `return:approve_admin`, `return:reject_admin`
**Confirmation step:** Admin must view return reason, seller response, and payout
block status before resolving. Approval triggers refund path. Rejection must
capture reason shown to customer.

**Reason required:** Yes for rejection. Optional for approval.

**Audit log fields written (approval):**

| Field | Value |
|---|---|
| `actionType` | `return_approved` |
| `targetType` | `Order` |
| `targetId` | order ID |
| `newData` | `{ status: 'return_approved', refundPath }` |
| `actorId` | Admin user ID |

**Audit log fields written (rejection):**

| Field | Value |
|---|---|
| `actionType` | `return_rejected` |
| `targetType` | `Order` |
| `targetId` | order ID |
| `newData` | `{ status: 'return_rejected' }` |
| `reason` | Rejection reason (mandatory) |
| `actorId` | Admin user ID |

---

## Permission Matrix Enforcement Status

Historically, `packages/security/src/permission-matrix.ts` defined 75+ actions
but no route called `can()` / `assertCan()` — admin routes enforced authorization
with an inline `if (session.user.role !== 'admin') throw new ForbiddenError()`
check instead. As of 2026-07-03, the following six finance-critical admin routes
call the matrix directly through `assertRoleCan()` (`api/lib/authorize.ts`), which
wraps `assertCan()` and rethrows a `ForbiddenError` (403) on denial so the
existing `handleError()` route error handler maps it correctly:

| Route | Permission matrix action |
|---|---|
| `POST /api/admin/payouts/[id]/release` | `payout:release` |
| `POST /api/admin/payments/eft/[orderId]/approve` | `payment:approve_eft` |
| `POST /api/admin/payments/eft/[orderId]/reject` | `payment:reject_eft` |
| `POST /api/admin/penalties/[id]/waive` | `penalty:waive` |
| `POST /api/admin/orders/[id]/penalties` | `penalty:apply` |
| `POST /api/admin/order-lines/[id]/commission-exempt` | `finance:adjust_manual` |

**Behavior today is unchanged.** The matrix currently grants every one of these
actions only to the `admin` role (see the T1–T4 tiers above, which are all
collapsed into `admin` in the matrix), so these routes still 403 any non-admin
session exactly as the old inline check did. The `401` (no session) check is
untouched and still runs before the permission check in every route.

**Why this matters going forward:** when finance/support role separation is
implemented (e.g. a distinct `finance` or a real `support` role that should be
able to view but not release payouts), the change is contained entirely to
`PERMISSIONS` in `permission-matrix.ts` — for example moving `payout:release`
out of a new `finance-viewer` role's set. No route code needs to change because
the routes already assert the specific action, not a role string. This is the
concrete first step toward the T1–T4 tier model documented above becoming real
matrix data instead of only documentation.

The remaining admin routes not listed above still use the inline
`role !== 'admin'` check and have not yet been migrated to `assertRoleCan()`.
Migrating them is out of scope for this change; when a route is migrated, add
it to the table above in the same change.

Test coverage: `tests/security/admin-permission-matrix.test.ts` verifies
`can()`/`assertCan()` for all six actions across `admin`, `seller`, `customer`,
and `support`, and includes a route-level example
(`POST /api/admin/payouts/[id]/release`) confirming a `seller` session gets
403 while an `admin` session succeeds.

---

## General Rules Applying to All Actions

1. Every action in this document must produce an `AdminAuditLog` row in the
   same database transaction as the state mutation. If the audit write fails,
   the state mutation must be rolled back.

2. The `ipAddress` field should be populated from the request context for all
   actions performed through the admin panel UI.

3. `previousData` and `newData` must never contain raw IBAN, card numbers,
   Turkish ID, or passwords. Use masking helpers from `data-masker.ts`.

4. Reason strings are stored verbatim. Do not truncate or sanitize beyond
   standard SQL safe encoding.

5. Actions performed by background jobs (not an admin actor) must still produce
   an audit row with `actorId` set to a named system identifier such as
   `'system:payout-job'` and `actorRole` set to `'system'`.

---

## Cross-Reference

- `packages/security/src/permission-matrix.ts` — action permission enforcement
- `packages/security/src/audit-logger.ts` — audit entry builders
- `packages/security/src/data-masker.ts` — masking helpers for sensitive fields
- `db/schema/schema.prisma` — `AdminAuditLog` model, `AdminActionType` enum
- `.claude/rules/05-security-rules.md` — security rules governing admin authority
- `.claude/rules/10-admin-panel-rules.md` — admin panel action design rules
- `docs/05-security/audit-logging-plan.md` — full audit log format specification
- `docs/07-operations/payout-lifecycle.md` — payout readiness checks before release
- `docs/01-business/penalty-policy.md` — penalty rate and waiver conditions
