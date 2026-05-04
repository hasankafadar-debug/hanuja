# Son güncelleme: 2026-04-18
# Durum: taslak v1

# System Architecture — Hanuja

## Purpose

This document describes the system-level architecture of the Hanuja marketplace.
It is the reference for monorepo structure, service layering, infrastructure choices, inter-app boundaries,
and non-negotiable platform constraints.

Source of truth order: `CLAUDE.md` > `.claude/rules/01-architecture.md` > this file.

---

## Monorepo Layout

Hanuja is organized as a Turborepo monorepo. The directory layout reflects domain responsibility, not convenience.

```
apps/
  web/              — Customer storefront (Next.js 14, :3000)
  seller-panel/     — Seller operational workspace (Next.js 14, :3001)
  admin-panel/      — Admin operations dashboard (Next.js 14, :3002)

api/
  routes/           — Thin HTTP handlers: validate input, call services, return response
  services/         — Business orchestration: lifecycle, finance, payout, penalty, return
  domain/           — Pure business logic primitives: calculators, state machines, guards
  repositories/     — Persistence access only: Prisma queries, no business policy
  jobs/             — BullMQ workers: payout maturity, delivery timers, reconciliation, search sync
  lib/              — Shared API utilities: Prisma client, error types, auth helpers

packages/
  ui/               — Shared design system and reusable components
  config/           — Shared TypeScript, lint, Tailwind configuration
  types/            — Shared domain-safe TypeScript types and contracts
  seo/              — Metadata builders, canonical helpers, JSON-LD generators, sitemap helpers
  security/         — Rate limiting, validators, masking, fraud scoring, audit utilities

db/
  schema/           — Prisma schema (single schema.prisma)
  migrations/       — Prisma migration history
  seeds/            — Seed data for local and staging environments

tests/
  unit/             — Pure logic: calculators, validators, slug helpers, status guards
  integration/      — Cross-layer flows: payment confirmation, payout hold, lifecycle transitions
  e2e/              — Critical user journeys: checkout, seller fulfillment, admin finance actions
  security/         — Auth boundaries, ownership checks, privilege escalation attempts

tools/
  generators/       — Code generation helpers
  scripts/          — Dev and release scripts
  validators/       — Schema and environment validators
```

---

## Approved Technology Stack

| Concern              | Choice              | Notes                                          |
|----------------------|---------------------|------------------------------------------------|
| Frontend framework   | Next.js 14 App Router | All three apps                               |
| Language             | TypeScript (strict) | No `any` in business-critical paths           |
| Database             | PostgreSQL          | Primary system of record                      |
| ORM                  | Prisma              | Migration-first schema evolution              |
| Auth                 | Better Auth         | Centralized, role-aware, shared across apps   |
| Payments             | Iyzico              | Sandbox credentials locally; never production locally |
| Queue / jobs         | BullMQ + Redis      | Payout maturity, delivery timers, sync jobs   |
| Search               | Meilisearch         | Read projection only; never source of truth   |
| Object storage       | Cloudflare R2       | Product images, dispute evidence, media       |
| Monorepo tooling     | Turborepo           | Shared build and task orchestration           |
| Deployment           | Coolify             | Local → staging → production environments     |

Do not swap any core stack choice without a documented reason, scope, and migration plan.

---

## Service Layering

All business behavior must follow this layering. No layer may reach past its boundary.

```
HTTP Request
    │
    ▼
api/routes/         — Input validation (Zod), auth/session resolution,
                      permission boundary, call service, return shaped response
    │
    ▼
api/services/       — Business orchestration: lifecycle transitions, finance decisions,
                      payout eligibility, penalty evaluation, return/refund offset logic
    │
    ▼
api/domain/         — Pure business primitives: payout calculator, penalty calculator,
                      order state machine, delivery confirmation logic, slug normalization
    │
    ▼
api/repositories/   — Prisma queries: read entities, write entities, persist events/history,
                      support transaction boundaries. No business policy here.
    │
    ▼
PostgreSQL          — Source of truth for all finance, lifecycle, and identity state
```

