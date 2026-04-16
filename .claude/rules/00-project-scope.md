# Hanuja Project Scope

## Purpose

Hanuja is a Turkey-focused marketplace for home, office, and lifestyle products.
The platform is designed around a curated marketplace model with three main interfaces:

- customer storefront
- seller panel
- admin panel

This repository is the single source of truth for product, design, engineering, SEO, security, and operations decisions related to Hanuja.

## Core Business Model

Hanuja is not a simple listing site.
It operates with a **central collection model**.

That means:

- the customer pays Hanuja
- approved orders are passed to the seller
- the seller fulfills the order
- Hanuja pays the seller later according to payout rules
- commissions, ad fees, cargo charges, penalties, refunds, and offsets affect the seller's net payout

## Non-Negotiable Marketplace Rules

These rules must be treated as platform constants unless an explicit document changes them.

1. **Central collection**
   - All customer payments are collected by Hanuja.
   - Card payments and bank transfer / EFT payments come to Hanuja.

2. **Seller payout delay**
   - Seller payout begins only after the order reaches `delivery_confirmed`.
   - A 30-day hold applies after `delivery_confirmed`.
   - During this hold, returns, disputes, fraud checks, chargeback risk, and offset calculations are evaluated.

3. **Penalty rule**
   - Standard seller penalty is **20% of the product amount** in defined cases.
   - This is typically recorded to the seller ledger and offset from future payouts.

4. **Paid order visibility**
   - Sellers must not receive unpaid or unverified orders.
   - Orders are visible to sellers only after payment is confirmed.

5. **Delivery distinction**
   - `delivered` and `delivery_confirmed` are separate concepts.
   - Payout countdown starts from `delivery_confirmed`, not from `delivered`.

6. **Return and dispute sensitivity**
   - Returns, cancellations, disputes, and admin interventions affect payout eligibility.
   - If needed, seller balance can go negative.

## Main Roles

### Customer
Can browse, purchase, track orders, confirm delivery, request return, and manage profile/account actions.

### Seller
Can manage products, inventory, pricing, order fulfillment, cargo/tracking entry, payout visibility, penalty visibility, and finance summaries.

### Admin
Has full operational oversight.
Admin can review payments, seller performance, risk, penalties, disputes, payout readiness, exceptions, and manual interventions.

## Product and Platform Priorities

When making decisions, prioritize in this order:

1. platform correctness
2. financial correctness
3. legal and security safety
4. operational clarity
5. SEO stability
6. UX quality
7. implementation speed

Never choose speed over accounting correctness, payout correctness, or security.

## Routing and SEO Direction

SEO decisions must be stable from the beginning.
Avoid route ambiguity across entity types.

Preferred namespace-based route families:

- `/kategori/...`
- `/urun/...`
- `/blog/...`
- `/magaza/...`
- `/hesabim/...`
- `/siparis/...`
- `/sepet`

Slug, canonical, redirect, and route decisions must stay aligned with:

- `docs/04-seo/seo-url-slug-rules.md`
- `docs/04-seo/redirect-canonical-plan.md`

## Approved Technical Direction

Unless a document explicitly replaces these choices, use the approved stack:

- Next.js 14+ App Router
- TypeScript
- PostgreSQL
- Prisma
- Better Auth
- Iyzico
- BullMQ + Redis
- Meilisearch
- Cloudflare R2
- Turborepo
- Coolify

Do not casually swap core infrastructure choices without documenting the reason and impact.

## Repository Working Model

This repo is expected to contain:

- apps for storefront, seller panel, and admin panel
- shared packages for UI, config, types, SEO, and security
- API/domain/service layers
- docs for business, operations, SEO, security, legal, and engineering rules
- Claude-specific rules, agents, skills, and hooks

## Source of Truth Documents

When working on a task, consult the matching rule/doc first.

### Always relevant
- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`

### Finance and payouts
- `.claude/rules/07-marketplace-finance-rules.md`
- `docs/01-business/payout-policy.md`
- `docs/07-operations/payout-lifecycle.md`

### Order lifecycle
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/06-engineering/event-status-model.md`
- `docs/07-operations/order-lifecycle.md`

### SEO and routes
- `.claude/rules/04-seo-rules.md`
- `docs/04-seo/seo-url-slug-rules.md`
- `docs/04-seo/redirect-canonical-plan.md`

### Security and fraud
- `.claude/rules/05-security-rules.md`
- `docs/05-security/payment-security.md`
- `docs/05-security/fraud-risk-rules.md`
- `docs/05-security/seller-iban-verification.md`

## Implementation Rules

- Prefer clear domain naming over clever naming.
- Keep business rules explicit in code.
- Avoid hidden finance logic inside UI components.
- Keep payout, penalty, return, and offset logic in dedicated service/domain layers.
- Make admin actions auditable.
- Use enums / typed status models for lifecycle states.
- Do not merge different meanings into one status if separate statuses improve clarity.

## Documentation Rules

Whenever a core rule changes, update the matching docs in the same work.

At minimum:
- business rule changed → update business/operations docs
- status flow changed → update event/status docs
- route or slug changed → update SEO docs
- security-sensitive behavior changed → update security docs

## Things Claude Must Not Assume

Do not assume:

- seller is paid immediately after delivery
- seller sees unpaid orders
- `delivered` equals `delivery_confirmed`
- all cancellations are penalty-free
- all returns are seller-approved automatically
- SEO-safe routes can be changed later with little cost
- payment collection structure is legally trivial

## Expected Output Style for This Repo

When modifying or generating project artifacts:

- be explicit
- be traceable
- be modular
- do not hide critical business logic
- prefer maintainable structure over short-term shortcuts

If a decision affects money flow, order state, risk, compliance, or SEO permanence, treat it as high impact and document it.
