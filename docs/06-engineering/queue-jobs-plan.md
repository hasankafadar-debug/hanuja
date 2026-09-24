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

## Active queue: `campaign-discount` (cart discount e-mail)

`api/jobs/campaign-discount.job.ts` runs two job types on one queue (`CAMPAIGN_DISCOUNT`, see
`api/lib/queue.ts`).

> **Phase 6 (2026-09-24):** the favorite discount e-mail (`product_discount_favorited`) and the
> store-follow discount e-mail (`store_discount_followed_seller`) are closed. Favoriters get the
> lowest-price-of-15-days e-mail from the `price-history` queue below; following a store is no
> notification reason. Queued rows of the two old types are skipped at the send gate with
> `LEGACY_CAMPAIGN_DISABLED`.

### `fan-out`

- Triggered when a seller creates a rule that is active at once or PATCHes a rule into ACTIVE (the
  seller-panel routes enqueue it), or when `activation-scan` promotes a scheduled rule.
- Audience: users who have a discounted product in their cart and active `MarketingConsent`
  (`NotificationType.product_discount_in_cart`), excluding the seller's own account.
- Before deciding, the price pipeline of the rule's products runs inline (markers, due rule
  boundaries, candidate decisions). A cart holder who also favorited the product and whose product has
  an eligible lowest-price event of this campaign gets no cart e-mail (`superseded_by_price_drop`) — the
  priority does not depend on job order.
- Each cart e-mail is a reservation (`CampaignEmailDispatch`, `status = reserved`) written in the same
  transaction as its outbox row (`eventKey = campaign-cart:{fingerprint}:user:{userId}`). The shared
  limits — one e-mail per user and product in 7 days, at most 3 per user in any rolling 24 hours,
  counted on `sending | sent | uncertain` — are checked when reserving and again at the send gate.
- `@@unique([userId, discountFingerprint, source])` keeps a retried fan-out idempotent. A failure fails
  the job so BullMQ retries it.

### `activation-scan`

- Repeatable job, cron **every 15 minutes**.
- `scheduled → active` (past `startsAt`) enqueues a `fan-out`; `active → expired` (past `endsAt`) is
  state-only. These flips do not change any price (the live status already follows the clock), so the
  price-change triggers leave no marker for them.

### Failure behavior

- The seller-panel enqueue is fire-and-forget and rate-limited under `HIGH_RISK`.
- `activation-scan` failures are retried by BullMQ; a missed run is self-healing.

Cross-reference: `docs/06-engineering/database-schema.md` (`MarketingConsent`,
`CampaignEmailDispatch`), `docs/06-engineering/integrations.md` §6, `docs/05-security/audit-logging-plan.md`.

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

### Phase 6 — lowest price of the last 15 days — 2026-09-24

New queue **`price-history`** (worker concurrency 1):

- **`tick`** every 15 s, each step its own bounded transaction:
  1. process price change markers (an unexplained change resets the key's trust before any decision),
  2. baseline untracked products (first run after deploy, products created by paths without the hook) —
     including the future rule boundaries,
  3. materialize predicted rule boundaries whose time has come (drops become candidates),
  4. decide candidates (products with unprocessed markers wait),
  5. release reservations not sent within 24 hours,
  6. advance one lowest-price event: freeze the audience once (favoriters only), then reserve and write
     outbox rows within the bulk lane's room (same 100 cap as announcements). A recipient refused by a
     limit is skipped for good; one waiting for capacity waits.
- **`reconcile`** hourly (`17 * * * *` UTC): the latest recorded price of every key must equal the
  computed one; a mismatch resets that key's trust.

New bulk-lane type `product_price_drop` (`kampanya`, List-Unsubscribe). The send gate in
`notification-dispatch` runs before both legs for `product_price_drop` and `product_discount_in_cart`: it
processes the product's pending markers inline, re-runs the full eligibility for "now", and re-checks the
shared limits atomically under a per-user advisory lock; the reservation then moves `sending → sent`,
back to `reserved` on a definite failure, or to `uncertain` (counted, never retried automatically).

The history itself does not depend on this queue: every hooked write records in its own transaction, rule
boundaries are written ahead with their exact times, and database triggers mark every other change. See
[phase 6 operations report](../07-operations/email-phase-6-report.md).
