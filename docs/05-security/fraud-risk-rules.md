# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Fraud and Risk Rules

## Purpose

This document defines the risk signals, scoring thresholds, review actions, and
visibility requirements for fraud and abuse prevention in the Hanuja marketplace.

Fraud risk applies to both the customer side (payment abuse, return abuse, account
abuse) and the seller side (rejection patterns, payout detail manipulation, fulfillment
gaming). Both must be observable, logged, and actionable by admin.

---

## Source of Truth for Scoring Logic

The canonical implementation of order-level risk scoring is:

`packages/security/src/fraud-scorer.ts`

This file defines `scoreOrderRisk(input: OrderRiskInput): FraudScoreResult`.

- Score range: 0–100.
- The result includes `score`, `level`, `signals` (human-readable strings), and
  `requiresReview` (boolean).
- The score is additive across independent risk signals.
- Score is capped at 100.

This scorer is the authoritative source for per-order risk classification.
Do not invent parallel scoring logic in route handlers or UI components.

---

## Risk Score Thresholds

| Range | Level | Behavior |
|-------|-------|----------|
| 0–39 | `low` | Normal processing — no intervention required |
| 40–59 | `medium` | `requiresReview = true` — flag for admin queue, fulfillment may proceed with logging |
| 60–79 | `high` | Flag for admin queue — fulfillment should be held pending review |
| 80–100 | `critical` | Block fulfillment — mandatory admin review before any progression |

These thresholds are constants in `fraud-scorer.ts`:

```
THRESHOLDS = { review: 40, high: 60, critical: 80 }
```

Do not change thresholds without updating this document and the scorer constants together.

---

## Customer-Side Risk Signals

The following signals are evaluated by `scoreOrderRisk()` for customer orders.
Each carries a point value; the total determines the risk level.

### Payment-Related Signals

| Signal | Points | Condition |
|--------|--------|-----------|
| Single failed payment attempt | +10 | `failedPaymentAttempts >= 1` |
| Multiple failed payment attempts | +25 | `failedPaymentAttempts >= 3` |

Failed payment attempts must be tracked per order and persisted. They must not
reset between page reloads. The session or order record is the source of truth.

### Account Age Signals

| Signal | Points | Condition |
|--------|--------|-----------|
| Very new account | +20 | Account age < 1 day |
| Young account | +10 | Account age < 7 days |
| First order | +10 | `isFirstOrder = true` |

### Order Value Signals

| Signal | Points | Condition |
|--------|--------|-----------|
| High order value | +20 | Order total > 10,000 TRY |
| Medium-high order value | +10 | Order total > 5,000 TRY |

### Order Velocity Signals

| Signal | Points | Condition |
|--------|--------|-----------|
| Elevated velocity | +10 | 3–4 orders in last 24 hours |
| High velocity | +20 | 5 or more orders in last 24 hours |

Velocity is counted per authenticated user, not per session. Multiple accounts
from the same device or payment identity are a separate signal (see below).

### Dispute and Return History Signals

| Signal | Points | Condition |
|--------|--------|-----------|
| Prior dispute history | +8 | 1–2 disputes in last 90 days |
| High dispute frequency | +20 | 3 or more disputes in last 90 days |
| Elevated return count | +7 | 3–4 returns in last 90 days |
| High return frequency | +15 | 5 or more returns in last 90 days |

### Combination Amplifier

| Signal | Points | Condition |
|--------|--------|-----------|
| New account + first order + high value | +15 | All three conditions true simultaneously |

This combination is amplified because it represents the highest-likelihood fraud
pattern: a fresh account placing a large first order.

---

## Additional Risk Signals (Not Yet in Scorer — Must Be Implemented)

The following signals are required by policy but are not yet computed by
`scoreOrderRisk()` because they require cross-request or cross-session data.
They must be implemented in a separate risk review layer or as admin-visible flags.

### Coupon Abuse

- Customer uses coupons on consecutive orders at unusually high frequency.
- Same coupon code used across multiple accounts that share device fingerprint or IP.
- Coupon used on first order of a very new account with high order value.

Action: flag for admin review. Do not silently void the coupon.

### Multiple Accounts from Same Device / IP

- Two or more customer accounts place orders from the same device fingerprint
  or IP address within a short window.
- Account email patterns suggest synthetic registration (e.g., sequential or
  disposable email services).

Action: flag orders from all accounts for admin review. Do not block automatically
without human confirmation.

### Mismatched Payment and Profile

- Card BIN country does not match customer delivery address country.
- Card holder name differs significantly from account name.
- EFT sender name differs from account name.

Action: flag for admin review before releasing to seller fulfillment.

---

## Seller-Side Risk Signals

Fraud risk is not limited to customers. Seller behavior must also be monitored.

### Repeated Order Rejections

- Seller rejects 3 or more paid orders within a 30-day window.
- Pattern of rejection without clear reason codes.

Admin must review the seller's rejection history. Repeated rejection without
valid justification is grounds for seller suspension review.

### Unusual Bank Detail Changes

Per `docs/05-security/seller-iban-verification.md`:

- 2 or more IBAN changes within 30 days.
- Bank detail change submitted immediately before a payout batch.
- Change from a new or anomalous device/IP.

