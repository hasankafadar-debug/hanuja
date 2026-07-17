# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Hanuja — Claude Code Main Instructions

## 0) Development commands

**Package manager:** `pnpm@10.0.0` (required — do not use npm or yarn)

### Root-level commands (run from repo root via Turborepo)
```bash
pnpm dev          # start all apps in parallel (web :3000, seller-panel :3001, admin-panel :3002)
pnpm build        # build all apps and packages
pnpm lint         # lint all workspaces
pnpm typecheck    # type-check all workspaces
pnpm test         # run all tests
pnpm format       # format all workspaces
```

### Running a single app
```bash
pnpm --filter web dev
pnpm --filter seller-panel dev
pnpm --filter admin-panel dev
```

### Running a single test file
```bash
pnpm --filter <package> test -- <path-to-file>
```

### Test structure
Tests live in `tests/` at the repo root, organized by layer:
- `tests/unit/` — pure logic: calculators, validators, slug helpers, status guards
- `tests/integration/` — cross-layer flows: payment confirmation, payout hold, lifecycle transitions
- `tests/e2e/` — critical user journeys: checkout, seller fulfillment, admin finance actions
- `tests/security/` — auth boundaries, ownership checks, privilege escalation attempts

### Local developer overrides
Copy `CLAUDE.local.md.example` to `CLAUDE.local.md` for machine-specific notes (gitignored). Default local ports: web `:3000`, seller-panel `:3001`, admin-panel `:3002`. Always use sandbox payment credentials locally.

---

## 1) Purpose of this repository
Hanuja is a Türkiye-focused multi-vendor marketplace for home, office, decor, furniture, and lifestyle products.
This repository is expected to produce and maintain:
- a customer storefront
- a seller panel
- an admin panel
- shared packages for UI, SEO, security, and types
- backend domain logic, jobs, integrations, and payout workflows

Claude must treat this repository as a **business-critical marketplace system**, not as a generic ecommerce demo.

---

## 2) Non-negotiable business truths
These rules are the base reality of the project. Do not silently weaken, bypass, or reinterpret them.

### 2.1 Centralized collection model
- Customer payments are collected by **Hanuja**, not by sellers.
- Hanuja is the financial collection point in the product flow.
- This means payout, refund, fraud, reconciliation, and audit behavior are all first-class concerns.

### 2.2 Seller payout model
- Seller payout begins only after `delivery_confirmed` status.
- `shipped`, `delivered`, and `delivery_confirmed` are different states.
- Seller payout is held for **30 days** after `delivery_confirmed`.
- During that hold period, returns, disputes, fraud, chargeback risk, and manual review may block or reduce payout.

### 2.3 Seller net payout formula
Seller net payout is calculated from:
- product sale amount
- minus commission
- minus coupon cost share if applicable
- minus shipping chargeback / shipping invoice reflection if applicable
- minus ad or service fees
- minus penalty invoices
- equals seller net payout

### 2.4 Penalty model
- Standard penalty rate is **20% of product price**.
- This may apply when:
  - seller rejects a paid order
  - the late-shipment daily accrual rule reaches day 20 and the order is auto-cancelled with refund initiation
- Penalties are normally written to seller current account debt and offset from future payouts.
- Negative seller balance is allowed.

### 2.5 Current account model
Every seller must be treated as having a current account (`cari hesap`) containing at least:
- total sales
- pending payout
- paid payout
- commission deductions
- ad/service fee debt
- shipping debt
- penalty debt
- negative balance if any

### 2.6 Delivery semantics
- Raw shipment is not enough for payout.
- Delivery confirmation can come from cargo integration, manual admin verification, customer confirmation, or silent confirmation rules.
- Payout logic starts from verified delivery confirmation, not from seller claim.

### 2.7 Return and dispute logic
- Return and dispute flows are tightly connected to payout blocking and reconciliation.
- If payout has not been paid yet, hold or reduce payout.
- If payout was already paid, write a debt entry to seller current account and offset from future payouts.

### 2.8 Admin authority
- Admin can review, block, approve, cancel, override, and grant penalty exemption where policy allows.
- Admin actions must be auditable.
- Manual override is allowed only when explicitly represented in product and audit logic.

---

## 3) How Claude must work in this repo

### 3.1 Work style
- Work step by step.
- Prefer small safe iterations over large speculative rewrites.
- Do not make sweeping structural changes without checking the relevant docs first.
- When a change introduces a new business rule, document it before or together with implementation.

### 3.2 Source of truth order
When there is ambiguity, use this order:
1. `CLAUDE.md`
2. `.claude/rules/`
3. `docs/`
4. existing codebase patterns
5. temporary implementation assumptions

