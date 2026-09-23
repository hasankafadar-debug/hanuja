# Queue jobs plan

BullMQ job plan for Hanuja asynchronous workflows.

## Candidate jobs
- payment callback processing
- shipment status sync
- delivery confirmation timer check
- payout eligibility scan
- payout batch creation
- refund deduction application
- search index updates
- media cleanup and backfill

## Rules
- job payloads must be idempotent where possible
- finance jobs must be auditable
- retry policy must be explicit for payment and payout workflows

---

## Active queue: `campaign-discount` (marketing email fan-out)

`api/jobs/campaign-discount.job.ts` implements the discount-marketing email flow that
notifies users about product discounts on items they favorited or have in their cart,
plus the existing store-follower discount notice. It runs two job types on one queue
(`CAMPAIGN_DISCOUNT`, see `api/lib/queue.ts`).

### `fan-out`

- Triggered when a seller creates or updates a discount (`DiscountRule` create/PATCH
  routes enqueue it) or when `activation-scan` promotes a scheduled rule to active.
- Notifies two audiences for a single discount campaign: store followers (existing
  behavior, unchanged in trigger shape) and users who favorited the product or have it
  in their cart (`NotificationType.product_discount_favorited` /
  `product_discount_in_cart`).
- Only sends to users with active `MarketingConsent.emailConsentAt` (favorite/cart audience
  only — store-follow notices remain governed by the pre-existing per-follow opt-out, not
  by `MarketingConsent`).
- Each audience is dispatched independently; if one audience fan-out throws, the job logs
  the error and continues so the other audience is not blocked. The job only hard-fails if
  **both** audiences error.
- Idempotency: `CampaignEmailDispatch` has `@@unique([userId, discountFingerprint, source])`.
  `discountFingerprint` is built from `discountRuleId + startsAt|createdAt`, so re-running
  fan-out for the same rule state (e.g. a retried job, or admin re-triggering) does not
  re-send. A **new** fingerprint (new `startsAt`, i.e. a materially new campaign) is
  required to re-notify the same user for the same rule.
- Additional cooldown: per `(userId, productId)`, a repeat campaign email is suppressed for
  `CAMPAIGN_EMAIL_COOLDOWN_DAYS` (default 7 days) regardless of fingerprint, to stop
  recreate-and-respam abuse (deleting/recreating a discount rule to bypass the fingerprint
  dedupe). Enforced via the `(userId, productId, createdAt)` index on
  `CampaignEmailDispatch`.

### `activation-scan`

- Repeatable job, cron **every 15 minutes**.
- Scans `DiscountRule` rows: `scheduled → active` transition (past `startsAt`) triggers a
  `fan-out` for the newly-activated rule; `active → expired` transition (past `endsAt`)
  is a state-only update with no email.
- Idempotent by construction — it only acts on rows still in the source state, so a
  retried or overlapping run cannot double-transition or double-fan-out (fan-out itself is
  additionally guarded by fingerprint dedupe above).

### Failure behavior

- Fan-out failures are logged with the `[campaign-discount]` prefix and do not block the
  discount rule create/update request that triggered them (the enqueue is fire-and-forget
  from the seller-panel route, rate-limited under `HIGH_RISK`).
- `activation-scan` failures are retried by BullMQ's standard retry policy; a missed run
  is self-healing since the next scheduled run re-scans the same state-based query.

Cross-reference: `docs/06-engineering/database-schema.md` (`MarketingConsent`,
`CampaignEmailDispatch` models), `docs/06-engineering/integrations.md` §6 (Resend sender
categories), `docs/05-security/audit-logging-plan.md` (consent trail note).

## Notification reliability — 2026-09-22

Notification producers now persist NotificationOutbox before Redis. A 15-second relay feeds
notification-dispatch (transactional) and notification-bulk (marketing). Both have bounded
BullMQ retries; exhausted events require audited admin retry. Business-transaction adoption
is phased: use recordNotification(tx, payload) when migrating an event producer. See
[phase 1 operations report](../07-operations/email-phase-1-report.md) for claims, crash recovery,
provider receipt semantics and rollout.

### Phase 2 producers inside the business transaction — 2026-09-22

Order lifecycle producers now write their outbox rows through the transaction client, so a crash
after commit cannot lose the e-mail: `checkout.createOrder` (EFT only), `payment.confirmCardPayment`,
`payment.approveEftPayment`, `payment.rejectEftPayment`, `delivery.enterTracking`,
`delivery._applyDeliveryConfirmation`, `quantity-cancellation.create`, `order.cancelOrder`,
`order.sellerReject`, `quantity-return.openRequest`, `quantity-return.decideReceipt` and the invoice
upload paths in `order-document.service`.

