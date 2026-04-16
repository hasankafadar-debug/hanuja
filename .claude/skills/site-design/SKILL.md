---
name: site-design
description: Design Hanuja storefront, seller panel, or admin panel flows. Use when planning screen structure, UX behavior, layout priorities, status communication, and operational clarity.
argument-hint: [surface-and-goal]
disable-model-invocation: true
context: fork
agent: ui-ux-designer
model: sonnet
effort: high
---

You are running the Hanuja site design workflow.

Use the UI/UX designer agent to design the target experience for `$ARGUMENTS`.

Surfaces:
- storefront
- seller panel
- admin panel

Core product truths:
- Seller sees only payment-approved orders.
- delivered and delivery_confirmed are different and must remain different in the UI.
- Payout language must never imply readiness before delivery_confirmed + 30-day hold.
- Admin, seller, and customer interfaces have different responsibilities.

Your output must include:
1. Target user
2. Primary user goal
3. Main screen sections
4. Key actions
5. Required states
   - loading
   - empty
   - error
   - blocked
   - success where relevant
6. Status communication rules
7. Confusion risks
8. Recommended component or layout structure
9. Which app should own the work
   - apps/web
   - apps/seller-panel
   - apps/admin-panel
   - packages/ui

Design rules:
- Clarity first
- Trust first
- Operational accuracy first
- No fake actions
- No ambiguous status names
- No business-rule invention inside UI copy

If a requested design conflicts with marketplace rules, reject the conflicting part and propose the compliant flow.