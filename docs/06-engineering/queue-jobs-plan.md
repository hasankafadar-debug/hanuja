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
