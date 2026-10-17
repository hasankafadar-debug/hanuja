# Son güncelleme: 2026-10-11 (satıcı Hanuja modeli: faturaya bağlı vade)
# Durum: taslak v2

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

**Satıcı Hanuja modeli (2026-10):** Hanuja is the seller of record in customer contracts; the seller
(designer/brand) is Hanuja's supplier. The seller invoices Hanuja for each order when shipping, and the
payout settles that invoice. Its amount equals the order's payout net before later returns (§6):
KDV-inclusive sale − seller coupon share − KDV-inclusive commission, at the product's KDV rate. Cargo is
included in the product price and is not on the invoice.

---

## 2. Payout Record and Preconditions

**The payout record is created only when the order reaches `delivery_confirmed`.** The payout term
itself runs from the approved seller invoice (§3).

A payout record is never created at:

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

Delivery is operationally accepted for payout purposes. This occurs by:

1. Customer explicitly confirms receipt ("Teslim Aldım")
2. Admin manually confirms after reviewing evidence
3. Silent confirmation: 72 hours pass after `delivered` with no customer objection

Silent confirmation must be system-driven and timestamped, not left to manual follow-up.

`Order.deliveryConfirmedAt` is the authoritative delivery timestamp. `Payout.holdStartedAt` mirrors
it when the payout record is created. Delivery confirmation is a precondition for payment; it no
longer starts the 30-day term.

---

## 3. Payout Term — Approved Seller Invoice + 30 Days, First Friday

The term starts from the invoice the seller issued to Hanuja, once an admin has approved it with its
invoice number and date (`OrderSellerInvoice.reviewStatus = approved`, `invoiceDate`):

```
dueDate = first Friday on or after (invoiceDate + PlatformSettings.payoutHoldDays)   // default 30
```

- Days are Europe/Istanbul calendar days.
- If that Friday is a public holiday, the next business day (`api/domain/tr-holidays.ts`).
- Examples: invoice Mon 7 Sep 2026 → 7 Oct (Wed) → **Fri 9 Oct**; invoice Sat 10 Oct 2026 → 9 Nov (Mon)
  → **Fri 13 Nov**; invoice Wed 1 Apr 2026 → Fri 1 May is a holiday → **Mon 4 May**.
- `invoiceDate` may not be in the future or before the order's payment date.
- Approval writes the due date to `Payout.holdUntil` (`syncInvoiceDueDate`); a rejection or a replaced
  invoice clears it. If the payout does not exist yet, `activateHold` reads the approved invoice when
  the order is delivery-confirmed. The `payout-maturity` job fills any missing due date.
- Implementation: `calculatePayoutDueDate` (`api/domain/payout-calculator.ts`),
  `readInvoicePayoutDueDate` / `readPayoutEligibility` (`api/services/payout-eligibility.ts`).

A payout matures only when **all** hold: the seller invoice is approved, the order is
`delivery_confirmed`, and the due date has been reached. If a blocker is open on the due date, it is
scheduled on the first Friday on or after all blockers clear (Friday itself is allowed;
a holiday Friday moves to the next business day). `holdUntil` retains the invoice due date,
while `nextPaymentAt` stores the resulting payment day. A new blocker clears only the unpaid
record's schedule; its removal persists the next eligible day. Worker retries, batches and
admin payment checks use that same stored day, so repeated checks never move it forward.
Settled records retain their dates.

Until then, the system evaluates:

- return risk and open return requests
- open disputes
- chargeback risk
- fraud review flags
- pending penalty deductions
- negative balance offsets from prior orders
- reconciliation concerns

A payout does not automatically become ready on its due date. The due date is a minimum condition,
not a sufficient condition. All blocking checks must also pass.

---

## 4. Payout Status Model

Payout status is tracked in the `Payout` model using `PayoutStatus`:

