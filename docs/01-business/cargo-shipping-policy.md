# Son güncelleme: 2026-09-02
# Durum: taslak v1

# Cargo and Shipping Policy

## Purpose

This document defines the shipping responsibilities of sellers on the Hanuja marketplace,
the 20-day fulfillment commitment, tracking entry requirements, cargo charge deductions,
and what happens when fulfillment deadlines are breached.

Coding agents must read this document before implementing or changing any shipment-related
logic, the 20-day breach job, cargo charge ledger entries, or delivery confirmation flows.

---

## Shipping Responsibility Model

Hanuja operates a seller-fulfilled model. The seller is responsible for physically
preparing, packing, and dispatching the product to the customer after receiving a
payment-confirmed order.

Hanuja does not warehouse or ship products on behalf of sellers by default.

### What the seller is responsible for

- preparing the order for shipment within the commitment window
- choosing a compatible cargo/shipping provider from the approved list
- entering tracking information into the seller panel before or at the point of handoff
- ensuring the product reaches the delivery address within the expected timeframe
- informing Hanuja (via the seller panel) of any shipment delay or force majeure

### What Hanuja is responsible for

- communicating shipment status to the customer
- integrating cargo tracking signals where available
- triggering the delivery confirmation flow
- applying the 20-day fulfillment rule and breach consequences

---

## 20-Day Fulfillment Commitment

Every payment-confirmed order carries a 20-calendar-day fulfillment commitment window.

This window starts from the moment the order reaches `seller_queue_ready` status — the
moment the seller receives the order into their fulfillment queue.

The commitment deadline is:

```
fulfillment_deadline = sellerQueueReadyAt + 20 calendar days
```

The seller's obligation is to have shipped and provided tracking by this deadline, or to
have the order in an active delivery state demonstrably moving toward delivery.

### Why 20 days

The 20-day window covers:
- production lead time for made-to-order items (furniture, custom decor)
- standard preparation time for ready-to-ship inventory
- cargo transit time to the customer

It is intentionally generous because Hanuja serves home and lifestyle categories that
include artisan and custom products. However, 20 days is a firm outer limit, not a target.

---

## Tracking Entry Requirements

The seller must enter shipment tracking information in the seller panel no later than
the moment the product is handed to the cargo provider.

Tracking entry creates a `Shipment` record in the system and moves the order toward
`shipped` status.

### Minimum tracking fields

- cargo provider name (from the approved provider list)
- tracking number (required before `handed_to_cargo` shipment status)
- handoff date and time

### Approved cargo providers

The system stores cargo provider as a string field (`Shipment.cargoProvider`). Accepted
values include providers such as: Yurtiçi Kargo, Aras Kargo, PTT Kargo, MNG Kargo,
Sürat Kargo. The approved list is maintained in admin configuration and the seller
panel's provider selector.

Sellers must not enter a provider not on the approved list. If a seller ships via an
unapproved provider, tracking integration will not work and delivery confirmation may
be delayed.

### Tracking update flow

Tracking events are recorded in `ShipmentEvent` records with a `source` field indicating
whether the update came from cargo integration, manual admin entry, or seller entry. Each
event is timestamped and immutable. Sellers cannot overwrite or delete shipment events.

---

## Delivery Confirmation

Reaching the customer's address does not automatically confirm delivery for payout purposes.

The Hanuja system distinguishes three states:

### `shipped`
The seller has handed the product to the cargo provider and entered tracking.
Payout countdown has not started.

### `delivered`
The cargo provider's tracking system or a manual admin verification indicates the package
reached the delivery address.
Payout countdown has NOT started. This state confirms physical arrival, not payout eligibility.

### `delivery_confirmed`
Delivery is operationally confirmed for payout purposes.
Payout countdown starts from this state.

`delivery_confirmed` can be reached by:

1. Customer explicitly confirms receipt ("Teslim Aldım" button in the storefront)
2. Admin manually marks delivery as confirmed after reviewing evidence
3. Silent confirmation: the system applies `delivery_confirmed` automatically if the
   order has been in `delivered` status for 72 hours with no customer objection or
   return request opened

