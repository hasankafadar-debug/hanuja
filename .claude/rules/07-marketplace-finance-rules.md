# Marketplace Finance Rules

## Purpose

This file defines the non-negotiable finance rules of the Hanuja marketplace.

It exists to prevent ambiguity in:

- payment collection
- seller ledger logic
- payout eligibility
- penalty application
- offset calculations
- refund and dispute impact
- admin finance operations

If any implementation conflicts with this file, this file wins unless a newer approved business decision explicitly replaces it.

## Core Finance Principle

Hanuja uses a **central collection model**.

This means:

- the customer pays Hanuja
- Hanuja records the order payment
- the seller does not collect directly from the customer
- the seller is paid later through Hanuja's payout process
- all deductions and offsets are applied before seller payout

Never model Hanuja as a simple listing platform with direct customer-to-seller payment.

### Seller of record (satıcı Hanuja modeli, 2026-10)

Hanuja is the seller in customer contracts. The designer/brand ("seller" in code and panels) is
Hanuja's supplier:

- Hanuja issues the sales invoice to the customer (manually in Uyumsoft for now, within 7 days of
  handover to cargo; the admin uploads the PDF — `OrderCustomerInvoice`).
- The seller invoices Hanuja for the order when shipping (`OrderSellerInvoice`). The amount is the
  order's seller payout before later returns: KDV-inclusive sale − seller coupon share − KDV-inclusive
  commission, at the product's own KDV rate. Cargo is included in the product price and is not on it.
  Single source: `api/domain/seller-purchase-invoice.ts`.
- The seller's invoice is internal: it is never shown or sent to the customer.
- No separate commission invoice is issued; commission ledger entries are visible to the seller at once.
  Penalty invoices from Hanuja to the seller remain.

## Payment Collection Rules

### 1. Payment owner

All customer payments are collected by Hanuja.

This includes:

- card payments
- bank transfer / EFT payments
- other approved payment methods routed into Hanuja's collection flow

### 2. Seller visibility of orders

Sellers must only receive orders after payment confirmation.

Never send the following to the seller as active fulfillable orders:

- unpaid orders
- failed payment orders
- pending bank transfer orders
- unverified payment records

### 3. Payment confirmation dependency

Order creation and payment attempt do not equal finance validity.

Finance-sensitive operations must depend on confirmed payment status, not only on order creation.

### 4. Confirm-time binding invariants (kart ödemesi, 2026-10-16)

Kart ödemesi iyzico standart sanal POS + 3D Secure ile alınır (`api/services/card-payment.service.ts`).
Tahsilat (`processCapturedPayment`) şu doğrulamalar geçmeden hiçbir state değişikliği yapamaz:

- iyzico yanıtı **denemenin değişmez değerleriyle** eşleşmeli: `price`, `paidPrice` (teklifteki taksit
  toplamı), taksit sayısı, `basketId` (= sipariş id), `currency`; kalem kimlikleri ve kalem fiyatları sepetle,
  kalem `paidPrice` toplamı `paidPrice` ile kuruşu kuruşuna tutmalı
- bir iyzico `paymentId` yalnız **bir** siparişi onaylayabilir ve başlatmada denemeye yazılan `paymentId` ile
  eşleşmeli (`Payment.providerPaymentId` ve `CardPaymentAttempt.providerPaymentId` unique); dönen
  `conversationId` tek başına sahiplik kanıtı değildir
- başarı için 3DS `status=success` + `mdStatus=1` ve imzalı v2 auth / ödeme sorgusu yanıtı gerekir
- `fraudStatus` 1 veya 2 onaylar; 0 siparişi `payment_pending`'de tutar (tasarımcıya düşmez, tahakkuk yok);
  inceleme sonrası -1 iyzico tarafından iade edilir, Hanuja ikinci iade göndermez