If business docs and code conflict, **do not blindly trust the code**. Flag the mismatch and align the implementation with documented intent unless there is clear evidence that docs are outdated.

### 3.3 Do not invent hidden policy
- Do not invent commission rules, payout exceptions, status transitions, or legal claims without documenting them.
- Do not create silent fallback logic for finance-sensitive paths.
- Do not hardcode business exceptions without naming and documenting them.

### 3.4 Change discipline
Before making a meaningful change, determine which layer is affected:
- business rule
- product flow
- SEO / route behavior
- security / permission behavior
- domain state machine
- integration contract
- UI only

Then update the matching docs if needed.

---

## 4) Required reading by task type
Claude must read relevant docs before implementing changes in these areas.

### 4.1 Finance / payout / penalty / refund / reconciliation
Read first:
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `.claude/rules/10-admin-panel-rules.md`
- `docs/01-business/payout-policy.md`
- `docs/01-business/penalty-policy.md`
- `docs/01-business/refund-return-policy.md`
- `docs/06-engineering/event-status-model.md`
- `docs/06-engineering/queue-jobs-plan.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/reconciliation-process.md`
- `docs/07-operations/order-lifecycle.md`

### 4.2 SEO / routing / canonical / redirect / slug rules
Read first:
- `.claude/rules/04-seo-rules.md`
- `docs/04-seo/seo-url-slug-rules.md`
- `docs/04-seo/technical-seo-spec.md`
- `docs/04-seo/metadata-rules.md`
- `docs/04-seo/redirect-canonical-plan.md`
- `docs/04-seo/internal-linking-rules.md`

### 4.3 Security / auth / admin permissions / secret handling
Read first:
- `.claude/rules/05-security-rules.md`
- `.claude/rules/10-admin-panel-rules.md`
- `docs/05-security/security-architecture.md`
- `docs/05-security/auth-authorization-plan.md`
- `docs/05-security/payment-security.md`
- `docs/05-security/seller-iban-verification.md`
- `docs/05-security/fraud-risk-rules.md`
- `docs/05-security/secrets-env-policy.md`
- `docs/05-security/audit-logging-plan.md`

