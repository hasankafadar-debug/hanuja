# Testing and Release Rules

## Purpose

This file defines the non-negotiable testing and release rules of the Hanuja marketplace.

It exists to keep quality, safety, and release discipline consistent across:

- storefront
- seller panel
- admin panel
- API routes
- domain services
- database migrations
- queue jobs
- payments
- payouts
- penalties
- returns and disputes
- security-sensitive actions
- SEO-sensitive route behavior

If implementation conflicts with this file, this file wins unless a newer approved engineering rule replaces it.

## Core Testing and Release Principle

Hanuja must not be treated like a low-risk content website.

It is a marketplace platform with:

- money flow
- payout timing
- seller ledger effects
- status transitions
- return/dispute consequences
- security-sensitive admin actions
- SEO-permanent route decisions

Because of that:

- critical behavior must be tested
- high-impact changes must be reviewed carefully
- release must be controlled
- rollback thinking must exist before risky changes ship

Never ship finance, lifecycle, or security-sensitive logic based only on manual confidence.

## Quality Priority Order

When speed conflicts with quality, use this priority:

1. finance correctness
2. lifecycle correctness
3. security safety
4. data integrity
5. rollback safety
6. operational observability
7. UX polish
8. shipping speed

Never prioritize release speed over payout correctness or order-state correctness.

## Required Test Layers

Hanuja should use multiple test layers, not a single testing style.

Expected test areas:

- `tests/unit`
- `tests/integration`
- `tests/e2e`
- `tests/security`

Where useful, add additional test support for:

- queue jobs
- provider adapters
- schema/data migrations
- SEO route generation
- admin action audit behavior

## Unit Test Rules

Unit tests are required for deterministic business logic.

### Good unit test targets

- net payout calculation
- penalty calculation
- hold-period date logic
- silent delivery confirmation timing logic
- route/slug normalization helpers
- canonical URL generation helpers
- masking and validator helpers
- small risk-scoring predicates
- status transition guards

### Unit test rules

- keep tests fast
- keep them deterministic
- avoid unnecessary external dependency coupling
- test explicit business meaning, not only incidental implementation details

Do not skip unit tests for pure finance and lifecycle calculations.

## Integration Test Rules

Integration tests are required for cross-layer flows.

### High-priority integration targets

- payment confirmation flow
- seller order visibility after payment confirmation
- seller rejection penalty application
- order status transitions
- `delivered` → `delivery_confirmed` logic
- payout hold activation
- payout readiness resolution
- refund offset behavior
- negative balance carryover
- admin waiver flow
- bank transfer / EFT approval flow
- webhook verification and idempotency
- queue job processing with persistence effects

### Rules

- test real service/repository interaction
- test database effects where correctness matters
- test event/history creation where relevant
- test idempotency for retryable flows
- test blocked-state behavior, not only happy paths

Do not rely only on unit tests for cross-entity finance or order flows.

## End-to-End Test Rules

E2E tests are required for critical user journeys.

### Core storefront journeys

- browse → product → cart → checkout
- order creation with approved payment flow
- customer order visibility
- return request initiation where applicable

### Core seller journeys

- seller sees only paid orders
- seller fulfills order
- seller enters shipment/tracking
- seller sees payout hold and payout-ready states
- seller sees deductions and penalties

### Core admin journeys

- admin approves EFT payment
- admin reviews delayed order
- admin sees payout blocked reason
- admin applies or waives penalty with audit trail
- admin handles return/dispute state transitions

### E2E rules

- test critical role boundaries
- test realistic interface flows
- keep E2E coverage focused on high-value flows
- do not try to replace all unit/integration tests with E2E

## Security Test Rules

Security-sensitive behavior must be tested intentionally.

### Security test areas

- auth/session enforcement
- role-based access boundaries
- seller data isolation
- admin action permission enforcement
- payout/bank detail protection
- secret leakage prevention in responses/logs where testable
- webhook verification behavior
- invalid ownership access attempts
- unsafe direct object reference attempts

