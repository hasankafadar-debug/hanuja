# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Penalty Policy

## Purpose

This document defines the seller penalty rules for the Hanuja marketplace.

It is the source of truth for when a penalty is applied, how it is calculated, how it is
recorded in the seller ledger, how it is offset from future payouts, and when and how it
can be waived by an admin.

Implementation in `api/services/payment.service.ts`, `api/domain/`, and `db/schema/schema.prisma`
must align with this document. The `Penalty` and `SellerLedgerEntry` models in the schema
directly reflect these rules.

---

## 1. Purpose of the Penalty System

Hanuja operates a central collection model. Customer payments are held by Hanuja and released
to sellers after delivery confirmation and a 30-day hold. This trust model requires sellers
to fulfill orders reliably.

The penalty system creates a financial consequence for two specific seller-side failures that
directly harm customers and Hanuja's operational integrity:

1. Rejecting a paid order that the seller was obligated to fulfill
2. Breaching the shipment commitment date and accruing daily late-shipment penalties

Penalties are not punitive in isolation. They are a structured financial offset mechanism
recorded in the seller's ledger and recovered from future payouts.

---

## 2. Standard Penalty Rate

**The standard penalty rate is 20% of the product amount.**

This rate is stored as a default in the `Penalty` schema:

```
Penalty.rate = 0.2000  // 20%
Penalty.penaltyAmount = Penalty.baseAmount * Penalty.rate
```

`baseAmount` is the product sale amount for the affected order line.

No alternative penalty rate may be used unless explicitly approved by a new policy document.
Do not invent custom rates for edge cases. If an exception is needed, use the admin waiver
flow described in section 6.

---

## 3. Trigger Case 1 — Seller Rejection of a Paid Order

If a seller rejects an order that has reached `payment_confirmed` status, a 20% penalty
is evaluated and normally applied.

### What constitutes rejection

The seller uses the rejection flow in the seller panel to decline to fulfill an order.
Rejection must include a mandatory reason selection.

Valid rejection reasons (stored as `PenaltyReason.seller_rejected_paid_order`):

- stock error
- pricing error
- production impossibility
- quality problem that makes fulfillment impossible
- technical issue
- force majeure

### What happens after rejection

1. Order status transitions to `cancelled_due_to_seller_rejection`
2. Customer receives a cancellation notification
3. Customer refund flow is triggered
4. A `Penalty` record is created with `reason = seller_rejected_paid_order`
5. A `SellerLedgerEntry` of type `penalty` is written, reducing seller balance
6. Admin sees the rejection reason and penalty outcome in order and finance views
7. The `AdminAuditLog` records the penalty application

The rejection and its financial consequence must never disappear from history.

---

## 4. Trigger Case 2 — Fulfillment Commitment Breach

The fulfillment commitment is **per product**: the seller enters `Product.fulfillmentDays`
(business days) as a **mandatory** field when creating the product. Made-to-order items may
carry longer commitments than stocked items; there is no flat platform-wide 20-day promise.

At order time the value is snapshotted to `OrderLine.promisedFulfillmentDays`, and the
deadline (`OrderLine.fulfillmentDueAt`) is stamped from payment confirmation using
business-day arithmetic.

Once the commitment date lapses, a 1% daily penalty accrues per overdue day. On the 20th
**overdue** day the order is auto-cancelled:

1. Order status transitions to `cancelled_due_to_20day_breach`
2. A `Penalty` record is created or updated with `reason = late_shipment_daily_accrual`
3. A `SellerLedgerEntry` of type `penalty` is written
4. Customer refund/cancellation finance flow is triggered
5. Seller payout eligibility is blocked for the affected order

This rule must be enforced in system logic, not only by support team memory. The breach
condition must be detected by the background job or service layer — not solely by manual admin
observation.

### Controlled extension

A 10-day extension of the fulfillment window may be granted, but only if:

- the customer has been made explicitly aware of the delay
- an admin has made a deliberate decision to extend
- the extension is recorded as an `AdminAuditLog` entry with `actionType = fulfillment_window_extended`

Silent extension of the window is not permitted. If an extension is not formally granted
and the shipment commitment date lapses, daily accrual starts and day 20 triggers auto-cancel.

---

## 5. How the Penalty Is Recorded

Penalties are not collected as a separate payment demand to the seller.

Default treatment:

1. A `Penalty` record is created with `status = applied`
2. A `SellerLedgerEntry` with `type = penalty` is written (negative amount, reduces balance)
3. The seller's running balance decreases immediately
4. At next payout eligibility, the outstanding penalty is subtracted from the net payout amount
5. If the payout amount is less than the penalty, the remaining penalty extends the seller's
   negative balance and is carried forward to future payouts