| Status | Meaning |
|---|---|
| `hold_active` | Waiting for the approved seller invoice and its due date |
| `payout_blocked` | Due date reached but a blocking condition exists |
| `payout_ready` | All conditions passed; eligible for payment |
| `payout_scheduled` | Included in a payout batch queued for processing |
| `payout_paid` | Payment has been sent to the seller's bank account |

Transitions must be recorded in `SellerLedgerEntry` and visible in admin finance tools.

---

## 5. Blocking Conditions

Payout must not be released to `payout_ready` when any of the following are true:

- the seller's invoice to Hanuja is missing, awaiting review or rejected ("Satıcının Hanuja'ya
  faturası onaylanmadı"), or its due date has not been reached ("Fatura vadesi dolmadı")
- delivery is not confirmed ("Teslim onayı bekleniyor")
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

### `couponShareAmount` — seller coupon cost

`Payout.couponShareAmount` is a **real deduction**, not a placeholder. When a customer uses a
seller coupon (`Coupon.sellerId` set), the coupon discount is distributed proportionally
across that seller's order lines into `OrderLine.couponDiscountAmount`, and:

```
Payout.couponShareAmount = sum(OrderLine.couponDiscountAmount)
```

At the line level:

```
OrderLine.netPayoutAmount = totalPrice − couponDiscountAmount − commissionAmount
```

The seller coupon also reduces the commission base (commission is charged on
`totalPrice − couponDiscountAmount`, KDV-inclusive). See `commission-policy.md`.

### Worked example

- `OrderLine.totalPrice` = `52.690,00 TL`
- Seller coupon allocated (`couponDiscountAmount`) = `5.269,00 TL`
- Commission rate `%15`, `commissionVatRate = 0.2000`

```
commissionBase   = 52.690,00 − 5.269,00               = 47.421,00 TL
commissionAmount = 47.421,00 × 0,15 × 1,20            =  8.535,78 TL
netPayoutAmount  = 52.690,00 − 5.269,00 − 8.535,78    = 38.885,22 TL
```

### Platform coupon and EFT discount exception

A platform coupon (`Coupon.sellerId` null) and the EFT channel discount
(`Order.eftDiscountAmount`) are absorbed by Hanuja. They do NOT populate
`couponShareAmount`, do NOT reduce `grossAmount`, and do NOT reduce `netAmount`. Line
snapshots remain at full price (see §12).

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

Payout creation and its accrual entries must commit together. Recording a bank
transfer must atomically commit the paid status, payout ledger debit and admin audit
record. Repeating the same transfer metadata is a no-op; conflicting transfer metadata
is rejected. Seller finance locks are acquired before reading mutable financial state,
in sorted seller-ID order for multi-seller transactions. Recovery may append missing
accruals but must not overwrite existing payout snapshots or valid ledger entries.

---

## 8. Batch Payout Operations

Hanuja processes seller payouts in batches rather than individually per order.

Batch schedule options include: weekly, biweekly, or monthly. The active schedule is a
platform configuration decision and may change over time.

**The batch schedule does not override the order-level invoice term (§3).**

An order whose due date has not been reached cannot be included in a batch, regardless of
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

Once the seller invoice is approved, the expected payout date is shown to the seller (order detail
and payout screens):

```
Expected payout date: dueDate (§3), or the next Friday if a blocker is still open
```

This is not a guaranteed payment date. It is the earliest the payout can be made, subject to delivery
confirmation and all blocking condition checks also passing.

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

### Admin EFT-approval manual discount exception

When admin approves an EFT payment, admin may enter an optional manual discount (kuruş, non-negative integer).
This discount is also **absorbed entirely by Hanuja** and does NOT reduce `Payout.grossAmount` or `Payout.netAmount`.
The admin discount is stored in `Payment.eftDiscountAmount` / `eftDiscountReason` (the channel discount stays
in `Order.eftDiscountAmount`); seller-side snapshots (`totalPrice`, `couponDiscountAmount`, commission,
`netPayoutAmount`) never change and sellers never see it. See `.claude/rules/07-marketplace-finance-rules.md`.

