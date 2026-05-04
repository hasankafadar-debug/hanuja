# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Support SLA

## Overview

This document defines response time targets, escalation paths, and operational ownership for
customer, seller, and admin support operations on the Hanuja marketplace.

Hanuja's central payment collection model means that support failures in finance-related areas
are not just service quality problems — they are business-critical and potentially legally
sensitive. Response time targets reflect that reality.

Source of truth for operational authority:
- `.claude/rules/10-admin-panel-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`

---

## Ticket Type Definitions

Support tickets are categorized by type before SLA targets are applied. Miscategorization raises
response time and delays escalation. Admin queues must apply the correct category at intake.

| Ticket type | Description |
|---|---|
| Payment issue | Failed charge, EFT not confirmed, double charge, refund not received |
| Return request | Customer initiating a product return within or outside 14-day window |
| Dispute escalation | Customer or seller escalating a unresolved conflict to platform admin |
| Payout issue | Seller payout delayed, incorrect amount, payout blocked unexpectedly |
| Order exception | 20-day breach, seller rejection, cancellation dispute, delivery conflict |
| Account issue | Login, identity verification, seller onboarding, account suspension |
| Product moderation | Rejection appeal, listing correction, seller content complaint |
| General inquiry | Product questions, policy questions, how-to requests |

---

## Response Time Targets by Ticket Type

Response time is defined as the time from ticket creation to the first substantive human response.
Automated acknowledgment does not count as a response.

### Critical — 2-hour first response target

Applies to:

- **Payment failures where customer was charged but order is not confirmed** — Risk of double
  charge, customer distress, and potential chargeback if unresolved quickly.

- **Payout errors where a seller received an incorrect or missing payout** — Finance-critical;
  affects seller trust and may trigger legal or regulatory concern.

- **EFT/bank transfer stuck in pending for more than 24 hours after submission** — Blocks seller
  queue entry and order fulfillment.

- **Suspected fraud on an active order** — Seller must be protected from fulfilling a fraudulent
  order; payout and delivery risk must be contained.

The 2-hour target applies during business hours (09:00–19:00 Turkish time, Monday–Saturday). Outside
business hours, on-call operations must respond within 4 hours for these cases.

### High — 8-hour first response target (business hours)

Applies to:

- **Dispute escalations** — Once a dispute is `open` and payout is blocked, the seller and customer
  are waiting. Delayed review extends payout hold unnecessarily and damages seller trust.

- **Return requests requiring admin review** — Returns outside the 14-day window or those with
  disputed quality claims require human judgment. Seller payout may be affected.

- **20-day fulfillment breach cases** — Customer has a right to cancel; admin must review before
  the seller continues preparation unnecessarily.

- **Seller suspension inquiries** — Suspended seller cannot fulfill orders. Rapid review prevents
  cascading order failures.

### Standard — 24-hour first response target (business days)

Applies to:

- **Order exception follow-ups** — Seller rejection review, cancellation confirmation, delivery
  conflict where shipment tracking is not in dispute.

- **Payout status questions** — Seller asking why a payout is still in hold when 30-day period has
  passed. Likely requires checking for open returns or disputes.

- **Product moderation rejection appeals** — Seller asking for clarification or disputing a
  rejection. Does not block orders but affects seller catalog.

- **Account issues** — Login recovery, identity verification follow-up, seller onboarding status.

### Low — 48-hour first response target (business days)

Applies to:

- **General inquiries** — Policy questions, product information requests, how-to questions.
- **Feature or improvement suggestions** — Not operational; routed to product backlog.
- **Completed order follow-ups** — Questions about a closed order where no finance action is needed.

---

## Escalation Paths

Escalation moves a ticket to a higher-authority role when the current handler cannot resolve it.
Escalation must be explicit — it is not automatic or time-based.

### Level 1 — Support admin

Handles:
- general inquiries
- standard account issues
- routine return requests within 14-day window
- order tracking and status questions
- first-contact triage for payment and dispute tickets

Cannot:
- approve or reject EFT payments
- release payout holds
- waive penalties
- suspend or reinstate sellers
- apply manual ledger adjustments

Escalates to: Operations admin or Finance admin depending on ticket type.

### Level 2 — Operations admin

Handles:
- 20-day breach cases
- seller rejection reviews
- return requests outside 14-day window
- delivery confirmation disputes
- product moderation appeals
- dispute case intake and initial review

Cannot:
- release a payout that Finance admin has blocked
- create manual ledger adjustments
- waive penalties on seller ledger

Escalates to: Finance admin for payout-related outcomes, or Super admin for unusual authority
requirements.

### Level 3 — Finance admin

Handles:
- EFT/bank transfer approval and rejection
- payout block review and release
- penalty application review
- penalty waiver decisions
- manual ledger adjustments
- dispute resolution with finance consequences
- negative balance review and recovery planning

