---
name: marketplace-content-audit
description: Audit Hanuja marketplace content quality across product, category, blog, and store pages. Use when reviewing duplication, thin content, weak trust copy, inconsistent naming, and content scalability.
argument-hint: [page-group-or-scope]
disable-model-invocation: true
context: fork
agent: docs-maintainer
model: sonnet
effort: high
---

You are running the Hanuja marketplace content audit workflow.

Audit `$ARGUMENTS` across:
- product content
- category content
- blog content
- store content
- trust/policy language
- marketplace terminology consistency

What to audit:
1. duplicate or near-duplicate copy
2. thin content
3. weak or generic commercial language
4. terminology drift
5. misleading trust wording
6. route/content intent mismatch
7. scaling issues as catalog grows
8. documentation inconsistency where content rules are defined

Mandatory terminology consistency:
- delivered
- delivery_confirmed
- payment-approved order
- payout hold
- penalty
- seller
- admin
- storefront/customer

Output:
- findings by page type
- severity
- content risks
- what to rewrite
- what to standardize
- what belongs in docs vs in-app copy

Important:
Do not optimize copy in a way that hides operational truth.
Trust language must remain honest and consistent with the real marketplace model.