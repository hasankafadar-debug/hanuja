---
name: payout-lifecycle
description: Apply Hanuja payout lifecycle rules. Use when implementing or reviewing payout timing, payout eligibility, hold status, release conditions, and payout-related admin or seller behavior.
user-invocable: false
paths:
  - "api/**/*"
  - "apps/admin-panel/**/*"
  - "apps/seller-panel/**/*"
  - "db/**/*"
model: sonnet
effort: high
---

This skill defines the payout lifecycle for Hanuja.

Non-negotiable rules:
- Payout does not begin from delivered.
- Payout countdown starts from delivery_confirmed.
- There is a 30-day hold before payout.
- Seller-facing payout messaging must follow the true lifecycle.
- Payout readiness must be explicit, not inferred loosely.

Canonical payout flow:
1. Payment approved
2. Seller can see/process order
3. Fulfillment progresses
4. delivered may occur
5. delivery_confirmed occurs
6. payout hold countdown starts
7. hold completes
8. payout becomes eligible/ready according to the system’s payout process

Important distinctions:
- delivered is logistics outcome
- delivery_confirmed is commercial confirmation trigger
- payout_hold is finance timing state
- payout_ready is not the same as delivered or shipped

Required behavior:
- Seller panel must not imply “money earned and releasable” too early.
- Admin panel must clearly show payout stage and blockers.
- Backend must guard payout timing by rule, not suggestion.
- Tests must cover edge timing and state confusion cases.

When this skill is active:
- reject any simplification that starts payout from delivered
- reject merged wording like “delivered/confirmed”
- preserve explicit lifecycle naming in schema, services, routes, and UI