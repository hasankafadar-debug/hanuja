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

## Unpaid order cancellation, EFT approval/rejection (2026-09-25)
A payment counts as collected once `Payment.confirmedAt` is set (it survives a later refund).
- `bank_transfer_waiting → cancelled_by_customer | cancelled_by_admin`: whole-order cancellation
  only (partial is rejected). The pending payment moves `pending → cancelled` with a
  `cancelled_before_confirmation` `PaymentEvent`; stock is released; `OrderCancellation` is written
  `completed` with zero refund/adjustment amounts. No `RefundTransaction`, no `SellerLedgerEntry`,
  no seller notification.
- `payment_pending` (card, 3-D Secure in flight) cannot be cancelled by the customer.
- `bank_transfer_waiting → bank_transfer_confirmed → payment_confirmed → seller_queue_ready`
  (EFT approval) runs only from `bank_transfer_waiting`; the payment update is a compare-and-swap
  on `status = 'pending'`, so it races safely with a customer cancellation.
- `bank_transfer_waiting → cancelled_due_to_payment_failure` (EFT rejection, now listed in the state
  machine): payment `pending → failed`, stock released, no refund or ledger row. Rejected when the
  order already left `bank_transfer_waiting`.
- Paid quantity-lifecycle order, admin cancellation → `cancelled_by_admin`
  (`cancellationReason: admin_cancelled`) through the quantity cancellation: refund queued, sale
  accrual reversed, no penalty. Refused once any unit shipped.
- `RefundTransactionStatus.voided` / `RefundTransactionItemStatus.voided`: a refund created for an
  order that never collected a payment (pre-fix data). Closed by
  `tools/scripts/repair-unpaid-cancellation-refunds.ts`, which appends exact ledger reversals
  (`eventKey refund-void:<entryId>`), hides both rows from the seller statement and keeps the refund
  row for audit. Reconciliation expects a net-zero ledger effect for `voided` refunds.

## Card payment attempts (iyzico 3D Secure, 2026-10-16)
Order statuses do not change while a card payment is in progress: the order stays `payment_pending` and
each try is a `CardPaymentAttempt` (`api/services/card-payment.service.ts`). Money moves only at v2 auth.

| Attempt status | Meaning | Can money have moved? |
|---|---|---|
| `initialized` | Attempt written, 3DS initialise not answered | No |
| `threeds_pending` | Bank 3DS page shown | No |
| `authorizing` | v2 auth requested, answer pending | Yes |
| `outcome_unknown` | Auth answer lost or unverifiable; awaiting reconciliation | Yes |
| `fraud_review` | iyzico `fraudStatus=0`; order not visible to the seller | Yes |
| `succeeded` | Captured (order confirmed, or reversal opened) | Yes |
| `failed` | Declined by iyzico or 3DS not verified | No |
| `expired` | Window ended before auth | No |
| `voided` / `refunded` | Reversal completed (same-day cancel / item refunds) | Returned |
| `refunded_by_provider` | iyzico refunded after fraud review | Returned |

- Transitions only move forward; a late `FAILURE` never moves `succeeded / voided / refunded` back.
- `payment_pending → payment_confirmed → seller_queue_ready`: signed v2 auth or signed payment query with
  fraud 1/2; the confirming transaction also writes the installment fields, per-item customer amounts,
  `OrderLegalSnapshot`, seller accruals and notifications.
- `payment_pending → payment_cancelled` (`cancellationReason: payment_failed`): `card-payment` worker after
  `Order.cardPaymentExpiresAt` (30 min), only when no attempt is `authorizing / outcome_unknown /
  fraud_review`; pre-auth attempts become `expired`, stock and coupon usage are released once.
- A retry on the same order expires older pre-auth attempts under the order lock; at most 5 attempts.
- `CardAttemptReversal` (one per attempt): `pending → processing → completed | uncertain | manual_required`;
  `uncertain` is settled from the iyzico reporting service, never retried blindly.

## Seller-driven return → dispute transitions (2026-05-15)
- `delivery_confirmed → return_requested`: customer opens return (only within 14
  calendar days of `deliveryConfirmedAt`; backend hard-rejects after the window).
- `return_requested → return_approved`: seller provides return cargo info
  (fast path, no admin review). `return_under_review` kept for admin override.
- `return_approved → return_in_transit`: customer submits return shipment
  (carrier + tracking number and/or cargo barcode photo).
- `return_in_transit → return_received → refund_pending → refund_completed`:
  seller confirms physical receipt; auto-refund via shared idempotent
  `refund.service` (card → Iyzico, EFT → manual) + negative `SellerLedgerEntry`.
- `return_in_transit → return_rejected`: seller rejects the received item.
- `return_rejected → dispute_open`: rejection auto-opens a `Dispute`
  (`payoutBlocked = true`), linked via `ReturnRequest.disputeId`. Conversation
  continues on the single `ReturnMessage` thread.
- `dispute_open → dispute_resolved`: admin closes; customer-favored resolution
  with an amount triggers the same idempotent refund path.
- Payout blocking unchanged: open return (`status notIn ['rejected',
  'refund_completed']`) or open dispute keeps `Payout` held/blocked.

## Order public number policy
- Customer, seller, and admin-facing order references should use `Order.publicNumber`; raw order id fallback exists only for legacy rows or failure paths.
- 2026 production sequence base is `26000000` via `orders_publicNumber_seq`.
- Yearly ops task: bump the sequence before the first order of the new year.
- Planned next bump: `ALTER SEQUENCE "orders_publicNumber_seq" RESTART WITH 27000000;` for 2027.
