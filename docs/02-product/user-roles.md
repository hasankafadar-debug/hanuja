# Son güncelleme: 2026-04-18
# Durum: taslak v1

# User Roles — Hanuja Marketplace

## Source of Truth

Role definitions derive from:
- `.claude/rules/09-seller-panel-rules.md`
- `.claude/rules/10-admin-panel-rules.md`
- `db/schema/schema.prisma` (UserRole enum, AdminActionType enum)
- `CLAUDE.md` section 2 (Non-negotiable business truths)

Schema-level roles: `customer`, `seller`, `admin` (UserRole enum).
Admin sub-roles are permission layers within the `admin` role, not separate schema values.
All server-side authorization must enforce ownership and role scope explicitly.

---

## 1. Customer

### What the customer can do
- Browse the storefront: categories, products, store pages, blog
- Add products to cart and complete checkout
- Pay via card (Iyzico) or bank transfer / EFT
- View own orders, order status, and shipment tracking
- Confirm delivery ("Teslim Aldım") — triggers `delivery_confirmed`, starts payout countdown
- Submit a return request within 14 days (fast-path); after 14 days requires admin evaluation
- Manage own account: addresses, profile, password
- View own order history and payment records

### What the customer cannot do
- See any seller financial data, ledger entries, or payout state
- See other customers' orders or personal data
- Approve or reject platform finance decisions
- Access the seller panel or admin panel
- Trigger a refund directly without a return or dispute workflow
- Mark delivery confirmed for another customer's order

---

## 2. Seller

### What the seller can do
- Manage own product catalog: create, edit, manage inventory and pricing
- Upload product images and manage product media
- View own orders — only after payment is confirmed by the platform
- Accept or reject an order (rejection requires a mandatory reason; penalty consequences apply)
- Enter shipment and tracking details for own orders
- View delivery status and delivery confirmation state for own orders
- See own payout summary: pending / hold-period / payout-ready / paid amounts
- See own deductions itemized: commission, cargo charge, ad/service fees, penalty offsets
- See own penalty history and waiver state
- Respond to return and dispute cases linked to own orders
- Manage seller account settings and public store profile fields
- Submit or update payout bank details (subject to security verification and delayed activation)

### What the seller cannot do
- See unpaid, unverified, or payment-failed orders as actionable fulfillment work
- Release or modify own payout hold state
- Waive own penalties
- See other sellers' catalog, orders, or finance data
- Access admin-only risk notes, fraud scoring, or internal moderation comments
- Mark delivery confirmed unilaterally (confirmation logic belongs to the platform)
- Close returns or disputes without going through the platform workflow
- Override platform lifecycle rules or order status transitions

---

## 3. Admin Sub-Roles

All sub-roles operate under the `admin` UserRole. Permission partitioning is enforced at the application layer.
Every high-impact admin action must record: actor, timestamp, target entity, previous state, new state, and reason.

### 3.1 Super Admin
**Scope:** Full platform access.

Inherits all sub-role capabilities plus:
- Edit protected platform configuration
- Grant or revoke admin permissions to other admin users
- Access complete audit logs without restriction

### 3.2 Finance Admin
**Scope:** Payment collection, payout operations, seller ledger, penalties, adjustments.

Permitted `AdminActionType` values:
`bank_transfer_approved`, `bank_transfer_rejected`, `payout_released`, `payout_blocked`,
`payout_hold_released`, `penalty_applied`, `penalty_waived`, `manual_ledger_adjustment`

Can do:
- Approve or reject EFT/bank transfer payment evidence
- Review payout readiness and release payout holds
- Block payout when risk or open review requires it
- Apply or waive seller penalties with mandatory reason
- Create manual ledger adjustments with actor attribution
- Review seller negative balances and offset carryover history
- Inspect commission, cargo, ad-fee, and refund breakdowns per order

Cannot do:
- Cancel orders or confirm delivery (operations-admin responsibility)
- Suspend or reactivate sellers (operations-admin responsibility)
- Approve or reject product listings (moderation-admin responsibility)

### 3.3 Operations Admin
**Scope:** Order lifecycle, delivery exceptions, fulfillment oversight, disputes.

Permitted `AdminActionType` values:
`order_cancelled`, `delivery_confirmed_manual`, `fulfillment_window_extended`,
`dispute_opened`, `dispute_resolved`, `return_approved`, `return_rejected`,
`seller_suspended`, `seller_activated`

Can do:
- Manually mark delivery confirmed when cargo evidence supports it
- Cancel orders after review with recorded reason
- Extend fulfillment review window with explicit decision and audit entry
- Open and resolve disputes; transition dispute state
- Approve or reject return requests
- Review delayed shipment cases and 20-day breach situations
- Suspend or reactivate seller accounts

Cannot do:
- Release or block payouts (finance-admin responsibility)
- Apply or waive penalties (finance-admin responsibility)
- Approve EFT payments (finance-admin responsibility)

### 3.4 Support Admin
**Scope:** View-only across orders, payments, sellers, and audit log. No state-mutating actions.

Can do:
- View order details, payment state, shipment state, return status, and dispute state
- View seller profile and account status summary
- Read audit log entries
- Send internal support notes where the platform communication model supports it

Cannot do:
- Approve payments, release payouts, or apply penalties
- Cancel orders, confirm delivery, or manage disputes
- Edit seller records or finance data
- Execute any `AdminActionType` that mutates persisted state

### 3.5 Moderation Admin
**Scope:** Product catalog quality and seller content review.

Can do:
- Approve, reject, or request revision for product listings
- Hide or unlist products that violate platform content rules
- Review seller store profile content for compliance
- Flag duplicate or policy-violating catalog entries

Cannot do:
- Access payout, penalty, or finance ledger data
- Cancel orders or manage disputes
- Suspend sellers (must escalate to operations-admin)
- Perform payment-related actions

---

## 4. Panel Access Matrix

| Surface | Customer | Seller | Finance Admin | Operations Admin | Support Admin | Moderation Admin | Super Admin |
|---------|----------|--------|--------------|-----------------|--------------|-----------------|-------------|
| `apps/web` storefront | Yes | Read-only | Read-only | Read-only | Read-only | Read-only | Yes |
| `apps/seller-panel` | No | Own data only | No | No | No | No | Yes |
| `apps/admin-panel` finance scope | No | No | Yes | No | View only | No | Yes |
| `apps/admin-panel` operations scope | No | No | No | Yes | View only | No | Yes |
| `apps/admin-panel` moderation scope | No | No | No | No | View only | Yes | Yes |

---

## 5. Cross-Reference

Role behavior must stay aligned with:
- `.claude/rules/05-security-rules.md` — least privilege and authorization rules
- `.claude/rules/07-marketplace-finance-rules.md` — finance operations per role
- `.claude/rules/08-order-lifecycle-rules.md` — lifecycle actions per role
- `docs/05-security/auth-authorization-plan.md`
- `docs/05-security/admin-action-policy.md`
- `docs/02-product/admin-journeys.md`
- `docs/02-product/seller-journeys.md`
- `docs/02-product/customer-journeys.md`
