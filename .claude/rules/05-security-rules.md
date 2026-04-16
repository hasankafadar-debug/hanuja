# Security Rules

## Purpose

This file defines the non-negotiable security rules of the Hanuja marketplace.

It exists to protect:

- customer accounts
- seller accounts
- admin operations
- payment-related flows
- payout-related flows
- finance integrity
- internal secrets and credentials
- auditability of high-impact actions

If implementation conflicts with this file, this file wins unless an explicitly approved security decision replaces it.

## Security Priority

For Hanuja, security is not only about account protection.

Security also includes:

- finance correctness
- payout safety
- admin action traceability
- seller identity and bank detail protection
- fraud prevention
- operational abuse prevention
- legal and compliance sensitivity

Never optimize convenience at the cost of payout safety, payment safety, or auditability.

## Core Security Principle

Treat the following as high-risk areas:

- authentication
- authorization
- payment confirmation
- seller payout eligibility
- seller bank account changes
- penalty waiver actions
- refund decisions
- admin overrides
- secret storage
- internal finance adjustments

Any action touching money flow, bank details, order finalization, or admin exceptions must be treated as security-sensitive.

## General Security Principles

### 1. Least privilege

Every user, seller, support agent, and admin should only access the minimum capability required.

Do not grant broad permissions by default.

### 2. Explicit authorization

Never rely only on frontend visibility rules.
Every sensitive backend action must perform server-side authorization.

### 3. Auditability

Every high-impact action must be attributable to:

- actor
- time
- reason
- target object
- result

No silent mutations for finance, payout, or seller identity data.

### 4. Defense in depth

Do not trust a single control layer.
Use multiple protection layers:

- authentication
- role checks
- permission checks
- validation
- logging
- rate limiting
- anomaly detection
- admin review where needed

### 5. Secure defaults

If a state is ambiguous, default to blocking or reviewing rather than auto-approving.

## Authentication Rules

Authentication must be handled through the approved auth system and implemented with secure session handling.

### Requirements

- use strong server-side session validation
- protect against session fixation and token abuse
- invalidate sessions correctly on logout or forced reset
- support password reset and account recovery with secure flows
- support role-aware login boundaries if needed

### Never do these

- trust only client-side auth state
- expose privileged actions through unsecured endpoints
- accept weak recovery flows without verification
- keep long-lived privileged sessions without control

## Authorization Rules

Authorization must be role-based and permission-aware.

Main role groups include:

- customer
- seller
- admin
- support / operations sub-roles where needed

### Rules

1. Customer cannot access seller or admin data.
2. Seller can access only their own catalog, orders, payouts, and related finance summaries.
3. Admin access should be partitioned where possible.
4. High-impact admin actions should not be universally available to every admin-like user.
5. Sensitive endpoints must verify ownership or permission on the server.

### High-impact actions that require strong authorization

- approve payment manually
- approve or reject bank transfer
- change payout state
- waive seller penalty
- apply manual finance adjustment
- mark delivery confirmed
- cancel order after review
- approve or reject return
- change seller bank details
- release payout hold
- impersonation or view-as-user flows if ever added

## Seller Identity and IBAN Rules

Seller payout details are extremely sensitive.

### IBAN change policy

Seller bank account / IBAN changes must never become active silently.

Required protection layers should include some combination of:

- recent authentication requirement
- step-up verification
- delayed activation
- admin review for suspicious changes
- change history log
- notification to seller
- risk checks before next payout

### Rules

1. IBAN change must be logged with old value reference, masked display, actor, time, and source.
2. Do not expose full bank details broadly in UI or logs.
3. New bank details should be verified before payout use where possible.
4. Payout should be blockable if bank details are suspicious or incomplete.
5. Repeated or unusual payout detail changes should raise risk signals.

### Never do these

- activate new bank data instantly with no verification
- show full IBAN widely in admin tables
- allow unlogged seller payout detail edits
- allow finance release while payout identity is uncertain

## Payment Security Rules

Hanuja collects customer payments centrally.
This makes payment integrity critical.

### Rules