### Commission base

EFT discount (both channel and admin-manual) also does NOT affect the commission base. Commission is calculated on
`OrderLine.totalPrice` (KDV-inclusive, pre-discount gross). See `commission-policy.md`.

---

## 13. Commission Exemption — Payout Effect

Admin can exempt an individual order line from commission via
`POST /api/admin/order-lines/[id]/commission-exempt`, which stamps
`OrderLine.commissionExemptedAt / commissionExemptedBy / commissionExemptedReason`.
Those fields are the durable audit record of the decision.

### How exemption flows into payout

When the payout snapshot is created (`payout.service.activateHold`), each order line is
aggregated by `sumPayoutSnapshot`. A line whose `commissionExemptedAt` is set is treated as
follows:

```
exempt line commission contribution → 0  (removed from Payout.commissionAmount)
exempt line net contribution        → netPayoutAmount + original commissionAmount
gross                               → unchanged (exemption never touches gross)
```

The commission that was subtracted from `OrderLine.netPayoutAmount` at order creation is
added back, so the seller receives the un-commissioned amount for that line. The
`commission`-type `SellerLedgerEntry` written during hold activation only reflects the
commission of **non-exempt** lines. If every line of a seller is exempt, no `commission`
ledger entry is written.

### Hard rule — no exemption after a payout snapshot exists

Commission exemption **must be rejected once a `Payout` record exists for that
order + seller** (`409 CONFLICT`, message: "Hakediş kaydı oluşturulmuş siparişte komisyon
muafiyeti uygulanamaz"). At that point the commission is already locked into
`Payout.commissionAmount` / `Payout.netAmount`; exempting afterward would silently diverge
the payout from the ledger.

Post-payout compensation (e.g. crediting the commission back via an adjustment ledger entry
after payout) is intentionally **out of scope** and is not modeled. If that capability is
ever needed, it must be designed as an explicit, auditable adjustment flow and this section
updated first.

This mirrors the existing rule that an exemption is rejected once the line has been bound to
a commission invoice (`commissionInvoiceId`).

---

## 13.1 Card Installment Difference — Not Seller Revenue (2026-10-16)

With card installments the customer pays the installment difference ("vade farkı"):
`paidPrice = cash total + difference`. The difference is collected by Hanuja and is **not** part of the
seller's payout:

```
Payout.grossAmount  = OrderLine.totalPrice sum      (NOT increased by the installment difference)
Payout.netAmount    = formula in section 6          (NOT increased by the installment difference)
Commission base     = OrderLine.totalPrice − OrderLine.couponDiscountAmount (unchanged)
Seller invoice to Hanuja                            (unchanged; api/domain/seller-purchase-invoice.ts)
```

`OrderLine.customerPaidProductAmount` and `Order.customerPaidShippingAmount` include the installment share
(what the customer paid) and drive customer refunds only. A refunded installment share is funded by Hanuja
(`RefundTransaction.platformFundedAmount`) and never debits the seller ledger. Changing this policy requires
explicit approval and an update to `.claude/rules/07-marketplace-finance-rules.md` §5.

---

## 14. Cross-Reference

This document must remain aligned with:

- `.claude/rules/07-marketplace-finance-rules.md` (source of truth for finance rules)
- `.claude/rules/08-order-lifecycle-rules.md` (delivery_confirmed lifecycle)
- `docs/07-operations/invoice-management.md` (seller invoice review, customer invoice)
- `api/domain/seller-purchase-invoice.ts` (seller invoice amount)
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/reconciliation-process.md`
- `docs/06-engineering/event-status-model.md`
- `db/schema/schema.prisma` — `Payout`, `PayoutBatch`, `SellerLedgerEntry`, `AdminAuditLog`

If payout logic changes, update this document and the aligned files in the same work.