Cannot:
- suspend or reinstate sellers (that is Operations admin or Super admin)
- modify system configuration

Escalates to: Super admin for cases involving unusual authority, legal risk, or disputed admin
decisions.

### Level 4 — Super admin

Handles:
- seller suspension and reinstatement
- escalated disputes where lower levels could not reach resolution
- contested penalty waivers
- legal or compliance-sensitive cases
- admin override of any lower-level decision where documented
- any case involving potential regulatory concern

Super admin actions are always logged in `AdminAuditLog` with reason mandatory.

---

## Operational Ownership by Area

| Area | Primary owner | Escalation to |
|---|---|---|
| EFT/bank transfer approval | Finance admin | Super admin |
| Iyzico card payment failure | Finance admin | Super admin |
| Payout block review | Finance admin | Super admin |
| Penalty waiver | Finance admin | Super admin |
| Manual ledger adjustment | Finance admin | Super admin |
| Dispute resolution | Operations admin | Finance admin |
| Return request review | Operations admin | Finance admin |
| 20-day breach case | Operations admin | Super admin |
| Seller rejection review | Operations admin | Super admin |
| Seller suspension | Operations admin | Super admin |
| Seller reinstatement | Super admin | — |
| Product moderation | Moderation admin | Operations admin |
| Account issue | Support admin | Operations admin |
| General inquiry | Support admin | Operations admin |

---

## Critical Incident SLA

A critical incident is defined as a system-level failure or event that affects multiple customers
or sellers simultaneously, or that involves confirmed financial harm.

### Critical incident examples

- Payment provider (Iyzico) returning errors for all card payments
- EFT approval system inaccessible
- Payout job failed and no payouts were processed on their scheduled date
- Seller panel displaying incorrect payout figures due to a calculation bug
- Seller receiving orders they should not see (payment isolation breach)
- Customer payment confirmed but order not moving to seller queue

### Critical incident response targets

| Stage | Target |
|---|---|
| Detection | Identified by monitoring or first report |
| Acknowledgment | Within 30 minutes of detection |
| Initial impact assessment | Within 1 hour |
| Customer/seller communication | Within 2 hours |
| Root cause identification | Within 4 hours |
| Resolution or workaround | Within 8 hours |
| Post-incident review | Within 48 hours |

### Critical incident ownership

- Finance admin owns payout-related incidents
- Operations admin owns order lifecycle incidents
- Super admin is notified for all critical incidents within 30 minutes of acknowledgment
- All critical incidents must produce a written incident summary after resolution

---

## Communication Standards

### Tone and content

All support communications must:
- state the current status of the issue clearly
- give an expected next step or resolution timeline where known
- avoid technical jargon that the recipient cannot act on
- not make commitments that the support role is not authorized to fulfill

Do not tell a seller a payout will be released unless Finance admin has confirmed it.
Do not tell a customer a refund is approved unless the refund has been formally authorized.

### Finance-related communication

Before any finance-related communication (payout timing, refund status, penalty outcome), support
must verify the current system state in the admin panel. Do not communicate based on memory or
assumptions.

### Audit trail for support decisions

When a support action results in an admin system action (status change, payout note, dispute
comment), the action must be recorded through the system — not only in an email or messaging thread.
Support-related admin actions that change system state must produce an `AdminAuditLog` entry.

---

## Out-of-Hours Operations

Business hours: 09:00–19:00 Turkish time, Monday through Saturday.

Outside business hours, a reduced on-call team handles:
- critical incident acknowledgment (30-minute target regardless of hours)
- payment failure triage for active payment windows
- fraud escalations

Non-critical tickets submitted outside business hours receive their SLA response clock started at
09:00 the next business day.

---

## SLA Measurement

SLA compliance is measured by:
- time from ticket creation to first substantive human response
- percentage of tickets resolved within their target window by ticket type
- escalation rate by level (high escalation rate from Level 1 indicates categorization or training gap)
- critical incident time-to-resolution

SLA data should be reviewable by Super admin and Operations admin weekly.

---

## Cross-Reference

- `.claude/rules/10-admin-panel-rules.md` — admin role structure and permissions
- `.claude/rules/07-marketplace-finance-rules.md` — finance operations ownership
- `.claude/rules/08-order-lifecycle-rules.md` — order exception handling
- `docs/07-operations/dispute-management.md` — dispute resolution steps
- `docs/07-operations/order-lifecycle.md` — lifecycle states that trigger support cases
- `docs/07-operations/payout-lifecycle.md` — payout hold and release conditions
- `docs/05-security/audit-logging-plan.md` — audit requirements for support-triggered actions
- `docs/05-security/admin-action-policy.md` — which admin roles may take which actions
