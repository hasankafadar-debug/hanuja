# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Incident Response Plan

## Purpose

This document defines how Hanuja detects, contains, communicates, and recovers from
security and operational incidents. Because Hanuja collects all customer payments
centrally and holds seller funds during a 30-day payout hold, incidents that touch
payment or payout flows are treated as critical by default.

---

## Incident Severity Levels

| Level | Description | Response Target |
|-------|-------------|-----------------|
| P1 — Critical | Payment compromise, payout logic error affecting funds, PII data breach | Immediate — within 30 minutes |
| P2 — High | Seller account takeover, admin session abuse, bulk fraud signal spike | Within 2 hours |
| P3 — Medium | Anomaly signals with no confirmed impact, failed job patterns, isolated auth failures | Within 8 hours |
| P4 — Low | Single non-sensitive error, cosmetic failure, isolated UI bug | Next business day |

---

## Detection Sources

Incidents may be detected through any of the following channels.

### Automated monitoring
- BullMQ queue: failed job count spike on `payout-maturity`, `delivery-silent-confirmation`,
  or `reconciliation` queues.
- Error rate increase on payment routes: `POST /api/payments/webhook` or
  `POST /api/admin/payments/eft/:id/approve`.
- Fraud scorer alerts: orders reaching `critical` level (score 80+) as defined in
  `packages/security/src/fraud-scorer.ts` with thresholds `{ review: 40, high: 60, critical: 80 }`.
- Anomalous admin action frequency: unusually high volume of manual payout release or
  penalty waiver actions in a short window, observable via `AdminAuditLog`.
- Authentication failure spikes on admin-panel or seller-panel middleware.

### User and seller reports
- Customer reports missing payment confirmation after completing checkout.
- Seller reports unexpected payout block or unexplained ledger deduction.
- Admin reports inability to access audit log or payout queue.

### Internal signals
- `AdminAuditLog` records with absent `reason` field on high-impact action types.
- `seller-ledger` mutation detected without a corresponding audit log entry in the same transaction.
- Meilisearch index returning non-public product or user data in public search results.

---

## Incident Types and Containment Steps

### 1. Payment Compromise

Symptoms: webhook replayed without signature verification, payment marked confirmed
without Iyzico backend verification, EFT manually approved without evidence, frontend-supplied
payment status trusted by route handler.

Containment:
1. Disable the affected payment endpoint — return 503 from the relevant handler in `api/routes/payments.ts`.
2. Invalidate all active admin sessions via the Better Auth session store.
3. Halt pending EFT approval actions — remove or pause the relevant queue entries.
4. Alert the operations lead immediately (see escalation chain).
5. Preserve all request logs for the affected time window before any rotation occurs.
6. Review `AdminAuditLog` for actors and timestamps in the affected window.
7. Block payout eligibility for every order whose payment was confirmed during the incident
   window — set status to `payout_blocked` with reason recorded.

Recovery gate: finance review of every order confirmed during the incident window.
Payout eligibility must be re-evaluated order by order before re-enabling normal payout flow.

---

### 2. Payout Batch Error

Symptoms: `payout-maturity.job.ts` or `payout-batch.job.ts` releases payout before the
30-day hold expires, releases payout with an open return or dispute, or applies an incorrect
net payout calculation.

Containment:
1. Halt the affected BullMQ worker — pause the repeatable job via `schedule-repeatable-jobs.ts`.
2. Set affected payout records to `payout_blocked` via direct database update, with admin
   actor ID and reason written to `AdminAuditLog` in the same transaction.
3. Identify the full set of affected payout IDs from the job run timestamp range.
4. Do not process further payouts until root cause is confirmed and corrected.
5. If funds have already transferred externally, open a finance recovery workflow immediately.

Recovery gate: corrected job logic reviewed, all affected payout records audited individually,
finance lead sign-off required before re-enabling the job.

---

### 3. Data Exposure

Symptoms: PII visible in server logs without masking, seller IBAN exposed in an admin table
without masking, customer personal data returned in a public API response, Meilisearch index
containing non-public product or user data.

Containment:
1. Identify scope: which data type, which endpoint or index, which time window, which actors
   may have seen the data.
2. Mask or redact exposed log entries immediately using helpers from
   `packages/security/src/data-masker.ts`.