- tahsil edilmiş ama siparişe bağlanamayan ödeme (geç, ikinci, uyuşmaz) sessiz kalmaz:
  `CardAttemptReversal` ile iptal/iade edilir

Bu kontrolleri gevşeten her değişiklik güvenlik incelemesi gerektirir.
Bkz: `docs/05-security/payment-security.md` §2, §7.

### 5. Taksit vade farkı (kart ödemesi, 2026-10-16)

Taksitli kart ödemesinde vade farkını **müşteri öder** (iş sahibi kararı, 2026-10-16):

```
price      = Order.totalAmount (ödeme öncesi peşin toplam: ürün + kargo − kuponlar)
paidPrice  = iyzico taksit sorgusunun totalPrice değeri (panel oranları)
vade farkı = paidPrice − price
```

- Onayda `Order.totalAmount = paidPrice`; `installmentCount`, `installmentDifferenceAmount`,
  `installmentTotalAmount` yazılır; `Payment.amount = paidPrice`.
- Vade farkı **tasarımcı hakedişine, komisyon tabanına ve tasarımcının Hanuja'ya faturasına girmez**; bunlar
  yalnız `OrderLine` tasarımcı alanlarını (`totalPrice`, kupon payı, komisyon) okur.
- Kalem payları iyzico'nun kalem `paidPrice` değerlerinden alınır: `OrderLine.customerPaidProductAmount` ve
  `Order.customerPaidShippingAmount` vade farkı payını içerir.
- İptal/iade edilen ürünün vade farkı payı müşteriye **oransal iade edilir** (iş sahibi kararı); iade edilen pay
  `platformFundedAmount` olarak Hanuja'da kalır, tasarımcı cari hesabını etkilemez.
- Vade farkı, müşteriden tahsil edilen brüt tutardır; iyzico komisyon/kesintileri deneme bazında ayrıca
  saklanır (`iyziCommissionFee`, `iyziCommissionRateAmount`, `merchantPayoutAmount`).
- Taksit seçenekleri iyzico'dan gelir; kategori bazlı üst sınır `Category.maxInstallmentCount` (boşsa üst
  kategoriden devralınır, sepette en düşük sınır).
- Müşteri faturasında vade farkının gösterimi ve KDV işlemi mali müşavir teyidine bağlıdır.

## Seller Ledger Principle

Each seller must have a ledger-style financial account.

This ledger is the source of truth for seller finance visibility.

The seller ledger must support at least:

- total gross sales
- pending payout amount
- payout-ready amount
- paid payout amount
- commission deductions
- coupon-related deductions
- cargo charge deductions
- advertising / service fee deductions
- penalty deductions
- refund deductions
- dispute-related holds
- negative balance
- manual admin adjustments
- timestamps and references for every entry

Never store only final payout totals without ledger entries.

Every meaningful financial change must be traceable.

## Net Payout Formula

Seller payout must be calculated from an explicit formula.

Base formula:

`net_payout = gross_product_amount - commission - coupon_share_effect - cargo_charge - ad_fee - penalties - refunds - other_valid_offsets`

Where relevant, also account for:

- dispute holds
- negative balance carryover
- previous manual adjustments
- fraud-related temporary blocks

### Formula rules

1. Never hardcode payout as a simple percentage of order total.
2. Keep each deduction item separate.
3. Every deduction must be explainable in the admin panel and seller panel.
4. If a value is configurable, store it as a rule-driven or settings-driven value, not inline magic numbers.
5. If a rule is not finalized, make it parameterized rather than guessed.

### EFT channel discount — platform absorption

EFT/Havale channel discounts (`Order.eftDiscountAmount`) are **not a seller deduction**.
They reduce the customer-facing total but do not appear in the net payout formula.

```
Payout.grossAmount  = OrderLine.totalPrice sum  (NOT reduced by eftDiscountAmount)
Payout.netAmount    = formula above             (NOT reduced by eftDiscountAmount)
```

