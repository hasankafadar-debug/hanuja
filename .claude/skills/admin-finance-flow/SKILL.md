---
name: admin-finance-flow
description: Apply Hanuja admin finance rules. Use when working on admin-facing payment, penalty, payout visibility, settlement review, finance timelines, and operational finance control.
user-invocable: false
paths:
  - "apps/admin-panel/**/*"
  - "api/**/*"
  - "db/**/*"
  - "packages/types/**/*"
model: sonnet
effort: high
---

This skill contains the source guidance for Hanuja admin finance flow behavior.

Core finance truths:
- Collection is centralized.
- Seller only sees payment-approved orders.
- Payout countdown starts from delivery_confirmed, not delivered.
- 30-day hold exists before payout.
- Standard penalty is 20% of product amount.
- delivered and delivery_confirmed are different concepts.
- Admin has full finance oversight responsibility.

Use this skill whenever working on:
- admin payment review screens
- havale/EFT review logic
- payout readiness visibility
- penalty application
- settlement calculations
- order-finance timelines
- seller balance or receivable representation
- finance dashboard summaries

Admin finance rules:
1. Admin may see the whole finance picture; seller may not.
2. Payment status must be separate from fulfillment status.
3. Penalty logic must be explicit and auditable.
4. Payout status must reflect hold timing accurately.
5. Finance views should optimize control, exception spotting, and traceability.
6. No UI wording should imply payout readiness before the hold is complete.
7. Every important admin finance screen should make clear:
   - current state
   - blocking reason
   - next operator
   - risk or exception if any

Implementation guidance:
- Put finance truth in backend/domain logic.
- Use explicit enums, timeline records, and history.
- Do not compute critical finance truth only in UI.
- Prefer reversible or traceable admin actions.

When helping with a task:
- preserve auditability
- preserve role boundaries
- preserve timing correctness
- reject shortcuts that merge financial states