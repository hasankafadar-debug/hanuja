# Architecture Rules

## Purpose

This file defines the non-negotiable architecture rules of the Hanuja marketplace.

It exists to keep technical decisions consistent across:

- storefront
- seller panel
- admin panel
- shared packages
- API and domain services
- database design
- search infrastructure
- queue and background jobs
- storage
- deployment environment
- cross-cutting concerns such as auth, SEO, and security

If implementation conflicts with this file, this file wins unless a newer approved architecture decision replaces it.

## Core Architecture Principle

Hanuja must be built as a **structured, modular marketplace platform**, not as a single tangled web app.

Architecture should optimize for:

1. business rule clarity
2. finance correctness
3. operational scalability
4. long-term maintainability
5. safe iteration speed

Never optimize for short-term coding speed by collapsing domain boundaries or mixing unrelated concerns.

## Approved Technology Direction

Unless an explicitly approved document changes the stack, the default architecture is: :contentReference[oaicite:1]{index=1}

- **Framework:** Next.js 14+ with App Router
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Auth:** Better Auth
- **Payments:** Iyzico
- **Queue / background jobs:** BullMQ + Redis
- **Search:** Meilisearch
- **Storage:** Cloudflare R2
- **Monorepo:** Turborepo
- **Deployment:** Coolify

Do not casually swap core infrastructure choices without documenting reason, scope, and migration impact. :contentReference[oaicite:2]{index=2}

## Monorepo Principle

Hanuja should be organized as a monorepo with clearly separated applications and shared packages. :contentReference[oaicite:3]{index=3}

### Main apps

- `apps/web` → customer storefront
- `apps/seller-panel` → seller workspace
- `apps/admin-panel` → admin operations

### Shared packages

- `packages/ui`
- `packages/config`
- `packages/types`
- `packages/seo`
- `packages/security`

### Backend and persistence areas

- `api/`
- `db/`
- `tests/`
- `tools/`

Do not treat the monorepo as one giant app with arbitrary cross-imports.

## App Responsibility Rules

Each app must have a clear primary responsibility.

### `apps/web`
Customer-facing storefront responsibility:

- discovery
- browsing
- product detail
- cart/checkout
- customer account surfaces
- content and SEO surfaces

### `apps/seller-panel`
Seller-facing operational responsibility:

- catalog management
- pricing/inventory management
- order fulfillment
- tracking/shipment actions
- payout and deduction visibility
- seller settings

### `apps/admin-panel`
Admin operational responsibility:

- payment review
- seller oversight
- order oversight
- payout review
- penalty/waiver actions
- dispute and risk operations
- moderation
- audit visibility

Do not let one app become the uncontrolled owner of another app’s core responsibilities.

## Layering Principle

Business logic must be layered clearly.

Recommended responsibility split:

- **UI layer** → rendering, interaction, local UX logic
- **route/controller layer** → request/response coordination
- **service/domain layer** → business rules and orchestration
- **repository/data access layer** → persistence access
- **database layer** → schema, migrations, data integrity

Never bury finance, payout, penalty, or lifecycle logic in UI components.

## Domain-Driven Separation

Hanuja has multiple domains and they should remain explicit.

Core domains include:

- auth and identity
- catalog
- category and navigation
- search
- cart and checkout
- payments
- orders
- fulfillment/shipment
- delivery confirmation
- payouts
- penalties
- returns
- disputes
- seller management
- admin operations
- audit and risk
- SEO and content

Do not merge unrelated domains into vague “utils” or generic service buckets.

## Domain Naming Rules

Use domain language that matches business meaning.

Prefer:

- `payout`
- `penalty`
- `deliveryConfirmed`
- `refund`
- `dispute`
- `sellerLedger`
- `paymentConfirmed`

Avoid vague names such as:

- `processData`
- `updateStuff`
- `marketplaceHelper`
- `financeThing`

Architecture should make business meaning obvious from file and function names.

## API Structure Rules

API routes should stay thin.

### API layer responsibilities

- validate input
- resolve auth/session
- enforce permission boundary
- call domain/service layer
- return structured result
- map errors to stable response shape

### API layer must not own

- payout math
- penalty policy
- order lifecycle decisions
- SEO route generation policy
- seller ledger mutation rules

Do not place core business decisions directly in route handlers.

## Service and Domain Layer Rules

The service/domain layer is the main home for business rules.

### Good use cases for service/domain layer

- confirming payment
- making order visible to seller
- applying seller rejection penalty
- transitioning order state
- starting payout hold
- resolving payout readiness
- calculating net payout
- applying refund offsets
- generating canonical entity URL references
- validating seller bank detail change flow