3. If Meilisearch is implicated: pause `search-index-sync.job.ts` and flush the affected index.
   Re-index from the PostgreSQL source only after the root cause is resolved.
4. Restrict access to the affected admin endpoint or API route during investigation.
5. Document which user or seller records may have been visible to unauthorized parties.
6. Notify affected users per KVKK obligation within 72 hours of confirmed breach (see Communication).

Recovery gate: log masking confirmed active, index re-indexed from clean source, endpoint
patched and verified in staging before re-enabling on production.

---

### 4. Seller Account Takeover

Symptoms: seller session active from unrecognized IP immediately after an IBAN change,
mass product edits or shipment entries from seller account inconsistent with prior patterns,
unusual payout detail change followed by a payout reaching `payout_ready` state.

Containment:
1. Immediately suspend the seller account — set `status = suspended`, write audit entry.
2. Block all outbound payout for the seller — transition any `payout_ready` or `hold_active`
   payout records to `payout_blocked` with reason and actor recorded.
3. Invalidate all active sessions for the seller user via Better Auth.
4. Review `AdminAuditLog` for IBAN change events, product edits, and shipment actions on
   this seller within the suspected window.
5. Flag all orders fulfilled by this seller during the suspected window for manual review
   before they can progress further in the payout lifecycle.
6. Notify the legitimate seller at their registered email that the account is suspended pending
   identity re-verification.

Recovery gate: seller identity re-verified, IBAN confirmed safe, flagged orders reviewed
by operations, account re-activated by admin with a new audit entry.

---

## Communication

### Internal escalation chain

| Incident level | Primary contact | Secondary contact |
|----------------|----------------|-------------------|
| P1 | On-call engineer + operations lead | Finance lead |
| P2 | On-call engineer | Operations lead |
| P3 | Engineer assigned to the affected service | — |
| P4 | Normal ticket queue | — |

All P1 and P2 incidents must produce a written incident channel post within 30 minutes of
detection. The post must include: what is known, what has been contained, and what remains open.

### User notification timing

- P1 payment compromise: notify affected customers within 24 hours if their payment records
  were implicated.
- P1 data exposure with PII: notify affected users within 72 hours per KVKK Article 12.
- P2 seller account takeover: notify the legitimate seller during step 6 of containment.
- Do not send user notifications before containment is confirmed unless legally required.

---

## Recovery Steps

All incidents follow this recovery sequence after containment:

1. Root cause identified and documented in writing.
2. Fix deployed to staging and verified against the original failure scenario.
3. Affected data records reviewed and corrected with audit entries for each change.
4. Monitoring alert confirmed active for the same pattern.
5. Affected service re-enabled on production.
6. Finance or data review complete for all P1 and P2 incidents with fund or PII impact.
7. Post-mortem document completed within 5 business days.

---

## Post-Mortem Requirements

Every P1 and P2 incident requires a written post-mortem within 5 business days.
P3 incidents require a brief internal note. P4 incidents are captured in the ticket system only.

A post-mortem must include:

- Timeline: detection time, containment time, full recovery time.
- Root cause: the technical or process failure that allowed the incident.
- Impact scope: which users, sellers, orders, or payouts were affected and to what degree.
- Containment actions taken and their effectiveness.
- Corrective actions: code changes, configuration changes, new monitoring, documentation updates.
- Which docs were updated as a result — at minimum the relevant security, finance, or operations doc.

Post-mortems are stored under `docs/05-security/post-mortems/` with the naming pattern
`YYYY-MM-DD-short-title.md`.

---

## Incident Ownership by Type

| Incident type | Owner | Finance sign-off required |
|---------------|-------|--------------------------|
| Payment compromise | Engineering + Operations | Yes |
| Payout batch error | Engineering + Finance | Yes |
| Data exposure | Engineering + Operations | If ledger data affected |
| Seller account takeover | Operations + Engineering | Yes — block payout until cleared |
| Fraud signal spike | Operations | If any affected orders progressed to fulfillment |
| Admin session abuse | Engineering | Yes — audit all admin actions in affected window |

---

## Cross-Reference Files

- `.claude/rules/05-security-rules.md`
- `docs/05-security/audit-logging-plan.md`
- `docs/05-security/fraud-risk-rules.md`
- `docs/05-security/payment-security.md`
- `docs/05-security/seller-iban-verification.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/08-legal/payment-regulation-notes.md`