These are risk signals on the seller account, not only on the change itself.
They must remain visible in the seller risk profile in the admin panel.

### Repeated Return or Dispute Volume Against a Seller

- Seller has 5 or more open or recently resolved return/dispute cases.
- Dispute resolution ratio consistently favors the customer.

Admin should review whether the seller is fulfilling accurately, and may
pause payout eligibility pending review.

### Unusual Fulfillment Patterns

- Seller consistently enters tracking numbers near the end of the 20-day window.
- Seller enters tracking numbers that do not correspond to real cargo scans.
- Seller repeatedly requests fulfillment deadline extensions.

These patterns should surface in the admin seller risk view.

---

## Actions When Risk Is High

Risk level determines the required response. All responses must be logged.

### `medium` (score 40–59)

- Order is flagged in the admin risk queue.
- Seller fulfillment may proceed, but admin has visibility.
- If no admin review occurs within a configurable window, the order proceeds normally.
- Risk flag remains on the order record permanently.

### `high` (score 60–79)

- Fulfillment is paused pending admin review.
- Admin receives a notification or queue item.
- Admin must explicitly approve or reject progression.
- If approved, fulfillment proceeds with the risk flag recorded.
- If rejected, order moves to cancellation or fraud-hold state.

### `critical` (score 80–100)

- Fulfillment is blocked immediately.
- Seller does not see the order as actionable.
- Admin must review and take explicit action.
- Order may be canceled with customer refund, or held for extended investigation.
- Payout eligibility for any affected funds is blocked while review is open.

### Seller-Side Risk Actions

When seller risk signals are elevated:

- Payout eligibility may be paused for individual orders associated with the risk event.
- Seller account may be flagged for review without immediate suspension.
- Admin may suspend the seller pending investigation.
- All suspension and review actions are logged per `audit-logger.ts`.

---

## Fraud Review Visibility Requirements

Every risk-related decision must be visible and auditable. The following is required:

### Order-Level Visibility

- The fraud score, level, and triggered signal list must be stored on the order record
  or in an associated risk record at the time of scoring.
- Admin order views must display the score, level, and signals.
- The score must not be recalculated on the fly for display — it must reflect the
  state at the time of order creation.

### Admin Queue

- Admin must have a dedicated risk review queue showing orders with `requiresReview = true`.
- The queue must be filterable by risk level (`medium`, `high`, `critical`).
- Admin actions on risk-flagged orders must use the standard audit log.

### Audit Log Entries

All risk-related admin interventions must be logged using `buildAuditEntry()` from
`packages/security/src/audit-logger.ts`. The action type, actor, target entity,
previous state, new state, and reason must be recorded.

Relevant existing audit actions include:

- `order.cancelled_admin` — when admin cancels a high-risk order
- `seller.suspended` — when admin suspends a seller due to risk signals
- `payout.blocked` — when payout is blocked due to fraud review
- `dispute.opened` — when admin opens a dispute as a result of risk review

### Seller-Level Visibility

- Admin must see a seller-level risk summary: rejection rate, dispute rate, return rate,
  bank detail change history, and any open risk flags.
- This must be available without navigating to individual orders.

---

## Rate Limiting as Fraud Mitigation

`packages/security/src/rate-limiter.ts` defines the following presets that apply
to fraud-sensitive endpoints:

| Config | Limit | Window | Use Case |
|--------|-------|--------|----------|
| `AUTH_RATE_LIMIT` | 10 requests | 15 minutes | Login, password reset, registration |
| `SENSITIVE_RATE_LIMIT` | 20 requests | 60 seconds | Checkout, payment attempts, coupon application |
| `HIGH_RISK_RATE_LIMIT` | 5 requests | 15 minutes | Seller bank detail changes, admin finance actions |
| `API_RATE_LIMIT` | 60 requests | 60 seconds | General API endpoints |

Rate limit violations must be logged. Repeated violations above a threshold must
surface as a risk signal in the admin queue.

---

## What Fraud Logic Must Not Do

- Do not invent or add a hidden suppression that silently allows high-risk orders to
  proceed without any trace in the admin queue.
- Do not collapse risk levels into a single binary `suspicious/not-suspicious` flag.
- Do not reset fraud scores between page reloads or session changes for the same order.
- Do not block orders based on risk level alone without producing a reviewable
  reason in the audit trail.
- Do not expose the internal fraud score or signal list to the customer.
- Do not expose raw fraud reasoning to sellers for orders they fulfill.

---

## Cross-References

- `packages/security/src/fraud-scorer.ts` — `scoreOrderRisk()`, thresholds, signal list
- `packages/security/src/rate-limiter.ts` — rate limit presets
- `packages/security/src/audit-logger.ts` — audit entry builder
- `packages/security/src/permission-matrix.ts` — admin actions for risk review
- `db/schema/schema.prisma` — `OrderStatus.dispute_open`, `SellerStatus.suspended`, `AdminAuditLog`
- `.claude/rules/05-security-rules.md` — Fraud and Risk Rules section
- `.claude/rules/08-order-lifecycle-rules.md` — Risk and Fraud Interaction section
- `docs/05-security/seller-iban-verification.md` — IBAN change risk signals
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
