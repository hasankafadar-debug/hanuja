# Admin Panel Rules

## Purpose

This file defines the non-negotiable rules for the Hanuja admin panel.

It exists to keep admin behavior consistent across:

- payments
- seller management
- order oversight
- finance operations
- payout readiness
- penalties and waivers
- returns and disputes
- risk and fraud review
- moderation
- auditability

If implementation conflicts with this file, this file wins unless a newer approved business or security decision replaces it.

## Core Admin Principle

The admin panel is not a simple back office dashboard.

For Hanuja, the admin panel is the operational control surface of the marketplace.

It must allow admin teams to:

- supervise marketplace health
- validate payment-related events
- intervene in exceptions
- control seller risk
- manage payout readiness
- review penalties and waivers
- resolve disputes and returns
- audit critical changes

Admin tools must prioritize:

1. correctness
2. traceability
3. security
4. operational clarity
5. controlled speed

Never optimize for “one-click convenience” if it reduces auditability or increases finance risk.

## Admin Panel Scope

The admin panel must support at least these operational areas:

- payment oversight
- bank transfer / EFT approval
- seller management
- product moderation
- order lifecycle oversight
- payout lifecycle oversight
- penalty and waiver management
- return and dispute management
- fraud/risk visibility
- ledger and finance visibility
- audit logs
- support operations
- configuration of approved business rules where applicable

## Role and Permission Philosophy

Admin is not a single flat role.

The system should support structured admin permissions where possible.

Recommended admin role groups may include:

- super admin
- finance admin
- operations admin
- support admin
- moderation admin
- risk/review admin

Not every admin user should be able to perform every critical action.

### High-impact actions must be permission-restricted

Examples:

- approve payment manually
- approve/reject bank transfer
- release payout hold
- mark payout as paid
- waive seller penalty
- create manual finance adjustment
- cancel order after review
- mark delivery confirmed manually
- approve exceptional return
- change seller finance status
- suspend or reactivate seller
- edit protected configuration

## Core Admin Dashboard Expectations

The main admin dashboard should give fast visibility into marketplace health.

At minimum, the dashboard should surface:

- today’s collected amount
- pending bank transfer / EFT approvals
- orders waiting for seller action
- delayed orders / 20-day risk cases
- payout-ready balances
- held balances
- blocked payouts
- seller negative balances
- open returns
- open disputes
- total penalties
- seller risk indicators
- urgent moderation or support queues

Admin should be able to move from summary to detailed action screens quickly.

## Payment Admin Rules

Because Hanuja collects payments centrally, payment oversight is one of the admin panel’s most critical functions. :contentReference[oaicite:2]{index=2}

### Payment admin expectations

Admin panel must support:

- payment status visibility
- payment detail inspection
- manual review where required
- bank transfer / EFT approval workflow
- rejection of invalid transfer evidence
- audit trail for every manual decision

### Bank transfer / EFT approval

If the platform uses havale / EFT:

- pending transfers must have a dedicated approval queue
- approval must record actor, timestamp, and evidence context
- rejected/invalid transfers must not unlock seller flow
- seller must not see the order until payment becomes confirmed

Do not allow informal approval outside the system.

## Order Oversight Rules

Admin must be able to inspect the full order lifecycle with clear timestamps and history.

### Admin order view should make visible

- order identity
- payment state
- seller assignment
- current order state
- shipment/tracking info
- delay indicators
- delivery state
- delivery confirmation state
- return/dispute links
- finance/payout impact
- action history

### Admin actions on orders

Depending on permission level, admin may need to:

- confirm payment-related outcomes
- cancel order
- force review state
- mark delivery confirmed
- extend fulfillment review window
- open dispute
- approve exceptional flow changes

All such actions must remain auditable.

## Seller Management Rules

Admin panel must provide full seller oversight without becoming a dangerous uncontrolled edit surface.

### Seller admin view should make visible

- seller identity and business status
- activation/suspension status
- product counts
- order volume
- pending orders
- payout status summary
- penalty history
- negative balance
- risk indicators
- bank detail verification state
- support/dispute history where relevant

### Seller actions

Depending on permissions, admin may need to:

- approve or reject seller onboarding elements
- suspend or reactivate seller
- review seller rejection patterns
- review seller penalty profile
- review seller payout eligibility
- review seller bank detail change risk

Do not allow broad silent edits to seller records.

## Finance and Payout Admin Rules

Finance views are one of the most critical admin areas in Hanuja.

### Admin finance surfaces should include

- seller pending payout totals
- payout-ready totals
- held payout totals
- blocked payout reasons
- commission breakdown
- cargo deductions
- ad/service fee deductions
- penalty totals
- manual adjustments
- refund impact
- negative balance carryover
- payout batch candidates

### Payout readiness review

Before payout is released, admin must be able to see:

- maturity date / 30-day hold completion
- open return status
- dispute status
- fraud/risk flags
- bank detail verification status
- unresolved finance inconsistencies
- previous adjustments/offsets

Do not design payout release as a blind button with no context.