### Schema fields

The `Penalty` model stores:

| Field | Purpose |
|---|---|
| `sellerId` | Which seller this applies to |
| `orderId` | Which order triggered the penalty |
| `reason` | `seller_rejected_paid_order`, `late_shipment_daily_accrual`, or legacy `fulfillment_20day_breach` |
| `status` | `applied`, `waived`, or `offset` |
| `baseAmount` | Product sale amount |
| `rate` | `0.2000` (20%) |
| `penaltyAmount` | `baseAmount * rate` |
| `waivedBy` | Admin actor ID if waived |
| `waivedAt` | Timestamp of waiver |
| `waiverReason` | Mandatory reason if waived |
| `offsetPayoutId` | Which payout this penalty was recovered from |

---

## 6. Negative Balance

Seller balance can go negative as a result of penalties. This is permitted and expected.

When balance is negative:

- the negative balance is visible in the seller panel with contributing reasons
- the negative balance is visible in admin finance tools as a risk indicator
- future payouts automatically apply the outstanding balance as an offset before releasing funds
- admin actions that affect negative balance must be logged

A seller with a negative balance may still continue operating. The negative balance is a
financial obligation, not automatically a suspension trigger. Suspension is a separate
admin decision governed by seller management policy.

---

## 7. Admin Waiver Process

Admin may waive a penalty in exceptional circumstances. This is a controlled, auditable action.

### Valid waiver conditions

Waivers may be considered when there is evidence of:

- clear platform or system fault that caused the seller's failure
- natural disaster, force majeure, or documented supplier collapse
- incorrect product or category mapping by the platform that made fulfillment impossible
- other circumstances where applying the penalty would be demonstrably unjust

Waiver is not a routine action. It should not be used to reduce conflict with sellers
informally or to make the number look better.

### Waiver requirements

To waive a penalty, an admin must:

1. Have the required permission role for penalty waiver actions
2. Provide a mandatory written reason (`Penalty.waiverReason`)
3. Confirm the action through a confirmation step in the admin panel UI
4. The system records `waivedBy` (admin actor ID) and `waivedAt` (timestamp)
5. An `AdminAuditLog` record is created with `actionType = penalty_waived`

### What waiver does not do

Waiving a penalty does not erase the `Penalty` record.

The record remains in the database with `status = waived`. The original `penaltyAmount`,
`reason`, and full audit trail are preserved. The seller ledger receives a compensating
entry to reverse the deduction, but both the original deduction and the reversal entry
are visible.

**Penalty history is never deleted, even after a waiver.**

---

## 8. Seller Visibility of Penalties

Sellers must be able to see penalties that affect them.

### What sellers can see

- the order that triggered the penalty
- the penalty reason (seller-safe description, not internal-only language)
- the penalty amount
- the date the penalty was applied
- the current penalty status: `applied`, `waived`, or `offset`
- whether the penalty has been offset from a payout, and which payout
- if waived, that it was waived (reason detail is admin-only)

### What sellers cannot see

- internal admin notes used to decide waiver
- other sellers' penalties
- the identity of the admin who processed the waiver

---

## 9. Audit and History Requirements

Every penalty event must be traceable.

Events that must be logged:

| Event | Log location |
|---|---|
| Penalty applied | `Penalty` record created + `SellerLedgerEntry` of type `penalty` + `AdminAuditLog` of type `penalty_applied` |
| Penalty waived | `Penalty.status` updated to `waived` + compensating `SellerLedgerEntry` + `AdminAuditLog` of type `penalty_waived` |
| Penalty offset from payout | `Penalty.offsetPayoutId` set + `SellerLedgerEntry` of type `payout` reflecting the net |

No penalty event is allowed to happen without a corresponding ledger entry and, for admin
actions, an audit log entry.

---

## 10. Cross-Reference

This document must remain aligned with:

- `.claude/rules/07-marketplace-finance-rules.md` (source of truth for finance rules)
- `.claude/rules/08-order-lifecycle-rules.md` (seller rejection and 20-day breach lifecycle)
- `CLAUDE.md` sections 2.4, 15.3 (net ruling sentences 5 and 6)
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `db/schema/schema.prisma` — `Penalty`, `PenaltyStatus`, `PenaltyReason`, `SellerLedgerEntry`, `AdminAuditLog`

If penalty logic changes, update this document and the aligned files in the same work.
