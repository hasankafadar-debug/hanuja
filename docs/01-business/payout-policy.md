# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Payout Policy

## Purpose

This document defines the seller payout rules for the Hanuja marketplace.

It is the source of truth for when payout begins, what holds payout, how payout is released,
how payout batches are processed, and what sellers can see about their payout state.

Implementation in `api/services/payment.service.ts`, `api/jobs/`, and `db/schema/schema.prisma`
must align with this document. If code and this document conflict, resolve the conflict before
shipping — do not trust the code over this document without explicit approval.

---

## 1. Central Collection Model

All customer payments are collected by Hanuja, not by sellers.

This means:

- the customer pays Hanuja (via card or bank transfer / EFT)
- Hanuja holds the funds
- the seller is paid later, after conditions are met
- all deductions are applied by Hanuja before the seller receives anything

The seller never collects directly from the customer. Payout is the settlement Hanuja makes
to the seller after the full order lifecycle has been evaluated.

---

## 2. Payout Start Condition

**Payout countdown starts only when the order reaches `delivery_confirmed`.**

It does not start at:

- `shipped`
- `delivered`
- `payment_confirmed`
- any seller-side action

The distinction between `delivered` and `delivery_confirmed` is mandatory.

### What is `delivered`

The shipment physically appears to have reached the customer. Sources:

- cargo integration signals delivery
- tracking page indicates delivery
- admin manually verifies delivery evidence

### What is `delivery_confirmed`

Delivery is operationally accepted for payout countdown purposes. This occurs by:

1. Customer explicitly confirms receipt ("Teslim Aldım")
2. Admin manually confirms after reviewing evidence
3. Silent confirmation: 72 hours pass after `delivered` with no customer objection

Silent confirmation must be system-driven and timestamped, not left to manual follow-up.

The schema field `Order.deliveryConfirmedAt` is the authoritative timestamp from which the
30-day hold period is measured. The `Payout.holdStartedAt` field mirrors this value when
the payout record is created.

---

## 3. Mandatory 30-Day Hold Period

After `delivery_confirmed`, a **30-day hold** applies before payout can be released.

The hold end date is:

```
holdUntil = deliveryConfirmedAt + 30 days
```

This is stored in `Payout.holdUntil`.

During the hold period, the system evaluates:

- return risk and open return requests
- open disputes
- chargeback risk
- fraud review flags
- pending penalty deductions
- negative balance offsets from prior orders
- reconciliation concerns

A payout does not automatically become ready when the 30-day window closes. The hold expiry
is a minimum condition, not a sufficient condition. All blocking checks must also pass.

---

## 4. Payout Status Model

Payout status is tracked in the `Payout` model using `PayoutStatus`:

| Status | Meaning |
|---|---|
| `hold_active` | 30-day hold period is running |
| `payout_blocked` | Hold expired but a blocking condition exists |
| `payout_ready` | All conditions passed; eligible for payment |
| `payout_scheduled` | Included in a payout batch queued for processing |
| `payout_paid` | Payment has been sent to the seller's bank account |

Transitions must be recorded in `SellerLedgerEntry` and visible in admin finance tools.

---

## 5. Blocking Conditions

Payout must not be released to `payout_ready` when any of the following are true:

- there is an open return request (`ReturnRequest.status` not in a closed state)
- there is an open or unresolved dispute (`Dispute.payoutBlocked = true`)
- a fraud or chargeback review flag is active
- the seller has no active, verified bank detail (`SellerBankDetail.isActive = true AND isVerified = true`)
- there is an unresolved finance inconsistency or outstanding admin hold
- an applicable penalty has not yet been applied or offset

The `Payout.blockedReason` field must be populated with a human-readable explanation whenever
status is `payout_blocked`. This reason is visible to admins and at a summarized level to sellers.

---

## 6. Net Payout Formula

Seller payout is not simply a percentage of the order total.

The explicit formula is:

```
net_payout = gross_product_amount
           - commission_amount
           - coupon_share_amount
           - cargo_charge_amount
           - ad_fee_amount
           - penalty_amount
           - refund_amount
           - adjustment_amount (manual admin corrections)
```

Each component is stored as a separate field in the `Payout` model:

- `grossAmount`
- `commissionAmount`
- `couponShareAmount`
- `cargoChargeAmount`
- `adFeeAmount`
- `penaltyAmount`
- `refundAmount`
- `adjustmentAmount`
- `netAmount`

The `netAmount` must never be calculated as a single shortcut value. It must be derivable
from the individual fields above.

---

## 7. Seller Ledger

Every payout-related financial change must be recorded as a `SellerLedgerEntry`.

Ledger entries are immutable. No entry is overwritten; new entries are appended.

Relevant entry types for payout flows:

| `LedgerEntryType` | Description |
|---|---|
| `sale` | Gross sale amount credited when order is payment-confirmed |
| `commission` | Commission deducted |
| `cargo_charge` | Cargo fee deducted |
| `ad_fee` | Advertising or service fee deducted |
| `refund` | Refund amount deducted from pending payout |
| `penalty` | Penalty deducted |
| `manual_adjustment` | Admin correction applied with reason |
| `payout` | Final payout sent (negative, as funds leave the seller balance) |

