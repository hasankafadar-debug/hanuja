# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Database Schema — Hanuja Marketplace

Source of truth: `db/schema/schema.prisma`. ORM: Prisma. Database: PostgreSQL.

---

## Migration Strategy

All schema changes go through Prisma Migrate.

- `prisma migrate dev` — local development; generates and applies migration SQL, updates `db/migrations/`.
- `prisma migrate deploy` — CI/CD and production; applies pending migrations without interactive prompts.
- Never edit migration SQL files after they have been applied to any shared environment.
- Finance and lifecycle field changes require review of existing records before migration runs in production.
- Enum additions are backward-compatible; enum removals or renames require a data migration step.

---

## Design Principles

- **Append-only history tables** for order status, ledger entries, payment events, shipment events, and audit logs. No overwriting of past state.
- **Explicit financial fields** — gross, commission, cargo, penalty, refund, and net amounts stored separately on Payout. Never a single opaque total.
- **Timestamp discipline** — key lifecycle moments (`paymentConfirmedAt`, `deliveryConfirmedAt`, `holdUntil`, `paidAt`) are stored as dedicated columns, not derived from status strings.
- **Ownership enforced in queries** — all seller-scoped reads filter by `sellerId` on the server; no client-provided ownership shortcut.
- **Meilisearch is a read projection** — PostgreSQL is the source of truth for all finance and lifecycle state.

---

## Enums

### UserRole
`customer` | `seller` | `admin`

### SellerStatus
`pending` — onboarding submitted, awaiting review
`active` — approved and operational
`suspended` — temporarily blocked
`rejected` — onboarding rejected

### ProductStatus
`draft` | `pending_review` | `published` | `unlisted` | `rejected`

### OrderStatus
Payment states: `draft` | `checkout_started` | `payment_pending` | `bank_transfer_waiting` | `bank_transfer_confirmed` | `payment_confirmed` | `payment_failed` | `payment_cancelled`

Seller fulfillment states: `seller_queue_ready` | `seller_reviewing` | `seller_accepted` | `seller_rejected` | `preparing` | `awaiting_shipment`

Delivery states: `shipped` | `delivered` | `delivery_confirmation_pending` | `delivery_confirmed`

Cancellation states (cause-specific): `cancelled_by_customer` | `cancelled_by_admin` | `cancelled_due_to_payment_failure` | `cancelled_due_to_seller_rejection` | `cancelled_due_to_20day_breach`

Return and refund states: `return_requested` | `return_under_review` | `return_approved` | `return_rejected` | `return_in_transit` | `return_received` | `refund_pending` | `refund_completed`

Dispute states: `dispute_open` | `dispute_resolved`

### PaymentStatus
`pending` | `confirmed` | `failed` | `refunded` | `chargebacked` | `cancelled`

### PaymentMethod
`card` (Iyzico) | `eft` (manual admin approval required)

### ShipmentStatus
`preparing` | `handed_to_cargo` | `in_transit` | `out_for_delivery` | `delivered` | `delivery_failed` | `returned_to_sender`

### PayoutStatus
`hold_active` — 30-day hold period is running
`payout_blocked` — return, dispute, fraud, or admin hold is active
`payout_ready` — all conditions passed, eligible for payment
`payout_scheduled` — included in a PayoutBatch
`payout_paid` — payment has been transferred to seller

### PenaltyReason
`seller_rejected_paid_order` | `fulfillment_20day_breach` | `other`

### PenaltyStatus
`applied` | `waived` | `offset`

### ReturnRequestStatus
`requested` | `under_review` | `approved` | `rejected` | `in_transit` | `received` | `refund_completed`

### DisputeStatus
`open` | `under_review` | `resolved_for_customer` | `resolved_for_seller` | `closed`

### LedgerEntryType
`sale` — sale revenue credit
`commission` — commission debit
`cargo_charge` — cargo cost debit
`ad_fee` — advertising or service fee debit
`penalty` — penalty debit
`refund` — refund debit
`coupon_share` — coupon cost share debit
`eft_discount` — admin-approved EFT discount credit
`manual_adjustment` — admin manual correction (positive or negative)
`payout` — payout transfer debit (negative, money leaves ledger)
`chargeback` — chargeback debit
`dispute_hold` — amount held pending dispute resolution
`dispute_release` — hold released after dispute resolution

