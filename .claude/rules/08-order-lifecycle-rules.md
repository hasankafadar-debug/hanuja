# Order Lifecycle Rules

## Purpose

This file defines the non-negotiable order lifecycle rules of the Hanuja marketplace.

It exists to keep order flow consistent across:

- storefront
- seller panel
- admin panel
- finance and payout logic
- return and dispute handling
- notifications
- reporting and audit trails

If implementation conflicts with this file, this file wins unless a newer approved rule explicitly replaces it.

## Core Order Principle

Hanuja does not treat order flow as a simple e-commerce shipment timeline.

Order lifecycle must always reflect:

- central payment collection by Hanuja
- seller fulfillment responsibility
- admin oversight and exception handling
- payout dependency on `delivery_confirmed`
- penalties for specific seller-side failures
- clear separation between cancellation, return, dispute, and payout hold

## High-Level Order Flow

At a high level, the intended flow is:

1. customer creates order
2. payment is attempted
3. payment is confirmed
4. order becomes visible to seller
5. seller accepts/fulfills the order
6. shipment is created or tracking is entered
7. order is delivered
8. delivery is confirmed
9. payout hold countdown starts
10. return/dispute windows and risk checks are evaluated
11. payout becomes eligible if no blocking issue exists

Do not collapse these stages into fewer stages if clarity is lost.

## Core Lifecycle Rule: Seller Only Sees Paid Orders

An order must be visible to the seller only after payment is confirmed. :contentReference[oaicite:3]{index=3}

That means seller-facing actionable order queues must exclude:

- payment_pending
- payment_failed
- bank_transfer_pending
- payment_unverified
- abandoned checkout records

Only payment-confirmed orders may enter seller fulfillment flow.

## Canonical Order Status Philosophy

Statuses should be explicit, typed, and auditable.

Avoid vague states such as:

- `in_progress`
- `active`
- `done`

Prefer specific lifecycle states with clear operational meaning.

Recommended approach:

- customer-facing labels may be simplified
- internal status model must remain more explicit
- finance, fulfillment, return, and dispute meanings must not be merged into one status

## Suggested Core Status Families

The implementation may refine naming, but these concepts must exist.

### A. Order creation and payment states

- `draft`
- `checkout_started`
- `payment_pending`
- `payment_confirmed`
- `payment_failed`
- `payment_canceled`
- `bank_transfer_waiting`
- `bank_transfer_confirmed`

### B. Seller action states

- `seller_queue_ready`
- `seller_reviewing`
- `seller_accepted`
- `seller_rejected`
- `preparing`
- `awaiting_shipment`
- `shipped`

### C. Delivery states

- `delivered`
- `delivery_confirmation_pending`
- `delivery_confirmed`

### D. Cancellation / exception states

- `canceled_by_customer`
- `canceled_by_admin`
- `canceled_due_to_payment_failure`
- `canceled_due_to_seller_rejection`
- `canceled_due_to_20_day_breach`

### E. Return / dispute states

- `return_requested`
- `return_under_review`
- `return_approved`
- `return_rejected`
- `return_in_transit`
- `return_received`
- `refund_pending`
- `refund_completed`
- `dispute_open`
- `dispute_resolved`

### F. Finance-linked states

- `payout_hold_active`
- `payout_blocked`
- `payout_ready`
- `payout_paid`

Not every one of these must be the primary order table column, but the underlying concepts must exist in the lifecycle model.

## Mandatory Distinction: delivered vs delivery_confirmed

`delivered` and `delivery_confirmed` are not the same. :contentReference[oaicite:4]{index=4}

### delivered
Means shipment physically appears to have reached the customer.

Possible sources:

- cargo integration says delivered
- tracking page indicates delivery
- admin manually verifies delivery evidence

### delivery_confirmed
Means delivery is operationally accepted for payout countdown purposes.

This may occur by:

1. explicit customer confirmation
2. admin confirmation after review
3. silent confirmation if delivered status exists and customer does not object within the defined waiting period

Payout countdown starts from `delivery_confirmed`, never from `delivered`. :contentReference[oaicite:5]{index=5}

## Delivery Confirmation Logic

Preferred confirmation order:

1. cargo integration delivery signal
2. manual tracking/admin verification
3. customer clicks "Teslim Aldım"
4. silent confirmation after delivered status plus no objection within 72 hours

If the silent confirmation rule is used, it must be system-driven and timestamped. :contentReference[oaicite:6]{index=6}

Do not make payout timing depend on informal support comments.

## Seller Rejection Rules

Seller rejection is allowed as a controlled exception, not as a free option. :contentReference[oaicite:7]{index=7}

### Seller rejection requirements

If seller rejects a paid order:

- seller must choose a rejection reason
- admin must see the reason
- customer must be informed
- order must move into cancellation flow
- finance rules must evaluate seller penalty
- audit trail must record actor, timestamp, reason, and result

### Example rejection reasons

- stock error
- pricing error
- production impossibility
- quality problem
- technical issue
- force majeure

### Standard result

Normal rule:

- order is canceled
- customer notification is sent
- seller penalty is applied according to finance rules

Default penalty consequence for valid seller rejection is 20% of product amount unless an approved exception exists. :contentReference[oaicite:8]{index=8}

### Exception handling

Admin may waive penalty in exceptional cases such as:

- natural disaster
- supplier collapse
- clear platform/system fault
- incorrect product/platform mapping

Waiver must remain auditable.

## 20-Day Fulfillment Commitment

Hanuja’s operational rule is that the product should reach the customer within 20 days. :contentReference[oaicite:9]{index=9}

If that commitment is breached:

- customer may gain cancellation right
- admin may cancel the order
- seller penalty evaluation must run
- order must not continue as normal fulfillment without explicit extension handling

