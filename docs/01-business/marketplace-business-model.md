# Marketplace Business Model
# Son güncelleme: 2026-04-17
# Durum: taslak v1

Business rule source document.
Source of truth for platform-level financial and operational model.
Cross-reference: CLAUDE.md §2, §15 · `.claude/rules/00-project-scope.md` · `.claude/rules/07-marketplace-finance-rules.md`

---

## Overview

Hanuja is a Turkey-focused multi-vendor marketplace for home, office, decor, furniture, and lifestyle products. It is not a simple listing aggregator. It operates a **central collection model**, meaning Hanuja acts as the financial intermediary between the customer and every seller on the platform.

---

## Central Collection Model

### How money flows

1. Customer places an order on the Hanuja storefront.
2. Customer pays Hanuja directly — via card (Iyzico) or bank transfer / EFT.
3. Hanuja holds the collected funds.
4. The order is forwarded to the relevant seller(s) only after payment is confirmed.
5. The seller fulfills the order and ships to the customer.
6. After delivery is confirmed and the mandatory hold period expires, Hanuja pays the seller their net payout.

### What this means operationally

- The seller never handles customer money directly.
- The seller issues the product invoice to the customer.
- Hanuja issues the commission invoice and any service/ad fee invoices to the seller.
- All deductions (commission, cargo charges, penalties, refunds, ad fees) are calculated and applied before any payout reaches the seller.
- If deductions exceed earnings, the seller ledger goes negative.

### Legal and financial significance

Because Hanuja collects centrally, the platform is the financially responsible party in the purchase chain. This creates obligations around:

- payment holding and settlement timing
- refund custody
- payout compliance
- VAT/tax invoice issuance
- potential payment service regulation

Changes to the collection model must be reviewed against `docs/08-legal/payment-regulation-notes.md`.

---

## Revenue Model

Hanuja earns revenue from sellers through the following instruments:

### 1. Commission on sales

The primary revenue source. Hanuja deducts a commission percentage from each seller's gross product amount on every confirmed order.

Commission resolution order (see `docs/01-business/commission-policy.md`):
1. Product-specific override rate
2. Category rate
3. Seller general rate
4. System default rate (10% — configured in `payout.service.ts`)

Commission is calculated server-side. It is never computed in the browser.

### 2. Advertising and service fees

Sellers may be charged recurring or usage-based fees for:
- promoted product placement
- featured store slots
- optional platform services

These fees appear as `ad_fee` entries in the seller ledger (`LedgerEntryType.ad_fee`).
See `docs/01-business/ad-fee-policy.md` for billing rules.

### 3. Cargo charge reflections

If Hanuja subsidizes or manages cargo costs and then recovers those costs from the seller, the amount is recorded as a `cargo_charge` ledger entry.
See `docs/01-business/cargo-shipping-policy.md`.

### 4. Penalty income

When a seller rejects a paid order or violates the 20-day fulfillment commitment, a penalty of 20% of the product amount is recorded against the seller. This reduces future payouts or creates a seller debt.
See `docs/01-business/penalty-policy.md`.

---

## Seller Payout Model

### Net payout formula

Implemented in `api/domain/payout-calculator.ts`:

```
net_payout = gross_product_amount
           - commission
           - coupon_share_effect
           - cargo_charge
           - ad_fee
           - penalties
           - refunds
           + admin_adjustments (credit entries)
```

Result may be negative. Negative net payout creates or extends a seller debt in the ledger.

### Payout timing

- Payout countdown starts **only** from `delivery_confirmed` status.
- `delivered` and `delivery_confirmed` are separate states and must not be conflated.
- A mandatory 30-day hold applies after `delivery_confirmed`.
- After the hold period, the payout passes a readiness check before release.
- See `docs/01-business/payout-policy.md` for full payout lifecycle.

### Seller ledger

Every seller has an append-only financial ledger (`SellerLedgerEntry` table).

