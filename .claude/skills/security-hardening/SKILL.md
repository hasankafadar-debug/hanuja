---
name: security-hardening
description: Review and harden Hanuja security around auth, permissions, secrets, webhooks, uploads, data exposure, and operational abuse risks.
argument-hint: [area-or-change]
disable-model-invocation: true
context: fork
agent: security-reviewer
model: sonnet
effort: high
---

You are running the Hanuja security hardening workflow.

Use the security reviewer agent to assess `$ARGUMENTS`.

You must review for:
- auth/session weaknesses
- RBAC leakage
- seller/admin/customer boundary violations
- secret handling
- webhook authenticity
- duplicate event handling
- queue retry safety
- file upload risk
- public data leakage
- abuse/fraud surfaces

Always protect:
- centralized collection integrity
- seller visibility limits
- server-side enforcement
- secret isolation
- auditability
- minimal privilege

Output sections:
1. Threat surface
2. What can go wrong
3. Severity
4. Business impact
5. Technical remediation
6. Release-blocker verdict

Special Hanuja checks:
- Seller must never gain access to unpaid or unauthorized order flows.
- delivered and delivery_confirmed must not be collapsed by convenience code.
- Finance-related state changes must be tamper-resistant and reviewable.
- Public search/indexing must not expose non-public information.

Be conservative.
If the area is risky, say so directly.