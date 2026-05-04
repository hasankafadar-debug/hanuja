# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Ad Fee Policy

## Purpose

This document defines how Hanuja charges advertising and service fees to sellers, how those
fees are reflected in the seller ledger separately from order commission, and how they are
offset from future payouts.

"Ad fee" in this context covers any recurring or one-time service fee that Hanuja charges
to sellers outside of per-order commission. This includes but is not limited to:

- listing or shelf promotion fees
- featured placement fees
- sponsored product campaign charges
- platform service subscription fees (if applicable)
- any other seller-contracted service not covered by per-order commission

Coding agents must read this document before implementing any `ad_fee` ledger logic,
ad-fee deduction on payout, or admin tools related to seller service fee management.

---

## Core Rule

Ad fees are a named, separate deduction in the net payout formula:

```
net_payout = gross_product_amount
           - commission
           - coupon_share_effect
           - cargo_charge
           - ad_fee          ← this document governs this line
           - penalties
           - refunds
           - other_valid_offsets
```

Ad fees must never be merged into the commission field in the ledger or in any seller-facing
finance view. They are a distinct category with their own ledger entry type (`ad_fee`).

---

## Fee Types

### Recurring service fees

Recurring fees are charged on a defined schedule — weekly, monthly, or per billing cycle
agreed with the seller. Examples:

- monthly storefront listing fee
- monthly seller subscription (if a subscription tier model is in place)

These are applied as scheduled deductions regardless of order activity in that period.

### Campaign or promotion fees

Campaign fees are charged when a seller participates in or activates a promotion service:

- sponsored product impressions or clicks (CPC model)
- featured placement campaigns with a fixed fee
- homepage or banner placements

Campaign fees may be charged in arrears after the campaign period, or in advance as a
pre-paid deposit depending on the campaign structure.

### Invoice-linked deductions

Some ad fees are tied to a specific Hanuja-issued invoice. In this case, the deduction
must reference the invoice ID in the ledger entry so reconciliation is possible.

---

## Fee Source and Authorization

Ad fees charged to a seller must have a traceable origin:

- a signed or accepted campaign agreement
- an admin-initiated service activation record
- a system-generated scheduled billing event
- an explicit configuration in the seller's account settings

Ad fees must not be created silently in the ledger without an authorizing event. If a fee
appears in a seller's ledger, the seller must be able to see why it was charged.

---

## Seller Ledger Entry for Ad Fees

Every ad fee charge must be recorded as an individual ledger entry:

- `type`: `ad_fee`
- `amount`: negative value (deduction from seller balance)
- `referenceType`: `ad_campaign` or `service_invoice` or `billing_period` — whichever applies
- `referenceId`: ID of the campaign, invoice, or billing period record
- `description`: human-readable entry, for example "Öne Çıkarma Kampanyası — Nisan 2026"
- `createdAt`: timestamp of charge
- `createdBy`: system actor ID for scheduled charges, or admin actor ID for manual charges

Ad fee entries are immutable once written. If a charge was made in error, a correction is
a new `manual_adjustment` ledger entry with a positive amount and a reference to the
original entry — not a deletion or overwrite of the original entry.

---

## Deduction from Payout

Ad fees accumulate as deductions against the seller's current account balance.

### Before payout

When payout is being calculated for a ready order, any outstanding ad fee balance is
factored into the net payout:

- the `Payout.adFeeAmount` field records the ad fee portion deducted from that payout
- this deduction reduces `Payout.netAmount`

### When balance is insufficient

If the seller's total pending payout is insufficient to cover the outstanding ad fee debt,
the following applies:

- the payout is reduced to zero for that cycle
- the remaining ad fee debt carries forward into a negative balance
- the negative balance is visible in the seller panel and admin panel
- future payouts must offset the negative balance before the seller receives net cash

Negative seller balance is explicitly permitted under the current account model defined
in `CLAUDE.md` section 2.5.

### Scheduling

Ad fee deductions are applied at payout processing time, not at the moment the fee is
charged. The fee is written to the ledger when it is charged; the deduction from a specific
payout happens when that payout is processed.

---

## Invoice Relationship

Hanuja issues a service or advertising fee invoice to the seller for each charged fee.
This is separate from the per-order commission invoice.

- The seller receives a Hanuja-issued ad/service invoice.
- The invoice amount corresponds to the ledger entry amount.
- Invoice records must reference the same `referenceId` used in the ledger entry.

This invoice is Hanuja's legal basis for the charge.

---

## Admin Visibility Requirements

The admin panel must expose:

- per-seller ad fee history (amount, type, date, status)
- total outstanding ad fee debt per seller
- ad fee charges that contributed to a negative seller balance
- campaign or billing period summaries linked to fee charges
- ability to create a manual ad fee charge with required justification and audit trail

Admin-initiated manual ad fee charges must create an `AdminAuditLog` entry with:

- `actionType`: `manual_ledger_adjustment`
- `targetType`: `seller`
- `targetId`: the seller ID
- `reason`: required, non-empty
- `previousData` and `newData` reflecting the balance before and after

---

## Seller Visibility Requirements

The seller panel must show ad fees as a named, separate line in the finance summary:

- ad fee charges by period or campaign name
- total ad fee deducted in the current billing period
- total outstanding ad fee debt carried forward
- how ad fee debt affects the payout-ready amount

Do not hide ad fees inside a generic "deductions" total. Sellers must be able to see
the specific campaigns or services they were charged for.

---

## Separation from Commission

Ad fees are structurally different from per-order commission:

| Dimension | Commission | Ad Fee |
|-----------|-----------|--------|
| Trigger | Per payment-confirmed order line | Scheduled or campaign-based |
| Ledger type | `commission` | `ad_fee` |
| Invoice source | Hanuja commision invoice per order | Hanuja service/ad invoice per period or campaign |
| Payout field | `Payout.commissionAmount` | `Payout.adFeeAmount` |
| Seller panel label | "Komisyon" | "Reklam / Hizmet Ücreti" |

These must never be collapsed into the same field or label.

---

## Auditability Rules

- Every ad fee ledger entry must be traceable to an originating event (campaign, schedule, invoice).
- Manual admin-created charges require a reason and produce an audit log entry.
- Correction entries must reference the original entry they are correcting.
- Historical ad fee entries must not be deleted or overwritten.

---

## What Must Not Happen

- Do not add ad fee charges to the `commission` ledger field.
- Do not create ad fee ledger entries without a traceable origin event or reference ID.
- Do not deduct ad fees from a specific order's gross amount — they are account-level charges.
- Do not silently carry ad fee debt without making it visible in seller and admin views.
- Do not create an ad fee entry without a corresponding Hanuja-issued invoice or billing record.
- Do not apply a manual admin ad fee charge without an audit log entry.

---

## Cross-Reference Files

This document must stay aligned with:

- `CLAUDE.md` — section 2.3 (net payout formula), section 2.5 (current account model)
- `.claude/rules/07-marketplace-finance-rules.md` — ad/service fee rules, ledger principles
- `db/schema/schema.prisma` — `LedgerEntryType.ad_fee`, `Payout.adFeeAmount`, `SellerLedgerEntry`
- `docs/07-operations/payout-lifecycle.md` — how ad fees feed into payout net calculation
- `docs/07-operations/reconciliation-process.md` — invoice-to-ledger reconciliation expectations
- `docs/01-business/commission-policy.md` — separation between commission and ad fee

If ad fee billing logic, invoice structure, or ledger behavior changes, update this document
and the related operations docs in the same work.
