# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Backend Architecture

## Purpose

This document defines the layered backend structure of the Hanuja marketplace,
the responsibility boundaries of each layer, the approved patterns for integrations
and background jobs, and the rules that must not be violated when adding or modifying
backend logic.

---

## Layer Overview

The backend is organized into four layers plus a background job layer. Each layer has
a single defined responsibility. Business logic must not leak across layer boundaries.

```
api/routes/       — thin HTTP handlers
api/services/     — business rules and orchestration
api/domain/       — pure domain models and calculators
api/repositories/ — Prisma persistence access
api/jobs/         — BullMQ background workers
```

---

## Layer 1: Routes (`api/routes/`)

Routes are thin HTTP handlers. They do not contain business logic.

Existing route files and their domains:

| File | Domain |
|------|--------|
| `payments.ts` | EFT approval, Iyzico webhook |
| `payouts.ts` | Payout release, hold, batch |
| `orders.ts` | Order listing and detail |
| `checkout.ts` | Cart-to-order conversion |
| `cart.ts` | Cart management |
| `catalog.ts` | Product listing and detail |
| `shipments.ts` | Tracking entry and updates |
| `returns.ts` | Return request lifecycle |
| `disputes.ts` | Dispute open and resolve |
| `penalties.ts` | Penalty listing and waiver |
| `search.ts` | Meilisearch query forwarding |
| `media.ts` | Cloudflare R2 upload coordination |
| `notifications.ts` | Notification dispatch |
| `blog.ts` | Editorial content serving |
| `user.ts` | Customer profile and address |
| `admin-analytics.ts` | Finance summary for admin |

### Route handler contract

Every route handler must follow this sequence:

1. Parse and validate request input using Zod schema.
2. Resolve auth session — reject unauthenticated requests immediately.
3. Enforce ownership or role boundary — server-side, not inferred from client state.
4. Call the relevant service function with validated, typed arguments.
5. Return a structured response using shared response helpers (`ok()`, `handleError()`).

Routes must not:
- contain conditional payout or penalty logic
- read Prisma directly — all persistence goes through repositories via services
- compute net payout amounts
- make lifecycle transition decisions
- trust client-supplied payment or status values

---

## Layer 2: Services (`api/services/`)

Services are the home of all business rules, lifecycle decisions, and finance orchestration.

Existing service files and their responsibilities:

| File | Responsibility |
|------|---------------|
| `payment.service.ts` | Payment confirmation, EFT approval, webhook idempotency |
| `payout.service.ts` | Hold activation, readiness check, release, batch prep |
| `order.service.ts` | Order state transitions, seller visibility gating |
| `penalty.service.ts` | Penalty application, waiver, ledger write |
| `return.service.ts` | Return lifecycle, payout block interaction |
| `dispute.service.ts` | Dispute lifecycle, payout block interaction |
| `checkout.service.ts` | Cart-to-order creation, coupon application |
| `delivery.service.ts` | Delivery confirmation, silent confirmation logic |
| `shipment.service.ts` | Tracking entry, delivery progression |
| `catalog.service.ts` | Product listing, slug resolution, availability |
| `seller.service.ts` | Seller account management, IBAN change flow |
| `cart.service.ts` | Cart mutation, stock checks |
| `coupon.service.ts` | Coupon validation and redemption |
| `search.service.ts` | Meilisearch query orchestration |
| `media.service.ts` | R2 upload coordination, asset registration |
| `notification.service.ts` | Notification event dispatch |
| `user.service.ts` | Profile management, address handling |
| `blog.service.ts` | Editorial content retrieval |
| `admin-analytics.service.ts` | Finance aggregation for admin dashboard |

### Service rules

- Services may call repositories and domain helpers freely.
- Services must not call other services except through well-defined composition
  (e.g. `payout.service.ts` calling `return.service.ts` to check blocking state).
- Finance math — net payout, penalty amount, hold dates — must be computed by domain
  calculators and called from services, never from routes or repositories.
- Every state transition that affects money or order lifecycle must produce an audit
  entry in the same database transaction as the state change.

---

## Layer 3: Domain (`api/domain/`)

The domain layer contains pure logic: calculators, state guards, and validators that
have no Prisma dependency.

Key domain artifacts:

- `payout-calculator.ts` — `calculateNetPayout()`, `calculateHoldUntil()`, `isHoldExpired()`
- `penalty-calculator.ts` — `calculatePenaltyAmount()`, `SILENT_DELIVERY_CONFIRMATION_HOURS = 72`
- `order-state-machine.ts` — `assertTransition()` guard for valid status moves
- `commission-resolver.ts` — four-level commission resolution: product override → category → seller → system default

Domain functions are pure: given typed inputs, they return typed outputs with no side effects.
They can be called from services and tested in isolation without a database connection.

---

## Layer 4: Repositories (`api/repositories/`)

Repositories are the only layer that imports and calls Prisma directly.

Existing repository files:

`admin-audit-log`, `blog`, `cart`, `category`, `coupon`, `dispute`, `order-line`,
`order`, `payment`, `payout`, `penalty`, `product`, `return-request`, `seller-ledger`,
`seller`, `shipment`, `user`

### Repository rules