### Rules

- keep business logic explicit
- keep side effects traceable
- prefer composable domain services
- prefer deterministic business rules over hidden branching
- separate orchestration from primitive helpers

## Repository and Data Access Rules

Repositories should handle persistence interaction, not business policy.

### Repository responsibilities

- read and write entities
- query lists/details
- persist events/history
- support transaction boundaries where needed

### Repository must not decide

- whether a seller deserves payout
- whether penalty should apply
- whether return should block payout
- whether a route is canonical
- whether a dispute is resolved

Repositories are storage gateways, not business policy engines.

## Database Design Rules

PostgreSQL + Prisma is the approved persistence direction. :contentReference[oaicite:4]{index=4}

### Database expectations

- relational integrity for core business entities
- explicit references across orders, payments, payouts, penalties, refunds, and sellers
- enum-driven status fields where helpful
- history/event tables for critical transitions
- auditable finance structures
- migration-first schema evolution

### Strongly expected concepts

The system should model at least these kinds of entities clearly:

- user
- seller
- sellerProfile or sellerAccount
- sellerLedger
- sellerBankDetail
- product
- category
- collection or curated surface where needed
- order
- orderLine
- payment
- shipment
- orderStatusHistory
- payout
- penalty
- refund
- dispute
- mediaAsset
- adminAuditLog

Do not flatten important finance and lifecycle concepts into a few overloaded tables.

## Transaction and Consistency Rules

Critical finance and lifecycle operations should be transaction-aware.

Examples:

- payment confirmation
- seller ledger mutation
- penalty application
- refund application
- payout state transition
- delivery confirmation transition
- admin finance adjustment

Where a change affects multiple records with correctness requirements, use safe persistence boundaries.

Do not allow partial finance mutation without recovery or traceability.

## Event and History Rules

Important system transitions should be recorded in history/event style records.

Examples:

- payment confirmed
- seller notified
- seller rejected
- shipment entered
- delivered
- delivery confirmed
- payout hold started
- payout released
- refund completed
- penalty waived
- admin override applied

Use append-oriented history where meaningful.
Do not rely only on overwriting current state.

## Queue and Background Job Rules

BullMQ + Redis is the approved background job direction. :contentReference[oaicite:5]{index=5}

Background jobs are required for workflows such as:

- payout maturity countdown processing
- payout batch preparation
- delivery silent-confirmation timers
- reconciliation jobs
- retryable integration syncs
- search indexing updates
- media processing where needed
- notification dispatch where needed

### Rules

- jobs must be idempotent where possible
- retry behavior must be safe
- finance jobs must be auditable
- failed jobs must be observable
- do not hide business-critical timing in ad hoc cron snippets

Queue architecture must align with `docs/06-engineering/queue-jobs-plan.md`. :contentReference[oaicite:6]{index=6}

## Search Architecture Rules

Meilisearch is the approved search direction. :contentReference[oaicite:7]{index=7}

### Search should be used for

- storefront search
- category/product discovery
- potentially seller/product admin search support if appropriate

### Rules

- search index should not be the source of truth
- PostgreSQL remains the primary system of record
- search sync should be intentional and recoverable
- unpublished or non-public entities must not leak into public search indexes
- SEO and search should remain aligned in terms of public entity visibility

## Storage Rules

Cloudflare R2 is the approved storage direction for media assets. :contentReference[oaicite:8]{index=8}

### Storage expectations

- product images
- store assets
- dispute/return evidence if approved
- generated files where appropriate

### Rules

- storage references should be abstracted cleanly
- uploaded asset access must respect authorization where relevant
- file paths/names should not be blindly trusted
- storage logic should not leak provider-specific assumptions everywhere

## Auth and Session Architecture Rules

Better Auth is the approved auth direction. :contentReference[oaicite:9]{index=9}

### Rules

- auth should be centralized
- role-aware access must be enforced server-side
- app surfaces must not each invent their own auth model
- customer, seller, and admin access concerns should stay explicit
- privileged actions must remain audit-aware

Do not build fragmented auth behavior separately in each app without shared rules.

## Shared Package Rules

Shared packages should contain stable, reusable logic.

### `packages/ui`
Shared design system and reusable components.

### `packages/config`
Shared config such as TypeScript, lint, Tailwind, and build config.

### `packages/types`
Shared domain-safe TypeScript types and contracts.

### `packages/seo`
Centralized metadata, route helpers, canonical helpers, structured data builders.