The EFT discount cost is absorbed entirely by Hanuja. Changing this policy requires
explicit approval and an update to `docs/01-business/payout-policy.md` section 12.

### Admin EFT-approval manual discount — platform absorption

When admin approves a pending EFT payment via `approveEftPayment`, admin may optionally apply a manual discount
(input: kuruş amount, non-negative integer; cap: may not exceed what the customer pays for products —
shipping is never discounted). This discount is **also absorbed entirely by Hanuja**. It is stored in
`Payment.eftDiscountAmount` / `eftDiscountReason` (the channel discount stays in `Order.eftDiscountAmount`);
`Payment.amount` and `Order.totalAmount` become the collected amount, and on quantity-lifecycle orders it is
spread over `OrderLine.customerPaidProductAmount` so refunds never exceed what the customer paid. Like the channel discount, it does NOT reduce `Payout.grossAmount`, `Payout.netAmount`, or seller
accrual. It is recorded in the audit log as `payment_approved` action with discount reason and the per-line
shares calculated for reconciliation.

### Commission base — KDV-inclusive, coupon-adjusted

The commission base is the **KDV-inclusive** amount the customer actually paid for the line:
the `OrderLine.totalPrice` gross snapshot minus any seller-coupon discount allocated to the
line (`OrderLine.couponDiscountAmount`).

The commission deduction is itself KDV-inclusive — the rate is grossed up by
`commissionVatRate` (`PlatformSettings.commissionVatRate`, default `0.2000`):

```
commissionBase   = OrderLine.totalPrice − OrderLine.couponDiscountAmount
commissionAmount = roundMoney(commissionBase × commissionRate × (1 + commissionVatRate))
```

Do not use a KDV-exclusive base. Do not reduce the commission base by EFT discount,
platform coupon, or shipping. Seller coupon discount **does** reduce the base (see
Coupon and Discount Rules below). Final money amounts use `roundMoney`
(`packages/security/src/money.ts`). See `docs/01-business/commission-policy.md`.

This applies to new orders only (snapshot at order creation). Orders confirmed before
2026-07-09 keep their original KDV-exclusive commission snapshot.

## Gross Amount vs Net Amount

Finance code must distinguish clearly between:

- gross product amount
- collected customer amount
- seller gross earning basis
- net seller payout
- platform revenue components

Never collapse these concepts into one amount field.

Recommended separation:

- `gross_product_amount`
- `customer_paid_amount`
- `platform_commission_amount`
- `cargo_charge_amount`
- `ad_fee_amount`
- `penalty_amount`
- `refund_amount`
- `hold_amount`
- `net_payout_amount`

## Payout Eligibility Rules

### 1. Payout record and term

The payout record is created only when the order reaches `delivery_confirmed` — never at
`delivered`, `shipped`, `tracking_entered` or `payment_confirmed`.

The payout **term** runs from the approved seller invoice to Hanuja:

```
dueDate = first Friday on or after (invoiceDate + PlatformSettings.payoutHoldDays)   // default 30
          (Europe/Istanbul calendar days; a Friday public holiday → next business day)
```

