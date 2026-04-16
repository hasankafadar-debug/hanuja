---
name: seller-panel-flow
description: Apply Hanuja seller panel operating rules. Use when implementing seller order visibility, seller actions, fulfillment flow, payout messaging, and seller-facing operational UX.
user-invocable: false
paths:
  - "apps/seller-panel/**/*"
  - "api/**/*"
  - "packages/ui/**/*"
model: sonnet
effort: high
---

This skill defines the seller panel behavior for Hanuja.

Seller panel truths:
- Seller only sees payment-approved orders.
- Seller should not see hidden finance truth that belongs only to admin.
- Seller needs operational clarity, not accounting ambiguity.
- delivered and delivery_confirmed must remain distinct in seller-facing language.
- Payout readiness must not be overstated.

Seller panel priorities:
1. Clear next action
2. Clear order eligibility
3. Clear shipment/fulfillment workflow
4. Clear blockers
5. Clear but limited payout state visibility

Seller-facing rules:
- Do not show unpaid/unapproved orders as actionable.
- Do not expose admin-only finance internals.
- Do not imply payout starts at delivered.
- Do not blur status naming.
- Do not overload the seller with irrelevant internal exception logic.

Each seller screen should help answer:
- what order needs action now
- what has already been done
- what is blocked
- what the seller is waiting for
- what the platform/admin controls instead

Implementation guidance:
- seller actions must be validated server-side
- status badges and table columns must be unambiguous
- destructive or irreversible seller actions must be clear
- UI should favor operational efficiency over decoration

If a seller request conflicts with admin control or finance truth, keep the seller view limited and accurate.