### `packages/security`
Rate limiting, validators, masking helpers, security utilities.

### Rules

- shared packages should hold cross-app logic only
- do not dump app-specific code into shared packages
- shared code should be versioned through the monorepo, not copied per app
- keep package boundaries meaningful

## Frontend Architecture Rules

Each app should have a predictable internal structure.

Recommended concepts include:

- routes/pages
- layouts
- feature modules
- reusable components
- API clients/adapters
- view models or presentation helpers where useful
- form schemas
- state handling with minimal confusion

### Rules

- do not mix every feature into global component folders
- prefer feature grouping over random file scattering
- keep SEO logic centralized for storefront pages
- keep finance/order state display driven by real backend states, not guessed client states

## Backend Architecture Rules

Backend logic should be explicit and typed.

Recommended areas under `api/` include:

- `routes/`
- `services/`
- `domain/`
- `repositories/`
- `jobs/`

### Rules

- keep business rules close to domain/services
- isolate provider integrations behind adapters or service boundaries
- keep webhook handling safe and idempotent
- keep payout/penalty/refund logic centralized
- do not duplicate core business rules in multiple endpoints

## Integration Architecture Rules

Integrations should be isolated behind stable interfaces.

Likely integration groups include:

- Iyzico
- cargo/shipping providers
- Meilisearch sync
- Cloudflare R2
- notification providers
- optional analytics or moderation services

### Rules

- integration-specific payload logic should be isolated
- provider failures should be handled safely
- integration retries should be observable
- domain logic should not depend directly on raw provider payload shapes everywhere

## Environment and Deployment Rules

Coolify is the approved deployment direction. :contentReference[oaicite:10]{index=10}

### Environment expectations

- local
- staging
- production

### Rules

- keep environment config explicit
- separate sandbox/test providers from production
- do not point local accidentally to real payment/payout behavior unless explicitly intended
- deployment assumptions must be documented in `docs/06-engineering/deployment-environments.md` :contentReference[oaicite:11]{index=11}

## Testing Architecture Rules

Architecture should support testing, not fight it.

Expected test layers:

- `tests/unit`
- `tests/integration`
- `tests/e2e`
- `tests/security`

### Rules

- domain logic should be testable without full UI boot
- critical finance flows require integration-style confidence
- route handlers should not be the only place where behavior can be tested
- queue jobs and integrations should have testable seams

## SEO Architecture Rules

SEO logic must be centralized and deterministic.

### Rules

- route generation must be stable
- slug generation must not be duplicated in random components
- canonical logic must be centralized
- metadata generation should be centralized
- redirect logic should be governed by SEO docs
- storefront SEO behavior must not leak into seller/admin panels unnecessarily

Architecture must align with the SEO docs and route permanence strategy. :contentReference[oaicite:12]{index=12}

## Security Architecture Rules

Security is a structural architecture concern, not only a middleware checkbox.

### Rules

- authorization must be server-enforced
- audit logging must be planned at architecture level
- payout and bank detail flows must be protected structurally
- secret handling must be environment-based
- finance/admin actions must remain traceable
- sensitive logic must not live only in frontend state

## Documentation Alignment Rules

Architecture changes must update the matching docs in the same work.

At minimum:

- stack change → update architecture docs and main scope docs
- domain/entity change → update database/schema docs
- lifecycle change → update event/status docs
- payout/finance logic move → update finance and ops docs
- route/SEO architecture change → update SEO docs
- deployment/env change → update deployment docs

## Anti-Patterns Claude Must Avoid

Do not:

- collapse all apps into one mixed code surface
- bury payout/penalty/order logic in UI or route handlers
- let search become source of truth
- use shared packages as dumping grounds
- let provider-specific code leak everywhere
- build hidden cron logic outside the approved queue model
- flatten domain entities into vague generic tables
- duplicate business rules across apps
- casually replace approved core stack pieces
- let architecture drift away from documented business rules

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/05-security-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `.claude/rules/04-seo-rules.md`
- `docs/06-engineering/system-architecture.md`
- `docs/06-engineering/frontend-architecture.md`
- `docs/06-engineering/backend-architecture.md`
- `docs/06-engineering/database-schema.md`
- `docs/06-engineering/api-contracts.md`
- `docs/06-engineering/event-status-model.md`
- `docs/06-engineering/integrations.md`
- `docs/06-engineering/queue-jobs-plan.md`
- `docs/06-engineering/deployment-environments.md`

If architecture changes, update the connected engineering, finance, SEO, and security docs in the same work.