### Standard breach result

If the shipment commitment date is exceeded:

- seller accrual penalty increases by 1% per overdue day
- 20% seller penalty is evaluated
- customer-facing finance flow is triggered
- payout eligibility is blocked for that order

### Controlled extension

If policy allows, an additional 10-day extension may be granted only with the correct business logic, such as customer awareness/approval and admin decision. :contentReference[oaicite:10]{index=10}

Never silently extend a delayed order without traceability.

## Shipment Rules

Shipment-related lifecycle must support:

- shipment creation
- tracking number entry
- optional cargo integration update
- delivery evidence
- shipment timestamps

Once shipment has started, the order should generally move out of pure cancellation logic and into delivery/return logic.

Important business rule:

After dispatch/shipment, the normal path is no longer simple cancellation; it becomes return/refund-oriented handling if the customer no longer wants the item. :contentReference[oaicite:11]{index=11}

## Cancellation Rules

Order cancellation must distinguish clearly by cause.

### Cancellation before seller fulfillment
Possible when:

- payment fails
- bank transfer is not confirmed
- admin invalidates payment
- seller rejects order
- customer cancels while still allowed and before shipment
- risk/fraud block requires cancellation

### Cancellation after shipment
Do not treat shipped orders as simple early cancellations.
Use return/refund/dispute logic where appropriate. :contentReference[oaicite:12]{index=12}

### Cancellation categories must remain separate

At minimum, track these causes separately:

- payment-related cancellation
- customer pre-shipment cancellation
- seller rejection cancellation
- admin cancellation
- 20th overdue day auto-cancellation
- fraud/risk cancellation

Do not merge all cancellations into one opaque state.

## Return Rules

Central collection model makes return flow financially important. :contentReference[oaicite:13]{index=13}

### 14-day withdrawal period

A return request within the 14-day legal/right-of-withdrawal window should be treated as standard fast-path return handling unless another rule blocks it. :contentReference[oaicite:14]{index=14}

### After 14 days

Return requests after 14 days are not assumed to be automatically approved.
They require admin/business evaluation according to platform policy. :contentReference[oaicite:15]{index=15}

### Return lifecycle expectations

Return flow should support at least:

- request opened
- reason captured
- review started
- seller/admin evaluation
- return approved or rejected
- customer shipment back
- item received
- refund completed or denied

## Dispute Rules

Dispute is not the same as return.

A dispute may involve:

- damaged item
- incomplete item
- wrong item
- delivery conflict
- seller-customer disagreement
- fraud suspicion
- payout hold exception

When dispute is open:

- payout must not become freely eligible
- admin visibility must be high
- evidence and comments must be stored
- final resolution must be explicit

## Risk and Fraud Interaction

Some orders must be blocked or reviewed before normal progression if risk signals appear. Recommended risk examples include: unusually high first orders, repeated card failures, abusive coupon patterns, multiple accounts from same device, or mismatched identity/payment combinations. :contentReference[oaicite:16]{index=16}

Risk-sensitive flow may trigger:

- seller visibility delay
- admin review
- shipment hold
- payout hold
- cancellation or dispute escalation

Risk review must not be invisible.

## Payout Interaction

Order lifecycle must remain aligned with payout rules.

### Payout countdown starts when:
- status becomes `delivery_confirmed`

### Payout must remain blocked when:
- return is open
- dispute is open
- chargeback risk exists
- seller documents are incomplete
- bank details are unverified

These payout-blocking conditions must be lifecycle-visible, not only finance-visible. :contentReference[oaicite:17]{index=17}

## Notification Requirements

Key lifecycle transitions should trigger appropriate notifications.

At minimum, notify relevant parties for:

- payment confirmed
- order visible to seller
- seller accepted / seller rejected
- shipment created / tracking entered
- delivered
- delivery confirmed
- cancellation
- return requested
- return approved / rejected
- refund completed
- dispute opened / resolved

Notification wording can be simple, but the underlying event source must be precise.

## Admin Override Rules

Admin needs controlled override powers, but lifecycle consistency must remain intact.

Admin may need to:

- confirm payment
- approve/reject bank transfer
- cancel order
- waive seller penalty
- mark delivered
- mark delivery confirmed
- extend fulfillment window
- open or resolve dispute
- block or release payout eligibility

Every admin override must be:

- permission-controlled
- timestamped
- actor-linked
- reasoned
- auditable

## Data Modeling Rules

Lifecycle implementation should follow these principles:

- use explicit status enums
- use timestamps for key transitions
- keep audit/event history
- separate order status from payment status where needed
- separate order status from payout status where needed
- separate order status from return/dispute status where needed

Prefer an event/history table instead of overwriting state with no trail.

## Minimum Event History Expectations

For each order, keep auditable history for events such as:

- order created
- payment attempted
- payment confirmed
- seller notified
- seller accepted/rejected
- shipment entered
- delivered
- delivery confirmed
- cancellation initiated
- return requested
- refund completed
- dispute opened/resolved
- payout hold activated/released

This history should support both admin troubleshooting and seller/customer support.

## Things Claude Must Not Do

Do not:

- expose unpaid orders to sellers
- treat seller rejection as penalty-free by default
- treat `delivered` as equivalent to `delivery_confirmed`
- start payout countdown from shipment or delivery alone
- keep shipped orders in a naive cancellation flow
- assume all returns are inside 14 days
- assume all post-14-day returns are automatically accepted
- silently extend 20-day breach cases
- hide lifecycle exceptions in notes instead of statuses/events

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `docs/06-engineering/event-status-model.md`
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/01-business/refund-return-policy.md`
- `docs/01-business/penalty-policy.md`

If order lifecycle logic changes, update the related engineering, operations, and business docs in the same work.