Ledger entry types (`LedgerEntryType` enum in schema):
- `sale` — incoming gross sale credit
- `commission` — commission deduction
- `cargo_charge` — cargo cost deduction
- `ad_fee` — advertising/service fee deduction
- `penalty` — penalty deduction
- `refund` — refund effect (deduction when seller has been or would be paid)
- `coupon_share` — seller's share of coupon discount cost
- `eft_discount` — admin-applied EFT payment discount
- `manual_adjustment` — admin corrective entry
- `payout` — payment disbursed to seller (negative — funds leave the account)
- `chargeback` — chargeback hit
- `dispute_hold` — amount held pending dispute resolution
- `dispute_release` — held amount released after dispute closes

No ledger entry is ever overwritten. Corrections are made via new reversal entries.

---

## Three-Sided Platform Model

### Customers

- Browse products, add to cart, checkout, pay via card or EFT.
- Track orders, confirm delivery, request returns within policy windows.
- Cannot see seller finance data, internal risk notes, or admin decisions.

### Sellers

- Manage their own products, inventory, and pricing.
- Receive only payment-confirmed orders as actionable fulfillment work.
- Enter tracking/shipment details.
- View their ledger, pending payouts, deductions, and penalties.
- Cannot control payout state, waive their own penalties, or see other sellers' data.

### Admin

- Full operational oversight: payments, seller risk, order lifecycle, payout readiness.
- Approves/rejects bank transfer payments.
- Reviews payout eligibility, applies or waives penalties, resolves disputes.
- All high-impact admin actions are recorded in `AdminAuditLog` with actor, timestamp, and reason.

---

## Platform Priority Order

When decisions conflict, Hanuja prioritizes in this order:

1. Platform correctness (financial integrity, lifecycle correctness)
2. Financial correctness (ledger accuracy, payout safety)
3. Legal and security safety
4. Operational clarity
5. SEO stability
6. UX quality
7. Implementation speed

---

## Invoice Relationships

| Invoice | Issued by | Issued to |
|---------|-----------|-----------|
| Product invoice | Seller | Customer |
| Commission invoice | Hanuja | Seller |
| Ad/service fee invoice | Hanuja | Seller |

---

## Payment Methods

| Method | Collection | Confirmation |
|--------|------------|--------------|
| Card (Iyzico) | Immediate, provider-verified | Automated via webhook/callback |
| Bank transfer / EFT | Manual, evidence-based | Admin must explicitly approve in admin panel |

Sellers never see orders from either method until payment is fully confirmed.

---

## Platform Constants

These are hardcoded policy values. Do not change without documented approval:

| Constant | Value | Source |
|----------|-------|--------|
| Standard penalty rate | 20% of product amount | `STANDARD_PENALTY_RATE` in `penalty-calculator.ts` |
| Payout hold period | 30 days after `delivery_confirmed` | `PAYOUT_HOLD_DAYS` in `penalty-calculator.ts` |
| Fulfillment commitment | 20 days from payment confirmation | `FULFILLMENT_DAYS` in `penalty-calculator.ts` |
| Silent delivery confirmation | 72 hours after `delivered` with no objection | `SILENT_DELIVERY_CONFIRMATION_HOURS` |
| 14-day return window | 14 days from `delivery_confirmed` | `RETURN_WINDOW_DAYS` in `penalty-calculator.ts` |
| Optional fulfillment extension | 10 days (admin-granted only) | `FULFILLMENT_EXTENSION_DAYS` |

---

## Related Documents

- `docs/01-business/commission-policy.md`
- `docs/01-business/payout-policy.md`
- `docs/01-business/penalty-policy.md`
- `docs/01-business/refund-return-policy.md`
- `docs/01-business/cargo-shipping-policy.md`
- `docs/01-business/ad-fee-policy.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/06-engineering/event-status-model.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/08-legal/payment-regulation-notes.md`