### Rules

- test forbidden access cases
- test privilege boundary failures
- test that sensitive actions require authorization
- test that unsafe states are blocked, not only valid states allowed

Do not test only success paths in security-critical surfaces.

## Finance Test Rules

Finance logic requires stronger coverage than ordinary UI behavior.

### Must-test finance concepts

- gross vs net payout separation
- commission application
- cargo deduction application
- ad/service fee deduction application
- penalty deduction application
- refund deduction application
- negative balance behavior
- payout block rules
- payout-ready rules
- payout-paid state transition
- manual adjustment effects
- seller ledger entry creation

### Rules

- finance math must be explicit and tested
- all major deduction categories must be separately testable
- seller ledger effects must be verifiable
- payout timing must be verified against `delivery_confirmed`, not guessed

Do not ship finance changes without relevant automated tests.

## Lifecycle Test Rules

Order lifecycle behavior must be tested as stateful behavior.

### Must-test lifecycle concepts

- payment-confirmed seller visibility
- seller rejection path
- 20-day breach path
- shipment path
- delivery path
- delivery confirmation path
- return opening path
- dispute opening path
- cancellation category distinctions
- payout hold relation to lifecycle states

### Rules

- verify both happy and blocked paths
- verify state history where required
- verify state distinction between `delivered` and `delivery_confirmed`
- verify that shipped orders do not fall back into naive cancellation behavior

Do not collapse lifecycle tests into one shallow “order updated successfully” test.

## Queue and Background Job Test Rules

Background jobs are critical to Hanuja behavior.

### Must-test job types

- payout maturity jobs
- delivery silent-confirmation jobs
- reconciliation jobs
- retryable provider sync jobs
- notification jobs if they affect visible state sequencing
- search indexing jobs where content visibility matters

### Rules

- jobs should be idempotent where possible
- retries must not create duplicate finance effects
- failure and re-run behavior should be testable
- time-dependent logic should be testable with controlled clocks or equivalents

Do not leave timer-driven business rules untested.

## Provider and Integration Test Rules

Integrations must be tested through controlled interfaces.

### Important integration areas

- Iyzico payment verification
- webhook/callback handling
- cargo or tracking status ingestion
- Cloudflare R2 file behavior where relevant
- Meilisearch indexing sync where relevant

### Rules

- use sandbox/mock/test environments when possible
- do not depend on live providers in routine automated test runs
- test adapter mapping from provider payload to domain shape
- verify duplicate callback safety
- verify malformed payload rejection where relevant

## SEO Test Rules

SEO-sensitive behavior must be tested when route or metadata logic changes.

### Must-test SEO behavior when relevant

- slug generation
- route family generation
- canonical output
- robots/meta behavior
- sitemap inclusion logic
- redirect behavior after slug change
- entity namespace separation

### Rules

- test permanent URL helpers
- test canonical determinism
- test route collisions where possible
- test redirect map behavior for changed slugs

Do not treat SEO logic as “too simple to test” when it affects route permanence.

## Migration Test Rules

Database migrations can be high-risk and must be treated carefully.

### Rules

- review every migration for data integrity impact
- test destructive or structural migrations before production
- consider backward compatibility for existing records
- verify enum/status changes against old data
- verify finance/lifecycle schema changes against realistic sample data

### Never do these

- run risky production migration without review
- rename or split finance/lifecycle fields without thinking through old records
- ship migration and app logic that disagree on status meaning

## Test Data Rules

Test data should represent real domain complexity.

### Include realistic examples for

- paid and unpaid orders
- seller rejection cases
- delayed orders
- delivered but not confirmed cases
- payout hold cases
- refund-after-payout cases
- negative balance cases
- penalty waiver cases
- multiple seller states
- admin override scenarios

### Rules

- use clear test fixtures
- avoid meaningless lorem-style business data where scenario meaning matters
- do not use production secrets or unsafe real private data in tests