The 72-hour silent confirmation rule must be implemented as a scheduled job, not as a
manual support action. The job must record a timestamped `OrderStatusHistory` entry
with `actorRole: system` and `reason: "Otomatik teslim onayı — 72 saat itiraz yok"`.

Payout countdown never starts from `shipped` or `delivered`. Only `delivery_confirmed`
triggers the 30-day payout hold countdown. This is a non-negotiable platform constant.

---

## Cargo Charge Deductions

In some scenarios, cargo-related costs are chargeable back to the seller. These are
recorded as `cargo_charge` ledger entries, separate from commission and ad fees.

### Scenarios where cargo charges may apply

- Hanuja subsidizes or provides shipping and charges the cost back to the seller
- The seller ships via a Hanuja-contracted provider at a platform rate, and the rate
  difference is passed back to the seller
- Return shipping is arranged by Hanuja and the cost is reflected to the seller after
  a valid return is processed

### Ledger entry for cargo charges

- `type`: `cargo_charge`
- `amount`: negative value (deduction from seller balance)
- `referenceType`: `shipment` or `return_request` — whichever applies
- `referenceId`: the shipment or return request ID
- `description`: human-readable, e.g., "Kargo kesintisi: Yurtiçi — Sipariş #XXX"
- `createdAt`: timestamp

Cargo charges must not be merged into the commission field. They are a distinct deduction
category visible separately in seller finance views and in the `Payout.cargoChargeAmount`
field.

---

## 20-Day Breach: What Happens

If the fulfillment deadline passes without the order reaching `shipped` status, the
system must trigger the 20-day breach flow.

### Breach detection

A scheduled job monitors orders in `seller_queue_ready`, `seller_accepted`, `preparing`,
or `awaiting_shipment` status. When `NOW() > fulfillment_deadline` and the order has not
progressed to `shipped`, the job flags the order as a breach candidate.

The breach job must be idempotent. Running it twice on the same order must not create
duplicate records.

### Customer cancellation right

Once the 20-day deadline passes:

- the customer gains the right to cancel the order at no cost to themselves
- the customer can trigger cancellation from the storefront order view
- admin may also cancel the order on the customer's behalf

If cancellation is triggered (by customer or admin) after a 20-day breach:

1. Order transitions to `cancelled_due_to_20day_breach`
2. Customer receives a full refund
3. Seller penalty evaluation runs — standard 20% of product amount applies
4. Payout eligibility for the order is permanently blocked
5. An `AdminAuditLog` entry is created referencing the breach event

### Seller penalty for 20-day breach

See `docs/01-business/penalty-policy.md` for the full penalty rules.

Summary: a 20% penalty on the product amount is the default consequence. The penalty is
recorded in the seller ledger and offset from future payouts. Admin may waive the penalty
in exceptional circumstances with documented justification.

### If seller ships after day 20 but before customer cancels

If the seller ships the order late (after the 20-day window) and the customer has not yet
exercised their cancellation right, the order may continue. However:

- the delay must be recorded in the status history
- the seller remains exposed to the penalty if the customer or admin subsequently cancels
- admin may apply a penalty for the breach even if the order eventually completes
- the late shipment event must note that it occurred outside the commitment window

---

## 10-Day Extension

A controlled 10-day extension to the fulfillment window may be granted in exceptional
circumstances. This is not an automatic seller option.

### Extension conditions

An extension may be granted only when all of the following are true:

- the seller requests an extension with a documented reason (production delay, supplier
  issue, force majeure)
- admin reviews and approves the extension
- the customer is notified of the delay and does not object
- the extension is recorded as an `AdminAuditLog` entry with `actionType: fulfillment_window_extended`
- the new deadline is written to the order record

Approval of an extension does not waive the 20% penalty retroactively if the order is
later cancelled within the extension window due to continued breach.

The extension decision must be visible to the customer. Silently extending the deadline
without customer notification is not permitted.

### Implementation note

The `fulfillment_window_extended` action type is present in the schema's `AdminActionType`
enum. The order record's `sellerQueueReadyAt` field is the reference point for deadline
calculation. An approved extension updates a separate `fulfillmentDeadlineOverride` field
rather than modifying `sellerQueueReadyAt` so the original deadline remains auditable.

