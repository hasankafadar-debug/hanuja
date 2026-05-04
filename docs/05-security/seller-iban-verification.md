# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Seller IBAN / Bank Account Verification Policy

## Purpose

Seller bank account (IBAN) data is the most financially sensitive field the platform
holds on behalf of a seller. A fraudulent or unauthorized IBAN change can redirect
payout funds to an attacker's account with no automatic recovery path.

This document defines the required friction, logging, activation delay, and payout
blocking behavior that must surround every IBAN or bank detail change event.

---

## Why This Is High Risk

- Hanuja collects all customer payments centrally and pays sellers after `delivery_confirmed`.
- If an attacker changes a seller's IBAN before a payout batch runs, funds go to the
  wrong account immediately.
- The damage is potentially irreversible without legal intervention.
- Sellers may not notice the change before the next payout cycle runs.

IBAN change is one of the highest-risk mutation operations in the platform,
comparable to a payout release action. It must never be treated as a simple
form save.

---

## Data Model Reference

The relevant schema model is `SellerBankDetail` in `db/schema/schema.prisma`.

| Field | Meaning |
|-------|---------|
| `iban` | Raw IBAN — must not be stored or logged in cleartext outside payout execution |
| `accountHolder` | Legal name of account owner |
| `bankName` | Bank name |
| `isActive` | Whether this record is the active payout destination |
| `isVerified` | Whether admin or a verification step has confirmed this record |
| `verifiedAt` | Timestamp of verification |
| `activatedAt` | Timestamp when the record became active for payout use |

A seller may have multiple `SellerBankDetail` rows. Only one may have `isActive = true`
at any point. A newly submitted record must start with `isActive = false` and remain
inactive until the activation process completes.

---

## Required Friction Layers

Every bank detail change must pass through all of the following layers in sequence.
No layer may be skipped silently.

### Layer 1 — Re-Authentication

Before the seller can submit new bank details:

- The seller must re-confirm their identity with current credentials (password re-entry
  or equivalent step-up verification).
- This must be server-enforced, not only a client-side form gate.
- The re-auth event itself must be timestamped and logged against the seller session.

This prevents session-hijacking scenarios where a logged-in browser is briefly
accessed by a third party.

### Layer 2 — Rate Limiting

Bank detail changes are subject to `HIGH_RISK_RATE_LIMIT` as defined in
`packages/security/src/rate-limiter.ts`:

- Maximum 5 attempts per 15-minute window per seller identity.
- Exceeding this limit must block further submission for the window duration.
- Repeated near-limit attempts must escalate a risk signal to the admin queue.

### Layer 3 — Delayed Activation

A newly submitted bank detail record must never become active immediately.

Required behavior:

- Newly submitted records begin with `isActive = false` and `isVerified = false`.
- The record enters a pending state visible in the admin review queue.
- Activation must not occur until at minimum one of these conditions is met:
  - Admin explicitly approves the record via the admin panel action.
  - A configured minimum hold period (recommended: 24–48 hours) elapses with no
    admin rejection flag and no active risk signal.
- `activatedAt` is set only when activation is confirmed, not at creation time.

Do not flip `isActive = true` in the same database transaction that creates the record.

### Layer 4 — Admin Review Queue

All pending bank detail changes must appear in the admin panel's dedicated review queue.

Admin must see:

- Seller identity (name, ID, status)
- Masked new IBAN — use `maskIban()` from `packages/security/src/data-masker.ts`
- Masked previous IBAN for side-by-side comparison
- Submission timestamp
- Re-auth confirmation flag
- Any risk signals triggered against this change (see Risk Signals section)
- Approve / reject action buttons, both requiring a mandatory reason field

Admin approval is logged using the `seller.bank_detail_approved` audit action
from `packages/security/src/audit-logger.ts`.

Admin rejection is logged using `seller.bank_detail_changed` with rejection state.

### Layer 5 — Immutable Change History Log

Every bank detail change event, regardless of outcome (submitted, approved, rejected,
or reversed), must produce an audit log entry.

`packages/security/src/audit-logger.ts` provides `auditBankDetailChanged()` which records:

- `actorId` — seller user ID (or admin user ID if admin-initiated)
- `actorRole`
- `targetEntityType: 'SellerBankDetail'`
- `targetEntityId` — seller ID
- `previousState: { iban: maskedOldIban }`
- `newState: { iban: maskedNewIban }`

This entry must be created at submission time, not at activation time. The record must
persist even if the change is ultimately rejected. History must never be deleted or
overwritten.

