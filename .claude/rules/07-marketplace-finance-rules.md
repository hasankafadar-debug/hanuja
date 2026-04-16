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

### 1. Payout start condition

Seller payout countdown starts only when the order reaches:

`delivery_confirmed`

It does **not** start at:

- `delivered`
- `shipped`
- `tracking_entered`
- `payment_confirmed`

### 2. Mandatory hold period

After `delivery_confirmed`, a **30-day hold** applies.

During this hold period, the system must evaluate:

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

But the **30-day order-level hold** is still mandatory.

Do not replace order-level maturity with a simple calendar payout date.

## Penalty Rules

### 1. Standard penalty rate

Default seller penalty rate is:

**20% of product amount**

Do not invent alternative penalty rates unless approved by policy.

### 2. Penalty trigger cases

The 20% penalty applies in defined cases such as:

- seller rejects a valid paid order
- 20-day fulfillment rule is violated and cancellation is triggered by customer or admin
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

## 20-Day Fulfillment Rule

If the operational 20-day delivery commitment is breached and cancellation is triggered according to platform policy:

- seller penalty evaluation must run
- customer-facing refund or cancellation finance flow must run
- seller payout eligibility must be blocked for the affected order
- the case must remain visible in admin finance tools

This rule must not depend on manual memory or support notes alone.
It must be represented in system logic.

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

If coupons or campaign discounts affect seller payout:

- the cost impact must be explicit
- the system must know whether the discount is absorbed by platform, seller, or shared logic
- finance records must show the impact clearly

Do not silently reduce seller payout without a visible reference.

If coupon-sharing rules are still evolving, model them as configurable policy.

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