- Repositories handle reads, writes, and transaction-scoped mutations.
- Repositories must not evaluate business policy — they do not decide whether a seller
  deserves payout, whether a penalty should apply, or whether a return blocks payout.
- `admin-audit-log.repository.ts` is append-only. No update or delete operations are
  exposed. Audit entries written in the same transaction as the state change they record.
- `seller-ledger.repository.ts` writes are append-oriented — ledger entries are never
  overwritten, only new entries are added.

---

## Layer 5: Background Jobs (`api/jobs/`)

Jobs are BullMQ workers that run time-driven or event-driven workflows outside the
request/response cycle.

| File | Trigger | Responsibility |
|------|---------|----------------|
| `payout-maturity.job.ts` | Daily repeatable | Find `hold_active` payouts past `hold_until`, transition to `payout_ready` via `payout.service.checkReadiness()` |
| `delivery-silent-confirmation.job.ts` | Every few hours | Find `delivered` orders with no customer action after 72 hours, call `delivery.service.silentConfirm()`, activate payout hold |
| `fulfillment-risk.job.ts` | Scheduled | Re-score orders near the 20-day fulfillment deadline, flag risk cases |
| `search-index-sync.job.ts` | Event-driven | Sync approved products and categories to Meilisearch; PostgreSQL is always source of truth |
| `payout-batch.job.ts` | On demand / scheduled | Prepare payout batch candidates for admin review |
| `notification-dispatch.job.ts` | Event-driven | Deliver queued notifications to customer, seller, or admin |
| `media-processing.job.ts` | Event-driven | Post-upload processing for R2 media assets |

### Job rules

- Every job must be idempotent. Re-running a job must not create duplicate finance effects,
  duplicate ledger entries, or duplicate audit records.
- Jobs that mutate finance or lifecycle state must write an audit entry with
  `actorId = 'system:<job-name>'`.
- Failed jobs must be observable — error detail must be logged at the job level.
- Jobs must not bypass service layer business rules. A job that releases a payout must
  call `payout.service.release()`, not write to the payout table directly.
- Time-sensitive logic (hold expiry, 72-hour silent confirmation) must use server-side
  timestamps from PostgreSQL, not job execution time as the authoritative clock.

---

## Transaction Boundaries

Finance operations that mutate multiple records must use a Prisma transaction to keep
state consistent. The transaction must include:

- the primary state change (e.g. payout status update)
- any seller ledger entries resulting from the change
- the audit log entry for the action

If the audit log write fails, the transaction must roll back. An action that succeeds
without an audit entry is not acceptable for any finance or lifecycle operation.

Example pattern used in `payment.service.ts` and `payout.service.ts`:

```typescript
await prisma.$transaction(async (tx) => {
  await payoutRepo.updateStatus(tx, payoutId, 'payout_paid')
  await sellerLedgerRepo.appendEntry(tx, { ... })
  await auditLogRepo.create(tx, buildAuditEntry({ ... }))
})
```

---

## Adapter Pattern for External Integrations

Provider-specific logic must be isolated behind adapters so that domain and service
layers depend on stable internal interfaces, not raw provider payload shapes.

### Iyzico (payments)

The Iyzico adapter handles:
- webhook signature verification
- payload parsing into internal `PaymentConfirmationResult` shape
- idempotency guard: a given Iyzico conversation ID is processed only once

Routes call the adapter; services receive the already-validated internal shape.
The route handler in `api/routes/payments.ts` rejects any webhook that fails signature
verification before calling the service.

### Cargo / tracking providers

Cargo status updates are ingested via `api/routes/shipments.ts` and mapped into internal
delivery event shapes by the shipment adapter before `shipment.service.ts` processes them.

### Meilisearch

`search-index-sync.job.ts` is the only writer to Meilisearch. No route or service writes
to the search index directly. PostgreSQL remains the source of truth for all catalog state.
The search index is a read projection only — it is never consulted for finance or lifecycle decisions.

---

## Idempotency Guards

The following operations must be guarded against duplicate execution:

- `payment.service.confirmFromWebhook()` — guards on Iyzico conversation ID stored in payment record
- `payout.service.release()` — guards on current payout status before transition
- `delivery.service.silentConfirm()` — checks existing status before writing `delivery_confirmed`
- `penalty.service.apply()` — checks for existing penalty record for the same order before creating

Idempotency is enforced at the service layer, not only at the job or route layer.

---

## Cross-Reference Files

- `CLAUDE.md` — approved stack and architecture constraints
- `.claude/rules/01-architecture.md` — authoritative architecture rules
- `.claude/rules/07-marketplace-finance-rules.md` — finance layer rules
- `.claude/rules/08-order-lifecycle-rules.md` — lifecycle transition rules
- `docs/06-engineering/database-schema.md` — schema and model reference
- `docs/06-engineering/event-status-model.md` — status enum definitions
- `docs/06-engineering/queue-jobs-plan.md` — job scheduling and retry config
- `docs/06-engineering/api-contracts.md` — request/response shape contracts
- `docs/06-engineering/integrations.md` — Iyzico, cargo, R2, Meilisearch adapter specs
- `docs/07-operations/payout-lifecycle.md` — payout state machine and timing rules