### 4.4 Seller panel flows
Read first:
- `.claude/rules/09-seller-panel-rules.md`
- `docs/02-product/seller-journeys.md`
- `docs/03-design/seller-panel-wireframe.md`
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`

### 4.5 Admin panel flows
Read first:
- `.claude/rules/10-admin-panel-rules.md`
- `docs/02-product/admin-journeys.md`
- `docs/03-design/admin-panel-wireframe.md`
- `docs/05-security/admin-action-policy.md`
- `docs/07-operations/dispute-management.md`
- `docs/07-operations/reconciliation-process.md`

### 4.6 Architecture / schema / integration work
Read first:
- `.claude/rules/01-architecture.md`
- `.claude/rules/02-coding-standards.md`
- `docs/06-engineering/system-architecture.md`
- `docs/06-engineering/frontend-architecture.md`
- `docs/06-engineering/backend-architecture.md`
- `docs/06-engineering/database-schema.md`
- `docs/06-engineering/api-contracts.md`
- `docs/06-engineering/integrations.md`

---

## 5) Approved stack and platform assumptions
Use these as the default unless the repo is intentionally migrated later.

- Frontend framework: **Next.js 14+ App Router**
- Language: **TypeScript** with strict mode
- Database: **PostgreSQL**
- ORM: **Prisma**
- Auth: **Better Auth**
- Search: **Meilisearch**
- Queue and scheduled jobs: **BullMQ + Redis**
- Object storage: **Cloudflare R2**
- Monorepo: **Turborepo**
- Deployment baseline: **Coolify**

Do not casually introduce overlapping frameworks or duplicate infrastructure.
If you propose a replacement, document the reason, migration impact, and rollout plan first.

---

## 6) Repository map and architecture

### Directory layout
| Path | Responsibility |
|------|---------------|
| `apps/web` | Customer storefront — SEO-first, Next.js App Router |
| `apps/seller-panel` | Seller dashboard — operational, status-driven |
| `apps/admin-panel` | Admin dashboard — finance/risk oversight |
| `api/domain/` | Pure domain models and business rule primitives |
| `api/services/` | Orchestration — lifecycle transitions, finance decisions, payout logic |
| `api/repositories/` | Persistence access only — no business policy |
| `api/routes/` | Thin HTTP handlers — validate input, call services, return response |
| `api/jobs/` | BullMQ workers — payout maturity, delivery timers, reconciliation, index sync |
| `db/schema/` | Prisma schema |
| `db/schema/migrations/` | Prisma migrations |
| `db/seeds/` | Seed data |
| `packages/ui` | Shared design system components |
| `packages/config` | Shared TypeScript/lint/Tailwind config |
| `packages/types` | Shared domain types and contracts |
| `packages/seo` | Metadata builders, canonical helpers, route generators |
| `packages/security` | Rate limiting, validators, masking, fraud utilities |
| `docs/` | Source-of-truth for business, product, design, SEO, security, engineering, ops, legal |
| `tests/unit\|integration\|e2e\|security/` | Test suites by layer |
| `tools/generators\|scripts\|validators/` | Dev tooling |
| `claude-plugin-hanuja/` | Claude Code plugin — agents, skills, hooks |

### Key architectural constraints
- **Business logic lives in `api/services/` and `api/domain/`** — never in route handlers, UI components, or repositories.
- **Finance math is always server-side** — payout calculations, penalty amounts, and ledger mutations never happen in the browser.
- **PostgreSQL is the source of truth** — Meilisearch is a read projection only; never trust it for finance or lifecycle state.
- **Status transitions are append-only** — use event/history tables alongside current state; do not overwrite without a trace.
- **Payout countdown starts only at `delivery_confirmed`** — never at `delivered`, `shipped`, or any earlier state.
- **Sellers see only payment-confirmed orders** — all seller-scoped queries must enforce ownership + payment status on the server.

### Critical docs before implementing
| Task area | Read first |
|-----------|-----------|
| Finance / payout / penalty | `docs/06-engineering/event-status-model.md`, `docs/07-operations/payout-lifecycle.md` |
| Order lifecycle | `docs/07-operations/order-lifecycle.md` |
| SEO / routes / slugs | `docs/04-seo/seo-url-slug-rules.md`, `docs/04-seo/redirect-canonical-plan.md` |
| Auth / permissions | `docs/05-security/auth-authorization-plan.md` |
| Seller panel flows | `docs/02-product/seller-journeys.md` |
| Admin panel flows | `docs/02-product/admin-journeys.md` |

---

## 7) Core implementation rules

### 7.1 Prefer explicit domain language
Use domain names that reflect real business meaning:
- payout
- payout_hold
- delivery_confirmed
- penalty
- exemption
- reconciliation
- dispute
- refund
- current_account

Avoid vague names like:
- tempStatus
- miscFee
- extraFlag
- finalAmount2

### 7.2 State transitions must be explicit
- Status transitions must be deterministic.
- Avoid unclear implicit state jumps.
- Finance-sensitive transitions must be modeled in a way that can be audited and tested.
- If a state machine changes, also update `docs/06-engineering/event-status-model.md`.

### 7.3 Idempotency matters
For payouts, refunds, webhooks, reconciliation jobs, and admin actions:
- prefer idempotent handlers
- guard against duplicate job execution
- guard against duplicate payment events
- guard against repeat admin submission

### 7.4 Auditability matters
For money movement, permissions, and seller-facing financial visibility:
- every important action should be reviewable later
- do not design magic background behavior with no history trail
- admin overrides should create human-readable audit entries

---

## 8) SEO and route rules

### 8.1 Namespace-first route policy
Use route namespaces to avoid cross-type collisions.
Default direction:
- `/kategori/...`
- `/urun/...`
- `/blog/...`
- `/magaza/...`

Do not flatten all resource types under root-level slugs.

### 8.2 Slug stability
- Slug structure is a long-term decision.
- Do not casually rename route patterns.
- Slug changes must consider canonical, redirect, sitemap, and internal link effects.
- If route behavior changes, update both:
  - `docs/04-seo/seo-url-slug-rules.md`
  - `docs/04-seo/redirect-canonical-plan.md`

### 8.3 Canonical discipline
- Prefer deterministic canonical URLs.
- Filter pages, tracking params, and alternate route shapes must not create accidental canonical ambiguity.
- Marketplace pages must not compete against each other with near-duplicate paths.

---

## 9) Security and risk rules

### 9.1 Secrets
- Never commit real secrets.
- Use `.env.example` for documentation only.
- Follow `docs/05-security/secrets-env-policy.md`.

### 9.2 Payment and payout risk
- Centralized payment collection is high risk.
- Treat payout logic, refund logic, and fraud prevention as critical code paths.
- Do not reduce verification friction around seller bank account changes without documented approval.

### 9.3 Permissions and admin control
- Admin tools must follow least-privilege where possible.
- High-risk actions should be explicitly named and logged.
- Manual override flows should never be hidden behind generic update endpoints.

### 9.4 Legal sensitivity
Because Hanuja collects payments centrally, any product decision that changes who collects money, when settlement happens, or how funds are held should trigger review of:
- `docs/08-legal/payment-regulation-notes.md`
- `docs/05-security/payment-security.md`

Do not make legal assumptions. Document and flag potential compliance-sensitive changes.

---

## 10) UI and UX rules
- Keep the storefront elegant, clear, and conversion-oriented.
- Keep seller panel UX operational, explicit, and status-driven.
- Keep admin panel dense but safe, with clear labels for irreversible or risky actions.
- Use the shared design system instead of one-off visual inventions whenever possible.
- Read `.claude/rules/03-ui-design-system.md` before major UI work.

---

## 11) Testing expectations
For business-critical flows, tests are not optional.

Must be covered when relevant:
- unit tests for financial calculators and validators
- integration tests for state transitions and API behavior
- e2e tests for checkout, seller flows, and admin review flows
- security-focused tests for auth, permission boundaries, and secret exposure risks

At minimum, add or update tests for:
- payout hold logic
- penalty calculation logic
- refund / payout interaction
- delivery confirmation transitions
- canonical / redirect route behavior when URLs change

If a critical flow cannot be tested immediately, explicitly state the gap.

---

## 12) Documentation update rules
Update docs whenever behavior changes.

Map changes like this:
- finance or payout rule change -> `docs/01-business/` and `docs/07-operations/`
- status machine change -> `docs/06-engineering/event-status-model.md`
- queue timing / cron change -> `docs/06-engineering/queue-jobs-plan.md`
- route or slug change -> `docs/04-seo/seo-url-slug-rules.md` and `docs/04-seo/redirect-canonical-plan.md`
- auth / permission change -> `docs/05-security/`
- seller-facing process change -> `docs/02-product/` and `docs/07-operations/`
- admin workflow change -> `docs/02-product/admin-journeys.md` and `docs/05-security/admin-action-policy.md`

Docs are part of the product. Do not treat them as optional afterthoughts.

---

## 13) What good output looks like
When implementing or proposing work in this repository, prefer:
- clear naming
- explicit domain modeling
- small maintainable modules
- testable logic
- auditable flows
- minimal surprise
- documentation alignment

Avoid:
- hidden business logic
- route changes without SEO impact review
- finance logic without state model review
- vague status names
- duplicated sources of truth
- “temporary” shortcuts in high-risk flows that become permanent

---

## 14) Final instruction
If the task touches money flow, seller rights, admin override power, route stability, or security boundaries, slow down, read the relevant docs, and make the change in a way that remains understandable six months later.

---

## 15) Business quick reference

### 15.1 Commission resolution order
When calculating seller commission, use the first rate that exists in this priority:
1. Product-specific override rate
2. Category rate
3. Seller general rate
4. System default rate

### 15.2 Invoice relationship
- Seller issues the **product invoice** to the customer.
- Hanuja issues the **commission invoice** and any **service/ad fee invoices** to the seller.

### 15.3 Net ruling sentences
These are platform constants. Do not contradict them in code or documentation.

1. Hanuja collects all customer payments (card and bank transfer/EFT).
2. The seller issues the product invoice to the customer.
3. Hanuja issues commission and other service invoices to the seller.
4. Seller net payout is made 30 days after `delivery_confirmed`.
5. If the seller rejects a paid order, a penalty of 20% of the product amount is applied.
6. If shipment is delayed past the commitment date, a penalty of 1% of the product amount accrues per overdue day; on the 20th overdue day the order is auto-cancelled and customer refund is initiated. The commitment date is per product: the seller enters `Product.fulfillmentDays` (business days) as a mandatory field at product creation, snapshotted to `OrderLine.promisedFulfillmentDays` at order time.
7. An additional 10-day extension may be granted only with customer awareness and an explicit admin decision.
8. After dispatch, cancellation is not the correct path — return/refund flow applies.
9. A return request within 14 days is treated as a standard fast-path withdrawal.
10. A return request after 14 days requires admin evaluation.
11. Any order with an open return or open dispute has its payout blocked.
12. Commission base is the KDV-inclusive amount the customer actually paid for the line: `OrderLine.totalPrice − OrderLine.couponDiscountAmount`. Do not use the KDV-exclusive base.
13. The commission deduction is itself KDV-inclusive: `commissionAmount = roundMoney(base × commissionRate × (1 + commissionVatRate))`, where `commissionVatRate` is `PlatformSettings.commissionVatRate` (default 0.2000).
14. Seller coupon (`Coupon.sellerId` set) and seller discount rule cost belongs to the seller: the coupon discount is allocated to the seller's lines as `OrderLine.couponDiscountAmount`, reduces the commission base, and reduces net payout (`netPayoutAmount = totalPrice − couponDiscountAmount − commissionAmount`).
15. Platform coupon (`Coupon.sellerId` null) and EFT/Havale channel discount (`Order.eftDiscountAmount`) are absorbed by Hanuja. They do not reduce the commission base, `Payout.grossAmount`, or `Payout.netAmount`.