### Payout batch rules

If payouts are processed in batches:

- admin must see which items are ready
- admin must see which items are blocked and why
- batch execution must be auditable
- partial failures must be traceable
- re-run behavior must be safe and controlled

## Penalty and Waiver Rules

Seller penalties are finance-critical and must be clearly visible in admin tools. :contentReference[oaicite:3]{index=3}

### Penalty admin view should include

- order reference
- product reference
- seller reference
- penalty reason
- penalty date
- penalty amount
- penalty status
- waiver status
- dispute/appeal status if supported

### Penalty waiver rules

Admin may waive or reverse a penalty only through explicit action.

Requirements:

- permission-restricted
- reason required
- actor recorded
- timestamp recorded
- original penalty history preserved

Never let penalty removal happen by overwriting or deleting history.

## Return and Dispute Rules in Admin Panel

Returns and disputes must be treated as structured operational flows, not loose support notes.

### Admin return/dispute view should include

- order reference
- customer reason
- seller response
- timeline
- evidence links
- finance effect
- payout hold state
- final resolution state

### Admin actions may include

- approve/reject return
- request more evidence
- open dispute review
- resolve dispute
- trigger refund path
- mark returned item received
- apply payout block or release

Every action must be logged.

## Risk and Fraud Rules in Admin Panel

Risk review must be visible and actionable.

### Admin risk surfaces should make visible

- suspicious orders
- suspicious seller behavior
- repeated seller rejection patterns
- payout detail change anomalies
- repeated return/dispute abuse patterns
- unusual payment patterns
- unusual admin override concentrations if tracked

### Rules

- risk state must not be hidden in plain notes only
- admin must understand why a case is flagged
- review result must be explicit
- payout/order actions affected by risk must be visible

## Product and Content Moderation Rules

The admin panel must support catalog quality and marketplace trust.

### Moderation scope may include

- product approval/review
- hidden/unlisted product visibility
- image/content issues
- prohibited content review
- duplicated product suspicion
- marketplace quality enforcement

If moderation affects indexability or route availability, SEO and product docs must stay aligned.

## Search, Filter, and Queue Rules

Admin tools must be operationally searchable.

### Minimum expectations

Admin should be able to filter and search by:

- order number
- seller
- customer
- payment status
- payout state
- penalty status
- delay risk
- return/dispute state
- risk state
- seller negative balance
- date range

Queues should exist for high-value admin work such as:

- pending EFT approvals
- payout-blocked cases
- delayed shipment cases
- seller rejection review
- open disputes
- penalty waiver review
- suspicious bank detail changes

## Data Visibility and Masking Rules

Admin visibility is broad, but it should still be controlled.

### Rules

- mask sensitive bank details where full visibility is unnecessary
- do not show secrets/tokens in admin UI
- expose minimum necessary personal data for task completion
- separate operational data from deeply sensitive raw values
- use detail drill-down instead of showing everything in large tables

Admin access is not a reason to remove all masking.

## Action Design Rules

Critical admin actions should be explicit and hard to misuse.

### Good action design principles

- clear action labels
- visible consequences
- reason input where appropriate
- confirmation step for destructive/high-impact actions
- actor logging
- success/failure traceability

### Avoid

- silent auto-changes
- misleading action labels
- mixed actions that do several finance consequences invisibly
- edit forms with unclear side effects

## Auditability Rules

Every high-impact admin action must be auditable.

At minimum log:

- actor
- permission context
- timestamp
- target entity
- previous state
- new state
- reason
- note or evidence reference where relevant

High-impact examples:

- payout release
- payout hold release
- penalty waiver
- finance adjustment
- return approval/rejection
- seller suspension
- payment approval
- delivery confirmation override
- order cancellation by admin

## Admin UX Rules

Admin UI must be fast to interpret, not visually fancy at the cost of clarity.

### Admin UX priorities

1. clarity of state
2. action safety
3. queue efficiency
4. audit visibility
5. low error risk

Recommended principles:

- show status chips with clear meaning
- show blocking reasons explicitly
- separate “view” and “act” zones
- surface timestamps and owners clearly
- avoid cluttered one-screen-everything layouts

## Documentation and Cross-System Alignment

Admin panel logic must stay aligned with:

- finance rules
- order lifecycle rules
- security rules
- payout rules
- legal constraints where relevant

Admin panel must never invent its own hidden business rules separate from the documented system.

## Things Claude Must Not Do

Do not:

- treat admin as a single unrestricted role
- expose silent finance mutation paths
- remove auditability from overrides
- let admin approve payments informally outside system flow
- make payout release a contextless action
- delete penalty history when waived
- expose sensitive bank or secret data broadly
- bury blocked-state reasons in support notes only
- make admin screens visually simple at the cost of operational clarity

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/05-security-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/order-lifecycle.md`
- `docs/05-security/audit-logging-plan.md`
- `docs/05-security/admin-action-policy.md`
- `docs/01-business/penalty-policy.md`

If admin action logic changes, update the related finance, operations, and security docs in the same work.