The `balanceAfter` field on each entry records the running seller balance at the time of the
entry, making it possible to reconstruct history at any point in time.

---

## 8. Batch Payout Operations

Hanuja processes seller payouts in batches rather than individually per order.

Batch schedule options include: weekly, biweekly, or monthly. The active schedule is a
platform configuration decision and may change over time.

**The batch schedule does not override the 30-day order-level hold.**

An order whose hold period has not expired cannot be included in a batch, regardless of
when the batch runs.

Batch records are stored in `PayoutBatch`. Each batch has:

- a human-readable `reference` identifier
- `totalAmount` and counts
- `processedBy` (admin actor ID)
- `processedAt` timestamp

Each `Payout` record references its batch via `batchId` once it is scheduled.

Admin must be able to review batch candidates before execution and see which payouts
are ready and which are blocked, with reasons.

---

## 9. Admin Release Flow

Admin can intervene in payout state under specific conditions.

### Admin actions available

| Action | Requires |
|---|---|
| Release a blocked payout manually | `payout_released` audit log entry, permission-restricted role, reason |
| Block a payout that was ready | `payout_blocked` audit log entry, reason |
| Mark a payout as paid (outside batch) | Explicit admin action, reason |
| Apply a manual adjustment to payout | `manual_ledger_adjustment` log entry, reason |

All admin payout actions must create an `AdminAuditLog` record with:

- `actorId`
- `actionType` (`payout_released`, `payout_blocked`, `payout_hold_released`, etc.)
- `targetType = 'payout'`
- `targetId`
- `previousData` (previous status)
- `newData` (new status)
- `reason` (mandatory)

Admin cannot silently mutate payout state. No payout transition is allowed without an
auditable record.

---

## 10. Seller Visibility

Sellers must be able to see payout state clearly. A single wallet balance number is not
sufficient.

### What sellers can see

- pending earnings (hold period active, not yet eligible)
- hold-period earnings with expected hold release date
- payout-blocked amounts and a seller-safe explanation of why
- payout-ready amounts
- amounts included in a scheduled batch
- paid amounts with payout date
- deduction breakdown: commission, cargo, penalties, refunds, adjustments
- negative balance if it exists, with contributing reasons

Sellers cannot control payout state. They cannot release holds, remove blocks, or
modify payout calculations.

### Seller-visible payout timing

Where the hold release date is calculable, it must be shown to the seller:

```
Expected earliest payout eligibility: deliveryConfirmedAt + 30 days
```

This is not a guaranteed payment date. It is the earliest the hold can clear, subject
to all blocking condition checks also passing.

---

## 11. Negative Balance

Seller balance can go negative. This is allowed and expected in cases such as:

- a penalty applied after payout was already sent
- a refund finalized after payout was already sent
- a chargeback reversing funds after payout

When balance is negative:

- future payouts are automatically reduced by the outstanding negative balance
- the seller panel must show the negative balance clearly with contributing reasons
- admin panel must show negative balances as a risk/review indicator

---

## 12. EFT / Havale Channel Discount — Platform Absorption Rule

When a customer pays via Havale/EFT and the platform offers an EFT channel discount
(configured via `PlatformSettings.eftDiscountRate`), the discount amount is **absorbed
entirely by Hanuja**. It does not reduce the seller's payout.

### Rule

```
Order.eftDiscountAmount  → reduces customer-facing total only
Payout.grossAmount       → NOT reduced by eftDiscountAmount
Payout.netAmount         → NOT reduced by eftDiscountAmount
```

The seller receives the same gross payout they would have received if the customer had
paid by card at full price. The cost of the EFT incentive is Hanuja's expense.

### Rationale

EFT discounts are a Hanuja-controlled payment channel incentive to reduce card processing
costs. The seller is not party to this discount decision and must not bear its cost.

### Implementation constraint

`Order.eftDiscountAmount` is stored as a snapshot for audit and customer-facing display.
It must not be subtracted from `Payout.grossAmount` or `Payout.netAmount` in any payout
calculation. If payout logic is ever changed to account for EFT discount, this section of
this document must be updated first, with explicit approval.

### Commission base

EFT discount also does NOT affect the commission base. Commission is calculated on
`OrderLine.totalPrice` (KDV-inclusive, pre-discount gross). See `commission-policy.md`.

---

## 13. Cross-Reference

This document must remain aligned with:

- `.claude/rules/07-marketplace-finance-rules.md` (source of truth for finance rules)
- `.claude/rules/08-order-lifecycle-rules.md` (delivery_confirmed lifecycle)
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/reconciliation-process.md`
- `docs/06-engineering/event-status-model.md`
- `db/schema/schema.prisma` — `Payout`, `PayoutBatch`, `SellerLedgerEntry`, `AdminAuditLog`

If payout logic changes, update this document and the aligned files in the same work.