`invoiceDate` is the date the admin records when approving the invoice (it may not be in the future
or before the order's payment date). Implementation: `calculatePayoutDueDate`
(`api/domain/payout-calculator.ts`), `readInvoicePayoutDueDate` (`api/services/payout-eligibility.ts`).
Approval writes the due date to `Payout.holdUntil`; a rejection or a replaced file clears it.

### 2. Mandatory preconditions until the due date

A payout matures only when the seller invoice is approved, the order is `delivery_confirmed` and the
due date has been reached. If a blocker is open on the due date, the payout is paid on the first
Friday after the blocker clears.

Until then, the system must evaluate:

- return risk
- open disputes
- chargeback risk
- fraud risk
- admin review flags
- pending penalty deductions
- negative balance offsets
- reconciliation concerns

### 3. Payout-ready state

An order or payout item becomes payout-ready only if all required checks pass.

At minimum, payout must not be released when there is:

- no approved seller invoice to Hanuja, or its due date not yet reached
- no delivery confirmation
- open return flow
- unresolved dispute
- unresolved fraud review
- unresolved finance inconsistency
- explicit admin hold
- missing seller payout details
- known offset still not applied

### 4. Batch payout policy

Hanuja may pay sellers in payout batches such as:

- weekly
- biweekly
- monthly

But the **order-level invoice term** (approved invoice date + 30 days, first Friday) is still mandatory.

Do not replace order-level maturity with a simple calendar payout date.

## Penalty Rules

### 1. Standard penalty rate

Default seller penalty rate is:

**20% of product amount**

Do not invent alternative penalty rates unless approved by policy.

### 2. Penalty trigger cases

The 20% penalty applies in defined cases such as:

- seller rejects a valid paid order
- documented admin penalties permitted by policy; late shipment alone produces tracking and warnings
- other explicitly approved penalty scenarios defined by business policy

### 3. Penalty application method

Penalty is usually not treated as an instant external payment request.

Default treatment:

- record penalty in seller ledger
- deduct from next payout
- if payout is insufficient, create or extend negative balance
- carry the remaining balance forward

### 4. Penalty exceptions

Admin may have controlled authority to waive or reverse a penalty in exceptional cases.

Examples may include:

- clear system fault
- force majeure
- incorrect platform mapping
- documented admin-approved exception

A waived penalty must still remain auditable.

## Seller Rejection Finance Logic

If a seller rejects a paid order:

- the order is canceled according to order flow rules
- customer-facing refund/cancellation process begins
- seller penalty is evaluated according to penalty rules
- seller ledger must record the financial effect
- admin must see rejection reason and penalty outcome

Reject flow must never silently disappear from finance history.

## Fulfillment Delay Tracking

Per-product shipment deadlines, extensions, risk records and warnings remain active. Automatic daily 1% accrual and overdue-day-20 cancellation are retired as of 2026-10-14. Historical monetary records remain auditable and are not bulk rewritten. An authorised cancellation must use the existing item-scoped refund path.

## Return and Refund Finance Rules

### 1. Return before seller payout

If a return or refund is finalized before seller payout:

- the related amount must reduce or block payout
- seller must not receive payout for the refunded amount
- finance records must show why payout was reduced

### 2. Return after seller payout

If seller has already been paid and a valid return/refund later occurs:

- create a seller ledger debt or negative balance
- offset from future payouts
- if required, create an additional recovery workflow

### 3. Partial refunds

The finance model must support partial refunds.

Do not assume every refund is full-order.

### 4. Refund visibility

Refund-linked adjustments must be visible in:

- admin finance screens
- seller finance summary
- order finance detail

## Coupon and Discount Rules

The cost owner depends on the discount type. This must be explicit in finance records.

### Seller coupon — cost borne by the seller

A coupon with `Coupon.sellerId` set is valid only on that seller's products (applied to the
seller subtotal at checkout). Its cost belongs to the seller:

```
OrderLine.couponDiscountAmount = seller coupon distributed proportionally across the
                                 seller's order lines
Payout.couponShareAmount       = sum(OrderLine.couponDiscountAmount)
OrderLine.netPayoutAmount      = totalPrice − couponDiscountAmount − commissionAmount
```

The seller coupon discount also reduces the commission base (see Commission base section).

### Seller discount rule — cost borne by the seller

`DiscountRule` lowers the sale price directly, so `OrderLine.totalPrice` is already the
discounted price. No separate share allocation is performed; commission is naturally
computed on the reduced price.

### Platform coupon — cost borne by Hanuja

A coupon with `Coupon.sellerId` null is platform-wide and absorbed by Hanuja. Line snapshots
stay at full price; the platform coupon does NOT reduce the commission base or the seller
payout — the same philosophy as the EFT channel discount.