### AdminActionType
`payment_approved` | `payment_rejected` | `bank_transfer_approved` | `bank_transfer_rejected` | `order_cancelled` | `delivery_confirmed_manual` | `penalty_applied` | `penalty_waived` | `payout_released` | `payout_blocked` | `payout_hold_released` | `seller_suspended` | `seller_activated` | `seller_rejected` | `return_approved` | `return_rejected` | `dispute_opened` | `dispute_resolved` | `manual_ledger_adjustment` | `fulfillment_window_extended` | `seller_bank_detail_changed`

### MediaAssetType
`product_image` | `store_image` | `blog_image` | `dispute_evidence` | `return_evidence` | `invoice_document`

### CouponDiscountType
`percentage` | `fixed_amount`

### BlogPostStatus
`draft` | `published` | `archived`

---

## Models

### User
Central auth entity, managed by Better Auth. `role` determines which panel the user can access. Relations: `Seller` (one-to-one, only when role is seller), `orders`, `addresses`, `cart`, `notifications`.

### Session / Account / Verification
Better Auth session management tables. `Session.token` is validated server-side on every request. Not used for business logic directly.

### Seller
Links a `User` to marketplace seller identity. `slug` drives the `/magaza/<slug>` SEO route and must be unique. `status` gates seller panel access and product visibility. Relations: `SellerProfile`, `SellerBankDetail[]`, `SellerLedgerEntry[]`, `products[]`, `payouts[]`, `penalties[]`.

Indexes: `(status)` for admin queue queries, `(slug)` for storefront route resolution.

### SellerProfile
Extended public-facing seller data: `bio`, `story`, `logoUrl`, `bannerUrl`, `taxNumber`. `taxNumber` is masked in all non-admin views. One-to-one with `Seller`.

### SellerBankDetail
Stores seller IBAN and bank account information. `isActive` defaults to `false`; activation requires admin review or delayed system confirmation. `isVerified` tracks document verification state. Payout jobs read only active, verified bank details. Full IBAN must be encrypted at rest and unmasked only during payout processing. Every change to this record must produce an `AdminAuditLog` entry of type `seller_bank_detail_changed`.

Index: `(sellerId, isActive)` — payout job lookup.

### SellerLedgerEntry
**Append-only finance ledger.** Every financial movement against a seller account creates a new row. No updates, no deletes. `amount` is positive for credits (sale, dispute_release) and negative for debits (commission, penalty, payout). `balanceAfter` carries the running balance forward — each new entry's `balanceAfter` equals the previous entry's `balanceAfter` plus this entry's `amount`. This chain enables point-in-time balance reconstruction and full audit without aggregation queries. `referenceType` and `referenceId` link back to the source record (order, payout, penalty, etc.). `createdBy` records the admin actor ID when the entry originates from a manual action.

Indexes: `(sellerId, createdAt)` for chronological ledger views, `(referenceType, referenceId)` for tracing a specific record's ledger effect.

### Category
Self-referencing tree via `parentId`. `slug` drives `/kategori/<slug>` routes. `sortOrder` controls display order within a parent. Soft-delete via `isActive`.

### Product
`slug` drives `/urun/<slug>` routes. Only `published` products are returned in storefront queries. `price` and `compareAtPrice` use `Decimal` to avoid float rounding errors. Physical attributes (`weight`, `dimensionLength`, `dimensionWidth`, `dimensionHeight`) are stored for shipping calculations.

Indexes: `(sellerId, status)` for seller panel product list, `(categoryId, status)` for category page queries, `(slug)` for route resolution.

### OrderLine
Snapshot of product name, variant, and price at time of purchase. `commissionRate` and `commissionAmount` are locked at order creation time so later rate changes do not retroactively affect settled orders. `netPayoutAmount` = `totalPrice` minus `commissionAmount`; further deductions (cargo, ad fee, penalty) are applied at the `Payout` level.

### Order
`deliveryConfirmedAt` is the single most finance-critical timestamp — payout countdown starts from this value. `grossAmount`, `discountAmount`, `shippingAmount`, and `totalAmount` are stored as separate columns; no single opaque total. Status transitions are recorded in `OrderStatusHistory`.

Indexes: `(customerId, status)` for customer order list, `(status, createdAt)` for admin queue queries.

