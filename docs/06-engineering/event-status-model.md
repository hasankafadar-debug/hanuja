# Event status model

Defines event and status semantics for the Hanuja domain.

## Key points
- statuses are not interchangeable with events
- `delivery_confirmed` is the payout timer start condition
- state transitions must be explicit and validated
- admin override events should be distinguishable from normal automated transitions

## Candidate entities
- order
- shipment
- return
- refund
- payout
- seller ledger entry

## Required outputs
- allowed transitions
- triggering actor or system
- side effects
- audit log requirement

## Penalty reasons
- `seller_rejected_paid_order` — fixed 20% rate, applied when seller rejects after payment confirmation.
- `late_shipment_daily_accrual` — daily 1% accrual once the fulfillment commitment date passes. Idempotent per calendar day; `accrualDayCount` reaches 20 → triggers order auto-cancel.
- `fulfillment_20day_breach` — **legacy**. Existing rows are preserved for audit; no new rows are written by the current pipeline.
- `other` — manual admin penalty.

## Order cancellation reasons
Stored on `Order.cancellationReason` (`OrderCancellationReason` enum):
- `customer_requested`, `admin_cancelled`, `payment_failed`, `seller_rejected`, `other` — historical categories.
- `auto_canceled_20day_breach` — set when the late-shipment worker auto-cancels on day 20 of accrual; refund flow is initiated in the same transaction.

## Daily accrual job → auto-cancel transition
- Source state: any of `seller_queue_ready`, `seller_reviewing`, `seller_accepted`, `preparing`, `awaiting_shipment`.
- Trigger: BullMQ `fulfillment-risk` worker; `Penalty.accrualDayCount >= 20`.
- Target state: `cancelled_due_to_20day_breach` (terminal).
- Side effects: refund initiated, ledger entries emitted only for the new accrual days, `AdminAuditLog` entry recorded with system actor.