- payment confirmation must come from trusted backend verification
- order flow must not trust frontend “payment successful” assumptions
- payment-related webhooks or callbacks must be validated
- duplicate payment processing must be prevented
- payment state transitions must be idempotent
- failed or ambiguous payment states must not unlock seller fulfillment

### Bank transfer / EFT rules

- manual approval must be auditable
- approval actor and evidence reference should be stored
- unapproved transfer records must not reach seller fulfillment flow

### Never do these

- mark payment confirmed based only on redirect success
- trust spoofable client parameters for payment result
- let sellers see unpaid or unverified orders
- overwrite payment history without trace

## Payout Security Rules

Payout operations must be treated as security-sensitive finance actions.

### Rules

1. Payout countdown starts only from `delivery_confirmed`.
2. Payout release must be blocked if any risk or review flag is open.
3. Manual payout release must be auditable.
4. Payout batch actions should support review and traceable execution.
5. Payout computation must not happen in UI-only logic.
6. Negative balances, penalties, and holds must be applied consistently.

### Strong review areas

- payout release after dispute
- payout release after return risk
- payout release after seller bank detail change
- payout release after admin override
- payout release after fraud signals

### Never do these

- pay out from ambiguous state
- release payout with unresolved return/dispute
- allow hidden manual payout edits
- mix payout decision logic into presentation-only layers

## Fraud and Risk Rules

Fraud prevention is required for both customer-side and seller-side abuse.

### Risk examples

Potential risk indicators may include:

- repeated failed payment attempts
- repeated coupon abuse
- multiple accounts from the same device or pattern
- abnormal order velocity
- unusual first-order behavior
- suspicious seller bank detail changes
- repeated seller rejections
- repeated return or dispute abuse
- mismatched profile/payment patterns
- unusual manual override frequency by admins

### Rules

1. Risk signals must be reviewable.
2. High-risk states may block fulfillment, refund, or payout.
3. Fraud logic must not be invisible.
4. Admin review actions must leave an audit trail.
5. “Risk” must not be used as a vague excuse without evidence/logging.

### Recommended actions when risk is high

- require manual review
- pause seller visibility
- pause payout eligibility
- require stronger verification
- open dispute-like review flow
- flag account or order internally

## Admin Security Rules

Admin power is necessary, but it is also dangerous.

### Admin action requirements

Every high-impact admin action must store:

- actor ID
- role/permission context
- timestamp
- target entity
- previous state
- new state
- reason
- optional note/evidence reference

### Sensitive admin actions include

- penalty waiver
- payout release
- payout block release
- refund approval
- order cancel after review
- seller suspension
- seller bank detail approval
- finance adjustment
- manual delivery confirmation
- manual payment confirmation

### Admin account protections

- strong authentication required
- access should be minimal by role
- production admin actions should be logged
- session and device hygiene should be considered
- destructive actions should be guarded where possible

### Never do these

- allow silent admin overrides
- let all admins perform finance-critical actions equally
- expose secrets in admin tools
- allow admin tools to bypass core audit requirements

## Secret and Credential Rules

Secrets include:

- API keys
- payment provider secrets
- auth secrets
- database credentials
- Redis credentials
- storage credentials
- webhook secrets
- encryption-related secrets
- internal service tokens

### Rules

1. Secrets must come from environment or secure secret storage.
2. Never hardcode secrets in repo files.
3. Never place real secrets in examples or docs.
4. Mask sensitive values in logs and admin/debug screens.
5. Rotate secrets if exposure is suspected.
6. Separate local example config from real config.

### Files and repo rules

- `.env.example` may contain placeholders only
- real `.env` values must not be committed
- docs must never include real credentials
- test fixtures must not contain live production secrets

### Never do these

- commit `.env` with real keys
- paste live secrets into markdown docs
- expose secrets in client bundles
- echo secrets in verbose logs without masking

## Logging and Audit Rules

Logging should help investigation without leaking sensitive data.

### Must log

