---
name: order-status-flow
description: Apply Hanuja order lifecycle and status machine rules. Use when modeling statuses, transitions, seller actions, customer visibility, cancellation, return, and status-driven UI or backend logic.
user-invocable: false
paths:
  - "api/**/*"
  - "apps/web/**/*"
  - "apps/seller-panel/**/*"
  - "apps/admin-panel/**/*"
  - "db/**/*"
model: sonnet
effort: high
---

This skill defines Hanuja order status discipline.

Main principle:
Order lifecycle must be an explicit state machine, not a loose collection of labels and booleans.

Critical truths:
- Seller only sees payment-approved orders.
- Payment, fulfillment, delivery, delivery confirmation, return, and cancellation are separate concerns.
- delivered and delivery_confirmed must remain separate.
- Status wording must be operationally precise.
- Admin, seller, and customer may see different levels of detail.

Flow design rules:
1. Payment status must not be merged into fulfillment status.
2. Shipping/dispatch must not imply completion.
3. delivered must not imply delivery_confirmed.
4. Return flow must not be treated as ordinary cancellation.
5. Penalty and payout effects may depend on lifecycle stage.
6. Status transitions must be guarded and validated server-side.
7. Role-based action visibility must follow true status eligibility.

When working on status logic:
- define the current state
- define allowed next states
- define who can trigger each transition
- define side effects
- define audit/history requirement
- define UI language separately per role if necessary

Never accept:
- ambiguous status names
- merged commercial and logistics states
- frontend-only transition authority
- silent side effects without history