Do not silently reduce seller payout without a visible reference. Every coupon effect must
be traceable to `OrderLine.couponDiscountAmount` / `Payout.couponShareAmount` or explicitly
recorded as platform-absorbed.

## Cargo Charge Rules

If cargo/shipping costs are chargeable to the seller:

- record the deduction explicitly
- tie it to the related order or shipment
- show the reason in seller finance details
- preserve admin visibility for audit

Do not mix cargo deductions into commission fields.

## Advertising / Service Fee Rules

If Hanuja charges recurring ad or service fees to sellers:

- record these in seller ledger
- allow scheduled deduction or invoice-linked deduction
- show them separately from order commission
- support offset from future payouts when relevant

Ad/service fee logic must not be hidden inside generic adjustments.

## Negative Balance Rules

The seller ledger must support negative balances.

Negative balance may occur due to:

- penalties
- post-payout refunds
- manual finance adjustments
- unpaid service fees
- finance corrections

Rules:

1. Negative balance must be visible.
2. Future payouts must apply offset automatically or through approved workflow.
3. Admin actions affecting negative balance must be logged.
4. Seller-facing screens must explain the balance at a meaningful level.

## Manual Admin Adjustments

Admin may need to apply manual finance actions such as:

- waive a penalty
- add a compensating credit
- apply a correction debit
- block payout
- release payout hold
- mark a reconciliation note

Rules for manual actions:

- every manual adjustment must have actor, timestamp, reason, reference
- do not allow silent balance mutations
- all manual actions must be auditable
- high-impact actions should be permission-restricted

## Reconciliation Rules

Finance implementation must support reconciliation between:

- order records
- payment records
- refund records
- payout records
- seller ledger records
- admin manual adjustments

Never build payout logic that cannot be reconciled later.

Where possible, use immutable event-style records for important finance transitions.

## Finance Status Suggestions

Implementation may use explicit finance statuses such as:

- `payment_pending`
- `payment_confirmed`
- `hold_active`
- `payout_blocked`
- `payout_ready`
- `payout_scheduled`
- `payout_paid`
- `refund_pending`
- `refund_completed`
- `penalty_applied`
- `adjustment_applied`

Status naming may evolve, but the underlying concepts must remain explicit.

## Required Admin Visibility

Admin finance views should make these visible:

- total collected today
- pending bank transfer approvals
- seller pending payouts
- payout-ready balances
- held balances
- negative balances
- penalty totals
- refund impact
- seller finance risk indicators
- payout batch readiness

Admin must be able to trace every seller payout calculation.

## Required Seller Visibility

Seller finance views should make these visible:

- pending earnings
- hold-period earnings
- payout-ready earnings
- paid earnings
- deductions by type
- penalties
- offsets
- negative balance
- expected payout timing
- finance detail by order

Do not expose only a single wallet number without explanation.

## Data Modeling Rules

When implementing finance logic:

- keep finance logic in domain/service layers
- keep money values typed and explicit
- avoid burying payout math in controllers or UI
- prefer ledger/event records over overwrite-only fields
- use stable references to orders, payouts, refunds, penalties, and adjustments
- support future reporting and audit needs

## Things Claude Must Not Do

Do not:

- pay seller immediately after delivery
- pay a seller whose invoice to Hanuja is missing, rejected or not yet due
- show or send the seller's invoice to Hanuja to the customer
- treat `delivered` as `delivery_confirmed`
- collapse all deductions into one opaque field
- remove auditability for manual finance actions
- send unpaid orders into seller fulfillment
- assume penalties are optional by default
- assume refunds only happen before payout
- mix cargo, commission, and ad fees into one deduction type
- hardcode unfinished business rules as final truths

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/01-business/payout-policy.md`
- `docs/01-business/penalty-policy.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/reconciliation-process.md`
- `docs/06-engineering/event-status-model.md`

If finance logic changes, update the relevant docs in the same work.