### Layer constraints

- Routes must not contain payout math, penalty policy, or lifecycle decisions.
- Repositories must not decide payout eligibility, penalty applicability, or return resolution.
- Domain primitives must be pure and testable without a database connection.
- Finance mutations affecting multiple records must use Prisma transactions.

---

## PostgreSQL as Source of Truth

PostgreSQL is the authoritative system of record for:

- order state and history
- payment confirmation
- payout hold and release
- seller ledger entries
- penalty records
- return and dispute state
- admin audit log entries

Meilisearch is a **read projection only**. It must never be consulted for finance decisions,
lifecycle state, or seller visibility eligibility. Search indexes may lag behind; the database never should.

---

## Append-Only Status Transitions

Status transitions are append-only by design.

For every critical lifecycle event, a history record is written alongside the current state update.
Direct state overwrites without a history entry are not acceptable for orders, payments, payouts, penalties, or disputes.

This supports:
- admin troubleshooting
- seller finance auditing
- reconciliation
- dispute resolution

The `orderStatusHistory`, `adminAuditLog`, and equivalent event tables fulfill this requirement.

---

## Finance Logic — Server-Side Only

All payout calculations, penalty amounts, commission deductions, and ledger mutations must run on the server.

Finance math must never happen in:
- React components
- Client-side state
- Browser-accessible API routes that bypass service layer authorization

The seller net payout formula is computed in `api/domain/payout-calculator.ts`.
The 20% penalty rate is computed in `api/domain/penalty-calculator.ts`.
These are the canonical locations for those computations.

---

## Inter-App Boundaries

The three Next.js apps share auth via Better Auth (trusted origins across all three ports).
They do not share route handlers with each other.

Each app enforces its own server-side authorization:
- `apps/web`: customer session required for account/order routes; public for storefront
- `apps/seller-panel`: seller or admin role required on all panel routes; middleware enforces this
- `apps/admin-panel`: admin role required on all panel routes; middleware enforces this

Seller panel server components call `api/services/` directly (same process in monorepo).
Admin panel server components call `api/services/` directly.
Storefront server components call `api/services/` directly for product, category, and order data.

No app reaches into another app's internal modules.

---

## Background Jobs

BullMQ workers run in `api/jobs/` and are registered in `api/worker.ts`.

Critical job types:
- Payout maturity: evaluates 30-day hold completion after `delivery_confirmed`
- Delivery silent-confirmation: promotes `delivered` to `delivery_confirmed` after 72-hour no-objection window
- Reconciliation: cross-checks order, payment, and payout records for consistency
- Search index sync: propagates product/category changes to Meilisearch
- Notification dispatch: sends seller and customer notifications for lifecycle events

All jobs must be idempotent. Finance jobs must write audit records. Failed jobs must be observable via BullMQ dashboard or logging.

---

## Environment Separation

| Environment | Purpose                        | Payment provider    |
|-------------|--------------------------------|---------------------|
| local       | Development                    | Iyzico sandbox      |
| staging     | QA and integration testing     | Iyzico sandbox      |
| production  | Live marketplace               | Iyzico production   |

Never configure local or staging environments to use Iyzico production credentials.
Environment config is documented in `docs/06-engineering/deployment-environments.md`.

---

## Cross-Reference

This document must stay aligned with:
- `.claude/rules/01-architecture.md` — authoritative architecture rules
- `CLAUDE.md` sections 5 and 6 — stack and directory map
- `docs/06-engineering/backend-architecture.md` — API and service layer detail
- `docs/06-engineering/frontend-architecture.md` — App Router and component patterns
- `docs/06-engineering/database-schema.md` — Prisma schema and entity model
- `docs/06-engineering/queue-jobs-plan.md` — Job definitions and scheduling
- `docs/06-engineering/event-status-model.md` — Status transitions and history model
- `docs/07-operations/payout-lifecycle.md` — Payout hold and release flow