- permission-sensitive admin actions
- payout state transitions
- penalty applications and waivers
- return/dispute resolution actions
- seller payout detail changes
- login/security events where relevant
- important webhook processing outcomes
- manual finance adjustments

### Must avoid logging in cleartext

- full card data
- full bank detail values
- passwords
- raw secrets
- recovery tokens
- sensitive personal data beyond necessity

### Audit log expectations

Audit logs should be:

- append-oriented where practical
- actor-linked
- searchable
- timestamped
- hard to tamper with
- available for finance/security review

## Data Exposure Rules

Only expose the minimum necessary data to each interface.

### Customer side

Customer should not see internal finance, seller risk, or admin-only dispute notes.

### Seller side

Seller should see only their own relevant finance and order data.
Do not expose:

- other sellers’ data
- internal fraud notes
- hidden admin-only reasons
- unrelated internal risk models

### Admin side

Even admin views should avoid unnecessary full exposure of sensitive values.
Use masking where possible.

## Input Validation Rules

All external input must be treated as untrusted.

Protect critical routes with:

- schema validation
- type-safe parsing
- ownership checks
- enum constraints
- safe file upload constraints where relevant
- sanitization where rendering or rich content is involved

Never trust client-computed finance or status values.

## File Upload and Media Rules

If the platform allows uploads such as:

- seller product images
- evidence images
- invoice-like files
- dispute attachments

then apply at minimum:

- file type allowlist
- size limits
- secure storage pathing
- malware/scanning considerations if applicable
- no direct trust of uploaded filenames
- authorization checks for access/download

## Rate Limiting and Abuse Protection

Protect endpoints against automated abuse.

Recommended areas:

- login
- password reset
- registration
- coupon application
- checkout/payment attempts
- seller payout detail changes
- admin-sensitive endpoints
- return/dispute submission forms

Rate limiting should be combined with logging and anomaly review where needed.

## Webhook and Integration Rules

External integrations must not be trusted blindly.

For providers such as payment, cargo, storage, or search-related services:

- verify signatures when available
- verify source authenticity
- handle retries safely
- implement idempotency
- log success/failure outcomes
- reject malformed or duplicate payloads carefully

## Error Handling Rules

Security-sensitive flows should fail safely.

### Rules

- do not leak internal secrets in error messages
- do not reveal unnecessary permission details to end users
- keep internal error detail available in server logs
- return controlled messages in public APIs
- do not expose stack traces in production responses

## Environment Separation Rules

Development, staging, and production concerns must remain separated.

### Rules

- do not reuse production secrets in local development
- do not point local dev accidentally to live payout/payment actions unless explicitly intended
- label environments clearly
- keep sandbox/test provider credentials distinct from production

## Compliance and Legal Sensitivity

Hanuja’s payment collection structure may have legal and regulatory implications.

Treat the following as sensitive and review-dependent:

- central collection design
- payout timing and holding logic
- refund custody model
- settlement flows
- role of Hanuja in payment chain

Never assume payment collection architecture is legally trivial.

Cross-check with legal and payment regulation notes when implementation touches these areas.

## Security Documentation Rules

When changing any security-sensitive logic, update the relevant docs in the same work.

At minimum:

- payout security change → security + finance docs
- IBAN/bank detail flow change → security docs
- auth/role change → auth/security docs
- fraud signal change → fraud/security docs
- webhook verification change → integration/security docs

## Things Claude Must Not Do

Do not:

- trust frontend state for payment or payout truth
- expose unpaid or unverified orders to sellers
- activate seller bank detail changes silently
- allow unlogged admin overrides
- commit real secrets
- expose sensitive values in logs or UI
- treat payout release as low-risk
- collapse security review into informal notes
- assume central collection has no regulatory consequence

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/05-security/security-architecture.md`
- `docs/05-security/payment-security.md`
- `docs/05-security/fraud-risk-rules.md`
- `docs/05-security/seller-iban-verification.md`
- `docs/05-security/secrets-env-policy.md`
- `docs/05-security/audit-logging-plan.md`
- `docs/08-legal/payment-regulation-notes.md`

If security logic changes, update the related docs in the same work.