### OrderStatusHistory
Append-only record of every status transition. Stores `fromStatus`, `toStatus`, `actorId`, `actorRole`, and `reason`. Never overwritten. Provides the full audit trail needed for lifecycle disputes and operational investigation.

### Payment
One order may have multiple payment attempts. `providerData` stores the raw Iyzico response JSON for audit. EFT payments carry `eftConfirmedBy` (admin actor ID), `eftConfirmedAt`, and optional `eftDiscountAmount` for admin-approved partial discounts. `PaymentEvent` stores webhook callbacks and status change events, enabling idempotency checks and replay audit.

### Shipment
Seller creates one shipment record per fulfillment. `ShipmentEvent` records every status update from cargo integration or manual admin entry, with `source` field distinguishing origin (`cargo_integration` | `manual` | `admin`).

### Payout
One Payout record per order (optionally linked to a specific `OrderLine` via `orderLineId`). `holdStartedAt` equals `order.deliveryConfirmedAt`. `holdUntil` = `holdStartedAt + 30 days`. Finance breakdown columns directly implement the net payout formula:

`netAmount = grossAmount - commissionAmount - couponShareAmount - cargoChargeAmount - adFeeAmount - penaltyAmount - refundAmount +/- adjustmentAmount`

`blockedReason` must be populated whenever `status = payout_blocked` so admin and seller can see why payout is not progressing.

Indexes: `(sellerId, status)` for payout dashboard queries, `(holdUntil, status)` for the payout maturity BullMQ job.

### PayoutBatch
Groups multiple Payout records into a single admin-approved payment run. `reference` is a human-readable batch code. `processedBy` logs the admin actor ID. Partial batch failures must be traceable per individual Payout record.

### Penalty
`rate` defaults to `0.2000` (20%) per business rules. `baseAmount` is the product price at time of penalty. `penaltyAmount = baseAmount * rate`. Waived penalties keep the original record intact; `waivedBy`, `waivedAt`, and `waiverReason` are appended to the existing row. History is never deleted.

### ReturnRequest
`isWithinWindow` flags whether the request falls inside the 14-day statutory withdrawal period; this determines fast-path vs. admin-review handling. `refundAmount` may be partial. Evidence files are attached as `MediaAsset[]`.

### Dispute
`payoutBlocked` defaults to `true` — any open dispute automatically blocks payout eligibility. Resolution must be explicit via an admin action, which also clears the block when appropriate. `DisputeMessage` provides threaded conversation for all parties.

### AdminAuditLog
Append-only. Every high-impact admin action creates one entry. `previousData` and `newData` store JSON snapshots of the entity before and after the action. `reason` is required for high-impact action types. Indexes: `(actorId)`, `(targetType, targetId)`, `(actionType, createdAt)` for investigation queries.

### MediaAsset
References files stored in Cloudflare R2. `key` is the R2 storage key used for deletion and verification. `status` starts as `pending` and is set to `ready` by the media-processing job after R2 confirmation. Polymorphic attachment to `ReturnRequest` or `Dispute` via nullable foreign keys.

### Notification
User-scoped in-app notifications. `data` JSON carries action links or contextual payload. Indexes: `(userId, isRead)` for unread count queries, `(userId, createdAt)` for notification list.

### Coupon / CouponUsage
`CouponUsage` enforces per-user per-order uniqueness via a composite unique constraint. `usageCount` on `Coupon` is incremented atomically on successful application.

---

## Index Rationale Summary

| Index | Purpose |
|---|---|
| `sellers(status)` | Admin seller queue |
| `sellers(slug)` | Storefront route resolution |
| `products(sellerId, status)` | Seller panel product list |
| `products(categoryId, status)` | Category page listing |
| `orders(customerId, status)` | Customer order history |
| `orders(status, createdAt)` | Admin order queue |
| `payouts(sellerId, status)` | Seller and admin payout dashboard |
| `payouts(holdUntil, status)` | Payout maturity BullMQ job |
| `seller_ledger_entries(sellerId, createdAt)` | Chronological ledger view |
| `seller_bank_details(sellerId, isActive)` | Payout job bank detail lookup |
| `admin_audit_logs(targetType, targetId)` | Per-entity audit investigation |
| `admin_audit_logs(actionType, createdAt)` | Action-type audit queries |