The legacy `return.service` flow joined them in the pre-deploy fix: its seven mutations each run in
one transaction that also writes the durable `RefundTransaction`, so no e-mail claims a refund job
that does not exist. Provider dispatch (`enqueueRefundProcessing`) stays outside the transaction via
`dispatchRefundProcessingAfterCommit`; a missed dispatch leaves a recoverable record rather than
nothing.

Still post-commit by design: `refund-notification.service` (the refund outcome is only known after the
provider answers; its deterministic eventKey prevents a duplicate).

Card orders no longer e-mail at checkout — the single "Siparişiniz Alındı" is produced when the
payment is confirmed. Event types added to the e-mail policy: `order_cancelled`,
`order_return_approved`, `order_return_rejected` and `return_status_changed` (stage-gated: only
`cargo_info_ready` produces e-mail). A policy now targets one role — copies of the same event sent to
another role stay in-app unless the producer passes an explicit `emailTo`. See
[phase 2 operations report](../07-operations/email-phase-2-report.md).

### Phase 3 — admin operation e-mails — 2026-09-23

Seven operation events now e-mail a configured operations mailbox. The mailbox has no user account,
so those outbox rows carry the reserved `OPS_RECIPIENT_ID = 'ops'` instead of a user id and their
`NotificationDelivery.userId` is null; the dispatcher writes no in-app notification for them. Being
addressed to `'ops'` is not on its own a licence to skip the role check: only the eight types in
`ADMIN_OPERATION_TYPES` (all with `role: 'admin'`) may take that path, and anything else fails with
`EMAIL_OPS_TYPE_NOT_ALLOWED` rather than being skipped. A user-bound copy of an admin-policy type
stays in-app, so the number of admins never changes how many e-mails go out.

Producers (all inside their business transaction): `quantity-cancellation.create`,
`quantity-return.openRequest`, `return.openRequest`, `dispute.openDispute`,
`return.rejectReceiptBySeller`, `quantity-return.decideReceipt`, `support-ticket.createForSeller`,
`customer-support-ticket.createForCustomer`, `checkout.createOrder` (EFT) and the seller-panel
onboarding route. `support-ticket.service` no longer sends its admin notification after commit.

`fulfillment-risk` gained a notification sweep. It scans the union of the active risk rows and every
`FulfillmentRiskNotificationState` that is not yet `resolved`, so a group that drops off the active
list is recorded as resolved and a later recurrence at the same level is notifiable again. Each group
is handled in one transaction with a version-checked claim — the outbox row is written only when the
claim wins — and a `P2002` create race is retried in a new transaction. The event id carries the
state row's `transitionSeq`, which is what makes the recurrence a new event. See
[phase 3 operations report](../07-operations/email-phase-3-report.md).

### Phase 4 — product question e-mails — 2026-09-23

Two transactional types on the `notification-dispatch` lane: `seller_product_question` (seller) and
`customer_product_question_answered` (customer). The producer is `product-question.service`, always
inside the business transaction. Each message first increments the thread's message counter, which
takes the row lock; the turn decision is read under that lock and the outbox row is written only when the
message turned the conversation over to the other side, so a burst of messages in one turn produces one
e-mail; the eventKey `product-question:{threadId}:{seller|customer}:turn:{turnSeq}` is bound to the turn,
not the message. No new queue, job or schedule. See
[phase 4 operations report](../07-operations/email-phase-4-report.md).

### Phase 5 — seller announcements — 2026-09-24

One bulk-lane type, `seller_announcement` (seller, `noreply`, no marketing consent, no List-Unsubscribe).
`EmailPolicy` gained an optional `lane`; `notificationLane` uses it before falling back to "kampanya → bulk".

New queue **`announcement-dispatch`** (repeatable `sweep` every 15 s, worker concurrency 1). Sending an
announcement only freezes its recipients; this sweep writes their outbox rows. Each tick is one bounded
transaction: `lock_timeout 2s`, `statement_timeout 5s`, Prisma timeout 10 s; a
`pg_try_advisory_xact_lock` makes it the only announcement writer; it fills the bulk lane only up to
**100 pending + queued rows**, first with unwritten recipients (`FOR UPDATE SKIP LOCKED`, batched
`createMany skipDuplicates`, deterministic eventKey `announcement:{id}:seller:{sellerId}`), then with
admin-requested bulk retries (same guards as the single-row retry, generation + 1). A lock or statement
timeout rolls the tick back and leaves the work for the next tick. The relay job is untouched, so order
e-mails never wait for it. Campaign-discount producers are not bound by the 100 cap. See
[phase 5 operations report](../07-operations/email-phase-5-report.md).
