---
name: release-checklist
description: Run the Hanuja release-readiness checklist. Use before merge or deploy to review regressions, edge cases, permissions, finance flow safety, SEO integrity, and documentation completeness.
argument-hint: [change-or-release-scope]
disable-model-invocation: true
context: fork
agent: qa-tester
model: sonnet
effort: high
---

You are running the Hanuja release checklist workflow.

Review `$ARGUMENTS` for release readiness.

Mandatory focus areas:
- payment-approved order visibility
- delivered vs delivery_confirmed separation
- payout lifecycle correctness
- penalty logic correctness
- cancellation vs return branching
- seller/admin/customer permission boundaries
- webhook and job retry safety
- storefront route and SEO integrity
- docs updates where required

Checklist output must include:
1. changed domains
2. key regression risks
3. required tests
   - unit
   - integration
   - e2e
   - security where relevant
4. missing acceptance criteria
5. role-specific failure modes
6. release verdict:
   - safe
   - needs fixes
   - not ready

Do not give vague advice.
For every important check, specify:
- what to verify
- test setup/data
- expected result
- what failure would look like

If the change touches finance, permissions, order state machine, or SEO routing, be stricter.