The `AdminActionType.seller_bank_detail_changed` enum value in the schema supports
storing this in the `AdminAuditLog` table.

### Layer 6 — Seller Notification

When a bank detail event occurs, the seller must be notified via the platform
notification system. Notification content must use masked IBAN only.

Minimum notification events:

- **Submitted**: "Your bank account update request has been received and is under review."
- **Approved and activated**: "Your bank account details have been updated and are now active for payouts."
- **Rejected**: "Your bank account update request was not approved. Please contact support."

---

## Masking Rules

The IBAN value must never appear unmasked in:

- Application logs at any level
- Admin table list views
- Seller-facing UI at any state
- Audit log `previousState` / `newState` fields
- Notification messages
- API response bodies

Use `maskIban()` from `packages/security/src/data-masker.ts`.

Example: `TR330006100519786457841326` becomes `TR** **** **** **** **** **41 26`

The full raw IBAN is accessed only inside the payout execution flow on the server,
by authorized service code, and is never logged in cleartext.

---

## Risk Signals for Escalation

The following patterns must trigger escalation to admin review and raise a risk flag
on the pending change. Risk signals delay activation regardless of the hold period.

| Signal | Condition | Required Action |
|--------|-----------|-----------------|
| Repeated changes | 2 or more IBAN changes within 30 days | Require explicit admin approval before activation |
| Pre-payout timing | Change submitted within 48 hours of a scheduled payout batch | Delay activation past the batch execution |
| Post-suspension change | Change submitted while seller is suspended or was recently suspended | Require explicit admin approval |
| Open dispute or return | Active dispute or return against seller at submission time | Block activation until all open cases are resolved |
| Unusual submission context | New device fingerprint or anomalous IP relative to seller history | Flag for admin review; do not auto-reject |

Risk signals must be visible in the admin review queue alongside the change record.
They must escalate the change to a human decision. They must not silently suppress
or silently approve.

---

## Payout Blocking Rules

Payout to a seller must be blocked in these bank detail states:

1. **No active record** — seller has no `SellerBankDetail` row with `isActive = true`.
   Payout is held. Seller must be notified to add and verify bank details.

2. **Active record exists but is unverified** — `isActive = true` but `isVerified = false`.
   Payout must be held until admin verification is complete.

3. **Pending change under review** — a new record was submitted but not yet activated.
   The previous active record remains active for the hold period. If no previous active
   record exists, payout is held entirely until a verified record is activated.

4. **Admin-flagged active record** — an existing `isActive` record has been flagged
   by admin for review. Payout must not proceed until the flag is resolved.

The payout service must check `SellerBankDetail` state before releasing any payout.
Checking `isActive` alone is not sufficient. `isVerified` must also be true.

---

## Seller Panel UX Requirements

The seller panel must communicate clearly:

- Current active bank account: masked IBAN, account holder name, bank name.
- Status of any pending change: submitted, under review, approved, rejected.
- A visible warning before the change form is accessible: "Changes to bank details
  require admin review and will not take effect immediately. Payouts may be delayed
  during the review period."
- A mandatory confirmation step before final submission.
- History of past bank detail changes (masked, with timestamps and status).

Do not design this as a standard form save. The change is consequential and must
feel that way to the seller.

---

## Admin Panel Requirements

- Dedicated queue for pending bank detail changes, separate from general seller settings.
- Side-by-side masked IBAN comparison (old record vs new record).
- Associated risk signals displayed prominently.
- Approve and reject both require a mandatory reason field.
- Both outcomes are persisted to the audit log immediately.
- Admin may flag an existing active record for review without deactivating it,
  which will block the next payout for that seller until the flag is resolved.
- The queue must be visible on the admin dashboard summary as a count of pending approvals.

---

## Cross-References

- `packages/security/src/data-masker.ts` — `maskIban()` implementation
- `packages/security/src/audit-logger.ts` — `auditBankDetailChanged()`, `auditBankDetailApproved()`
- `packages/security/src/rate-limiter.ts` — `HIGH_RISK_RATE_LIMIT` (5 per 15 min)
- `packages/security/src/permission-matrix.ts` — `seller:update_bank_detail` action
- `db/schema/schema.prisma` — `SellerBankDetail` model, `AdminActionType.seller_bank_detail_changed`
- `.claude/rules/05-security-rules.md` — Seller Identity and IBAN Rules
- `.claude/rules/07-marketplace-finance-rules.md` — Payout eligibility blocking conditions
- `docs/05-security/audit-logging-plan.md`
- `docs/07-operations/payout-lifecycle.md`