## Review Rules Before Release

High-impact changes require careful review.

### High-impact change examples

- payment flow changes
- payout logic changes
- seller ledger changes
- order status model changes
- penalty logic changes
- refund/dispute logic changes
- auth/permission changes
- SEO route/slug/canonical changes
- provider integration changes
- bank detail security flow changes

### Review expectations

For high-impact changes:

- code review must happen
- docs must be checked
- test coverage must be verified
- migration/release impact must be considered
- rollback implications must be considered

## Release Gate Rules

A release is not ready if core safety conditions are not met.

### Minimum release gate expectations

- relevant tests pass
- migrations reviewed
- environment config checked
- high-impact docs updated
- no known blocking finance/security regression
- queue/job implications reviewed where relevant
- observability/logging is adequate for risky changes

### Strong release blockers

Do not release if there is known breakage in:

- payment confirmation
- seller order visibility rules
- payout timing logic
- penalty application
- return/refund offset behavior
- admin high-impact authorization
- canonical/redirect logic after major SEO route changes

## Manual QA Rules

Automated testing is required, but manual QA still matters.

### Manual QA is especially important for

- visual regressions
- seller/admin workflow clarity
- confirmation/warning UX for risky actions
- mobile storefront behavior
- finance summary readability
- complex cross-role scenarios

### Rules

- manual QA does not replace automated tests
- manual QA should focus on user/operator confidence and flow sanity
- manual QA should include critical role-based journeys after major changes

## Environment Rules for Release

Environment discipline is required.

### Rules

- development, staging, and production must stay clearly separated
- sandbox/test provider credentials should be used outside production
- do not accidentally point dev/staging to real payment or payout actions unless explicitly intended
- environment variables must be validated before release
- sensitive production config must not be improvised during deploy

## Observability Rules

Releases must be observable enough to detect problems quickly.

### Important release-observable areas

- payment confirmation failures
- payout job failures
- webhook processing failures
- delayed order logic failures
- admin override actions
- refund/dispute processing failures
- search indexing failures where relevant

### Rules

- high-risk flows should emit enough logs/metrics/events for investigation
- silent failures are unacceptable in finance and lifecycle flows
- release should not depend on “we’ll notice if users complain”

## Rollback and Recovery Rules

Risky releases must consider rollback or recovery before shipping.

### Rules

- think about rollback path for finance/lifecycle changes
- if rollback is not simple, define recovery steps
- irreversible migration impact must be reviewed carefully
- queue and data repair implications must be considered

### Never do these

- ship risky payout/order changes with no rollback thinking
- assume production hotfixing will be easy later
- rely on manual database edits as the normal recovery plan

## Documentation Update Rules

When a release changes business-significant behavior, update docs in the same work.

### At minimum

- payout logic change → finance and operations docs
- lifecycle change → order/event docs
- security change → security docs
- route/slug/canonical change → SEO docs
- admin workflow change → admin/security/ops docs

Release is incomplete if code changed but source-of-truth docs stayed stale.

## Anti-Patterns Claude Must Avoid

Do not:

- ship finance logic without tests
- ship lifecycle changes with only manual confidence
- skip integration tests for cross-entity flows
- rely only on E2E for all quality
- treat queue logic as untestable
- release risky migrations casually
- ignore rollback/recovery thinking
- merge SEO route changes without redirect/canonical review
- treat staging as optional for high-impact flows
- assume “small code diff” means low release risk

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/01-architecture.md`
- `.claude/rules/02-coding-standards.md`
- `.claude/rules/04-seo-rules.md`
- `.claude/rules/05-security-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/06-engineering/queue-jobs-plan.md`
- `docs/06-engineering/event-status-model.md`
- `docs/06-engineering/deployment-environments.md`
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/05-security/audit-logging-plan.md`
- `docs/04-seo/redirect-canonical-plan.md`

If testing or release expectations change, update the connected docs in the same work.