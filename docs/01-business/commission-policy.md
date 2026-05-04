# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Commission Policy

## Purpose

This document defines how Hanuja calculates and applies seller commission on every
payment-confirmed order line. It is the source of truth for commission resolution order,
rate storage, calculation method, and the invoice relationship between Hanuja and sellers.

Coding agents must read this document before implementing or changing any commission
calculation, rate lookup, or `commissionRate` / `commissionAmount` field logic.

---

## Commission Resolution Order

When calculating the commission rate for an order line, use the first rate that exists
in the following priority chain. Do not skip levels.

### Level 1 — Product-specific override rate

If the product record carries an explicit commission rate that was set by admin for that
specific product, use it.

Use case: special merchandising deals, introductory promotions for a product, or
compliance-required rate adjustments for specific SKUs.

Storage: attached to the product record or a product-commission override table.
Implementation note: the current schema stores `commissionRate` directly on `OrderLine`
at checkout time. The rate must be resolved before the order line is created and snapshotted.

### Level 2 — Category rate

If no product-level override exists, check whether the product's category has a configured
commission rate.

Categories in Hanuja (furniture, decor, office, lifestyle, etc.) may carry different
platform commission rates because margin structures and return rates differ by category.

Storage: a commission rate field on the `Category` model, or a separate category-commission
configuration table when rates need audit history.

### Level 3 — Seller general rate

If neither product override nor category rate is set, use the seller's general commission
rate — a rate negotiated or assigned to the seller at onboarding or during account review.

Use case: sellers with volume-based negotiated rates, or sellers in a beta cohort with
temporary rates.

Storage: a `commissionRate` field on the `Seller` or `SellerProfile` model.

### Level 4 — System default rate

If no override, category rate, or seller-specific rate exists, fall back to the platform-wide
system default rate configured in admin settings.

The system default rate must be explicitly configured and version-tracked. It must not be
a hardcoded constant in source code. If the system default changes, the change must be
reflected in admin configuration, not in a code deployment.

---

## Rate Storage Principles

- Rates are stored as `Decimal(5,4)` values. Example: `0.1500` = 15%.
- A rate of `0.0000` is valid (zero commission) and must not be treated as "not set."
- A null or missing rate means "no rate configured at this level" — move to the next level.
- Once an order line is created, the resolved rate and the calculated amount are snapshotted
  onto `OrderLine.commissionRate` and `OrderLine.commissionAmount`. Subsequent rate changes
  do not retroactively affect already-created order lines.
- Rate snapshots are immutable after order confirmation. Do not allow back-calculation on
  historical orders if rates change later.

---

## Commission Calculation per Order Line

Commission is calculated at the order line level, not at the order level. An order may
contain lines from different sellers and different categories, so each line carries its own
resolved rate.

### Calculation formula

```
commissionAmount = unitPrice × quantity × commissionRate
               = orderLine.totalPrice × commissionRate
```

The base amount for commission is the gross product amount — the price the customer paid
for the product line before any shipping or coupon adjustments.

### Relationship to net payout

Commission is the primary deduction from seller gross earnings. It feeds directly into the
net payout formula defined in `.claude/rules/07-marketplace-finance-rules.md`:

```
net_payout = gross_product_amount
           - commission
           - coupon_share_effect
           - cargo_charge
           - ad_fee
           - penalties
           - refunds
           - other_valid_offsets
```

The `OrderLine.netPayoutAmount` field stores the pre-calculated net payout for that line
at order creation time. This value must be recalculated if a coupon share, cargo charge,
or other deduction is applied after confirmation (for example, via admin adjustment).

---

## Invoice Relationship

Hanuja operates a centralized collection model. The invoice structure reflects this.

### Product invoice — seller issues to customer

The seller (as the product supplier) issues a VAT invoice directly to the customer for
the product amount. This is the seller's legal obligation as the product seller.

### Commission invoice — Hanuja issues to seller

Hanuja issues a commission invoice to the seller for the commission amount earned by
Hanuja on that sale. This invoice documents Hanuja's service fee.

### Other service invoices — Hanuja issues to seller

If applicable, Hanuja also issues separate invoices to the seller for:
- advertising or listing service fees (see `ad-fee-policy.md`)
- shipping/cargo charges reflected to the seller (see `cargo-shipping-policy.md`)
- penalty invoices if applicable (see `penalty-policy.md`)

### Implementation constraint

Commission must not be described as a simple price split or as a marketplace cut without
an invoice. The invoice relationship is the legal mechanism. Any code that records commission
in the seller ledger must do so with a reference that corresponds to a real or future invoice
record.

---

## Seller Ledger Entry for Commission

When an order line is confirmed, a seller ledger entry of type `commission` must be written
with:

- `type`: `commission`
- `amount`: negative value (deduction from seller balance)
- `referenceType`: `order`
- `referenceId`: the order ID
- `description`: human-readable entry such as "Komisyon: Sipariş #XXX — %15"
- `createdAt`: timestamp of commission calculation

The commission ledger entry is written at the point the order line becomes finance-active,
which is at `payment_confirmed`. It must not be written before payment confirmation.

The commission amount in the ledger entry must match `OrderLine.commissionAmount` exactly.
Discrepancies between the ledger and order line are reconciliation errors.

---

## Admin Visibility Requirements

The admin panel must provide visibility into:

- per-order-line commission rate applied and amount deducted
- which resolution level was used (product override / category / seller / system default)
- total commission collected by period
- commission deductions in each seller's ledger
- commission invoice reference where available

Admin must be able to trace how any individual commission was calculated.

---

## Seller Visibility Requirements

The seller panel must show:

- commission rate applied per order line
- commission amount deducted per order line
- total commission deducted in the finance summary view
- commission as a named line item in the deductions breakdown — not collapsed into a generic "fees" field

Do not hide commission behind an unexplained net payout figure.

---

## Auditability Rules

- Commission rate resolution must be logged at order creation so disputes can be traced.
- If a rate override was applied, the source of that override must be recordable.
- Manual commission corrections applied by admin must create a `manual_adjustment` ledger
  entry referencing the original commission entry.
- Do not silently overwrite commission amounts. Any correction is an additional ledger entry.

---

## What Must Not Happen

- Do not calculate commission on total order amount when lines have separate sellers.
- Do not apply a single system rate without first checking product, category, and seller levels.
- Do not hardcode the system default rate in source code.
- Do not retroactively recalculate commission on historical confirmed order lines when rates change.
- Do not merge commission deductions into cargo or ad fee fields in the ledger.
- Do not allow zero-rate commission to silently appear without an explicit zero-rate configuration.

---

## Cross-Reference Files

This document must stay aligned with:

- `CLAUDE.md` — section 15.1 (commission resolution order) and section 15.2 (invoice relationship)
- `.claude/rules/07-marketplace-finance-rules.md` — net payout formula, ledger principles
- `db/schema/schema.prisma` — `OrderLine.commissionRate`, `OrderLine.commissionAmount`, `LedgerEntryType.commission`
- `docs/07-operations/payout-lifecycle.md` — how commission feeds into payout calculation
- `docs/07-operations/reconciliation-process.md` — commission reconciliation expectations

If commission resolution logic or rate storage changes, update this document and the
schema notes in the same work.
