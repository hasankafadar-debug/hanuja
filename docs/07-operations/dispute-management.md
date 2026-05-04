# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Dispute Management

## Overview

A dispute is not the same as a return request.

A return request is initiated by the customer to give back a product. A dispute is a formal conflict
between the customer and the seller where the customer claims something went wrong with the order,
the product, or the delivery — and expects platform intervention.

Disputes must be treated as structured, auditable operational flows. They are not free-form support
tickets. Every dispute has a payout consequence and requires an explicit resolution.

Source of truth for dispute behavior:
- `.claude/rules/08-order-lifecycle-rules.md`
- `.claude/rules/10-admin-panel-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `db/schema/schema.prisma` — `Dispute`, `DisputeMessage`, `DisputeStatus`, `MediaAsset`

---

## When a Dispute Can Be Opened

A dispute may be opened when:

- the delivered item is damaged
- the delivered item is incomplete (missing parts, accessories, or units)
- the wrong item was delivered
- the item does not match the product description in a material way
- the customer reports the shipment was marked delivered but not received
- a seller-customer disagreement cannot be resolved directly
- there is a fraud suspicion related to the order or delivery

A dispute can coexist with or follow a return request, but it is a separate record. The `Dispute`
model in the schema is distinct from `ReturnRequest`.

A dispute may be opened by the customer or by admin when an order requires escalated review.

---

## Dispute Status Model

The schema defines the following `DisputeStatus` values:

| Status | Meaning |
|---|---|
| `open` | Dispute filed, awaiting admin review |
| `under_review` | Admin is actively reviewing the case |
| `resolved_for_customer` | Admin ruled in favor of customer — refund or corrective action follows |
| `resolved_for_seller` | Admin dismissed the dispute — seller cleared, payout unblocked |
| `closed` | Case closed with no further action required |

Status transitions must be explicit and logged via `AdminAuditLog`. Do not infer dispute state from
other order or payout fields.

---

## Payout Blocking Rule

When a dispute is `open` or `under_review`, seller payout for the affected order must be blocked.

This is enforced by the `payoutBlocked` boolean on the `Dispute` model, which defaults to `true`.

Payout must remain blocked until:
- the dispute reaches a terminal status (`resolved_for_customer`, `resolved_for_seller`, or `closed`)
- and the admin explicitly confirms the payout block can be released

If the dispute resolves in favor of the seller, the payout block is released and the hold period
resumes normally. If the resolution in favor of the customer involves a refund, the corresponding
payout amount is reduced or eliminated before any release.

Do not release payout while a dispute record has `payoutBlocked: true`.

The `Payout.blockedReason` field must reference the dispute ID so the block cause is traceable.

---

## Evidence Capture

All parties may submit evidence. Evidence is stored as `MediaAsset` records linked to the dispute
via `disputeId`. The `MediaAssetType` enum includes `dispute_evidence`.

### Acceptable evidence types

- photos of the received product showing damage, wrong item, or incomplete contents
- screenshots of seller messages or the product listing at time of purchase
- cargo tracking records showing delivery status or failure
- written statements submitted as `DisputeMessage` entries
- invoice or order documents where relevant

### Evidence submission rules

- Customer submits evidence when opening the dispute or when admin requests more
- Seller submits counter-evidence through the seller panel dispute response form
- Admin may request additional evidence from either party before ruling
- All messages are recorded in `DisputeMessage` with `authorId` and `authorRole`
- `DisputeMessage` records are append-only and must not be deleted or edited

---

## Admin Review Steps

1. Admin opens the dispute detail view. The view must surface: order reference, customer reason and
   description, seller response, full message timeline, evidence attachments, current payout hold
   state, and related finance effect on the seller ledger.

2. Admin sets status to `under_review` when actively working the case. This signals to the seller
   and customer that the review is in progress.

3. Admin reviews all submitted evidence and messages from both parties.

4. Admin may request more evidence by sending a message through the dispute thread and leaving
   status as `under_review`. The request must be explicit, not an informal comment.

5. Admin selects one of the approved resolution types (see below), fills in the `resolution` text
   field, and confirms payout block state.

6. Every admin action creates an `AdminAuditLog` entry. The `resolution` field is mandatory before
   any terminal status is applied.

---

## Resolution Types

### Resolved for customer

Used when damage, wrong item, or material mismatch is confirmed by evidence and the seller is at fault.

Consequences:
- refund amount is recorded in `Dispute.refundAmount`
- if seller payout has not been released: payout is reduced or blocked for the affected order
- if seller payout was already released: a ledger entry of type `dispute_hold` records the debt,
  and subsequent entries of type `dispute_release` offset the amount from future payouts
- customer receives a refund notification with expected timing
- seller receives notification of the decision

### Resolved for seller

Used when the customer's claim is not supported by evidence, delivery was confirmed and the product
matched description, or an abuse pattern is identified.

Consequences:
- `payoutBlocked` is set to `false` on the dispute record
- if payout hold period had not matured, it resumes from where it was suspended
- customer is notified of the outcome with a plain-language explanation
- seller is notified that the dispute was dismissed

### Closed without ruling

Used for duplicate disputes, cases informally resolved before admin ruling, or cases where both
parties withdraw due to insufficient evidence.

Consequences:
- admin records a close reason in `resolution`
- payout hold state is explicitly confirmed as blocked or released before closing
- no automatic refund is triggered

---

## Seller Participation Rights

The seller panel must allow the seller to:

- view the dispute opened against their order
- read the customer's reason, description, and submitted evidence
- submit a written response via `DisputeMessage`
- upload counter-evidence as `MediaAsset` records with `type: dispute_evidence`
- see the current dispute status
- see that their payout is blocked while the dispute is open
- see the resolution outcome once the dispute is closed

The seller must not be able to:
- close or resolve the dispute unilaterally
- delete or edit the customer's submitted messages or evidence
- read admin-only internal review notes
- release their own payout block through any seller-panel action

---

## Customer Communication

The customer must receive a notification at these points:

- when the dispute is acknowledged and an internal reference is assigned
- when admin requests additional evidence from the customer
- when admin requests additional time for review (if delays are expected)
- when the dispute is resolved, with a plain-language explanation of the outcome
- when a refund is initiated (if applicable), with expected timing

Customer-visible dispute status must use simplified labels. Internal `DisputeStatus` enum values
are not shown verbatim in customer-facing screens.

Notifications use the `dispute_opened` and `dispute_resolved` types from the `NotificationType`
enum in the schema.

---

## Finance Ledger Entries

When a dispute results in a customer-favorable refund, the finance impact is recorded in
`SellerLedgerEntry`:

| Entry type | Meaning |
|---|---|
| `dispute_hold` | Amount blocked when dispute opens or refund is confirmed |
| `dispute_release` | Amount released back to seller if partially or fully cleared |

Both entry types carry `referenceType: 'dispute'` and `referenceId: <disputeId>`.

If the disputed amount exceeds the seller's current payout balance, the negative balance carries
forward to future payouts. Seller panel must display the negative balance with a reference to the
dispute that caused it.

---

## Audit Trail Requirements

Every admin action on a dispute must produce an `AdminAuditLog` entry containing:

| Field | Value |
|---|---|
| `actorId` | Admin user ID performing the action |
| `actionType` | `dispute_opened` or `dispute_resolved` |
| `targetType` | `dispute` |
| `targetId` | Dispute record ID |
| `previousData` | Previous status and `payoutBlocked` state |
| `newData` | New status, resolution text, and refund amount if applicable |
| `reason` | Mandatory for all terminal resolution decisions |

`DisputeMessage` history is append-only. `MediaAsset` records attached as evidence are retained
indefinitely for audit purposes and must not be deleted after dispute closure.

---

## Cross-Reference

- `.claude/rules/08-order-lifecycle-rules.md` — `dispute_open` and `dispute_resolved` in lifecycle
- `.claude/rules/07-marketplace-finance-rules.md` — payout block and ledger rules
- `.claude/rules/10-admin-panel-rules.md` — admin return/dispute action requirements
- `docs/07-operations/order-lifecycle.md` — order status transitions involving disputes
- `docs/07-operations/payout-lifecycle.md` — payout blocking conditions
- `docs/05-security/audit-logging-plan.md` — audit log field requirements