---

## After Shipment: No Simple Cancellation

For lifecycle-v2 orders shipment is seller-scoped. Once an
`OrderSellerFulfillment` reaches `shipped`, that seller's active quantities have
left the seller's custody and simple cancellation is no longer the correct path
for those quantities. Other sellers' unshipped quantities remain cancellable.

If the customer no longer wants the product after shipment, the flow is:

- return and refund process (if within 14-day withdrawal window)
- admin-evaluated return (if outside 14-day window)
- dispute flow if the product was damaged, wrong, or not received

`ShipmentItem` records the exact `OrderLine` quantities handed to cargo. The tracking
write, shipment item creation, line `shippedQuantity` increment, and seller fulfillment
transition are committed in one serializable transaction. A concurrent cancellation
either wins first or receives `409 Conflict`; it cannot create a half-shipped state.

Legacy orders continue to use the order-level `shipped` rule. Do not allow seller-side
or customer-side plain cancellation of quantities already represented by `ShipmentItem`.

---

## Integration with Cargo Providers

Cargo tracking integration may provide automatic status updates via:

- API polling of the cargo provider's tracking API
- webhook callbacks from the cargo provider if available

When a cargo integration delivers a `delivered` status signal, the system records it
as a `ShipmentEvent` with `source: cargo_integration` and transitions the order to
`delivered`. From there, the 72-hour silent confirmation timer begins if the customer
does not act.

Cargo integration signals are trusted as `delivered` indicators but not as
`delivery_confirmed` indicators. That distinction is deliberate and must not be
collapsed in integration code.

---

## Admin Visibility Requirements

The admin panel must surface:

- orders approaching the 20-day deadline (risk queue)
- orders that have breached the 20-day deadline and not yet been cancelled
- extension requests and their approval status
- shipment events per order (provider, tracking, timestamps, source)
- delivery confirmation source (customer / admin / silent)
- cargo charge ledger entries per seller

---

## Seller Visibility Requirements

The seller panel must show:

- fulfillment deadline for each active order
- days remaining until deadline
- clear warning when the order is near or past the deadline
- shipment entry form prominently positioned for actionable orders
- delivery confirmation status (delivered vs delivery_confirmed) and its payout implications
- cargo charge deductions as a named line item in finance views

---

## What Must Not Happen

- Do not start payout countdown from `shipped` or `delivered`. Only `delivery_confirmed` starts it.
- Do not allow orders in `shipped` status to transition into cancellation states without going through return flow.
- Do not apply `delivery_confirmed` before the 72-hour silent window expires when using the automatic rule.
- Do not grant a 10-day extension without admin approval and customer notification.
- Do not merge cargo charge deductions into the commission field.
- Do not allow tracking entries to be deleted or overwritten — append new events only.
- Do not allow the 20-day breach job to create duplicate ledger or penalty records (idempotency required).

---

## Cross-Reference Files

This document must stay aligned with:

- `CLAUDE.md` — section 2.2 (delivery semantics), section 2.4 (penalty model), section 15.3 (net ruling sentences 5–8)
- `.claude/rules/07-marketplace-finance-rules.md` — cargo charge rules, net payout formula
- `.claude/rules/08-order-lifecycle-rules.md` — 20-day fulfillment commitment, shipment rules, delivery states
- `db/schema/schema.prisma` — `Shipment`, `ShipmentItem`, `OrderSellerFulfillment`, `ShipmentEvent`, `ShipmentStatus`, `AdminActionType.fulfillment_window_extended`
- `docs/06-engineering/event-status-model.md` — `delivered` vs `delivery_confirmed` state distinction
- `docs/06-engineering/queue-jobs-plan.md` — 20-day breach detection job, silent confirmation job
- `docs/07-operations/order-lifecycle.md` — cancellation rules after shipment
- `docs/07-operations/payout-lifecycle.md` — payout countdown start condition
- `docs/01-business/penalty-policy.md` — penalty consequences of 20-day breach

If delivery confirmation logic, breach timing, cargo charge rules, or extension policy
changes, update this document and the related operations and engineering docs in the same work.
