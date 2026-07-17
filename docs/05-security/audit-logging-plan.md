# Son güncelleme: 2026-07-17
# Durum: taslak v1

# Audit Logging Plan

## Purpose

This document defines what must be logged, in what format, where it is stored,
and how the log is protected against tampering.

The audit log is the primary evidence trail for all high-impact admin and
finance operations on the Hanuja platform. It supports regulatory review,
internal investigation, payout dispute resolution, and fraud analysis.

Source of truth for implementation: `packages/security/src/audit-logger.ts`
Schema model: `AdminAuditLog` in `db/schema/schema.prisma`

---

## Design Constraints

- **Append-only.** Audit log rows are never updated or deleted. The Prisma model
  has no `update` or `delete` operations exposed by the repository layer.
- **Server-side only.** No audit entry is accepted from client-supplied data.
  All entries are built server-side using `buildAuditEntry()` from
  `packages/security/src/audit-logger.ts`.
- **Synchronous write before response.** High-impact actions must persist the
  audit entry in the same database transaction as the state change. An action
  that succeeds but whose audit entry fails must be rolled back or retried —
  not silently dropped.
- **Masked sensitive values.** IBAN, card numbers, and other PII must be masked
  before being written to `previousData` / `newData` JSON columns. Use helpers
  from `packages/security/src/data-masker.ts`.

---

## AdminAuditLog Schema

```
model AdminAuditLog {
  id           String          @id @default(cuid())
  actorId      String          // Admin or seller user ID
  actionType   AdminActionType // Prisma enum — matches AuditAction type
  targetType   String          // e.g. 'Order' | 'Seller' | 'Payout' | 'Penalty'
  targetId     String          // CUID of the target record
  previousData Json?           // State before the action (masked)
  newData      Json?           // State after the action (masked)
  reason       String?         // Mandatory for high-impact actions
  note         String?         // Optional free-text note or evidence reference
  ipAddress    String?         // Originating request IP (masked if needed)
  createdAt    DateTime        @default(now())
}
```

Indexes: `actorId`, `(targetType, targetId)`, `(actionType, createdAt)`.
These support admin search by actor, by target entity, and by action type + date range.

---

## AuditEntry Field Specification

| Field | Required | Description |
|---|---|---|
| `actorId` | Always | ID of the user performing the action |
| `actorRole` | Always | Role at time of action: `admin`, `seller`, `support` |
| `action` | Always | Typed `AuditAction` string (see list below) |
| `targetEntityType` | Always | Capitalized entity name: `Order`, `Seller`, `Payout`, `Penalty`, `SellerBankDetail`, `SellerLedger` |
| `targetEntityId` | Always | CUID of the record being acted on |
| `previousState` | When state changes | JSON object — values masked, no raw secrets |
| `newState` | When state changes | JSON object — values masked, no raw secrets |
| `reason` | For high-impact actions | Human-readable reason string (min 5 chars) |
| `note` | Optional | Evidence note, external reference, or support ticket ID |
| `ipAddress` | Where available | Request IP address |
| `createdAt` | Always | Server timestamp set at build time |

---

## Mandatory Logged Events

### Payment actions

| Event | `actionType` | Reason required |
|---|---|---|
| EFT/havale approved by admin | `payment.eft_approved` | No (note holds evidence ref) |
| EFT/havale rejected by admin | `payment.eft_rejected` | Yes |
| Manual payment confirmation | `payment.manual_confirmed` | Yes |

### Payout actions

| Event | `actionType` | Reason required |
|---|---|---|
| Payout released to seller | `payout.released` | Recommended |
| Payout blocked by admin | `payout.blocked` | Yes |
| Payout hold manually released | `payout.hold_released` | Yes |

### Penalty actions

| Event | `actionType` | Reason required |
|---|---|---|
| Penalty applied to seller ledger | `penalty.applied` | Yes |
| Penalty waived by admin | `penalty.waived` | Yes |
| Penalty reversed by admin | `penalty.reversed` | Yes |

### Order actions

| Event | `actionType` | Reason required |
|---|---|---|
| Order cancelled by admin | `order.cancelled_admin` | Yes |
| Delivery confirmed manually by admin | `order.delivery_confirmed_manual` | Yes |
| Fulfillment window extended by admin | `order.fulfillment_extended` | Yes |

### Seller management actions

| Event | `actionType` | Reason required |
|---|---|---|
| Seller suspended | `seller.suspended` | Yes |
| Seller reactivated | `seller.reactivated` | Yes |
| Seller bank detail changed (seller-initiated) | `seller.bank_detail_changed` | No (IBAN masked) |
| Seller bank detail approved by admin | `seller.bank_detail_approved` | No |

### Return and dispute actions

| Event | `actionType` | Reason required |
|---|---|---|
| Return approved by admin | `return.approved` | No |
| Return rejected by admin | `return.rejected` | Yes |
| Dispute resolved by admin | `dispute.resolved` | Yes |
| Dispute opened | `dispute.opened` | No |

### Finance adjustment actions

| Event | `actionType` | Reason required |
|---|---|---|
| Manual ledger adjustment (credit or debit) | `finance.manual_adjustment` | Yes |

### Auth / security events

| Event | `actionType` | Reason required |
|---|---|---|
| Admin login | `auth.admin_login` | No |
| Forced logout / session revoked | `auth.forced_logout` | Yes |

### Catalog moderation

| Event | `actionType` | Reason required |
|---|---|---|
| Product moderated (approved/rejected) | `catalog.product_moderated` | Recommended |
| Product hidden | `catalog.product_hidden` | Yes |

---

## Convenience Builders

The following typed builder functions exist in `packages/security/src/audit-logger.ts`
and must be used instead of manually constructing entries:

- `buildAuditEntry(input)` — generic builder
- `auditPayoutReleased(opts)` — payout release
- `auditPenaltyWaived(opts)` — penalty waiver
- `auditEftApproved(opts)` — EFT approval
- `auditSellerSuspended(opts)` — seller suspension
- `auditBankDetailChanged(opts)` — IBAN change (always masked)
- `auditManualFinanceAdjustment(opts)` — ledger credit/debit

Do not pass raw IBAN or card numbers to any builder. Always use masking helpers first.

---

## Masking Rules

The following values must never appear unmasked in audit log JSON:

| Value type | Masking function |
|---|---|
| IBAN | `maskIban()` — shows last 4 digits only |
| Email | `maskEmail()` |
| Phone | `maskPhone()` |
| Card number | `maskCardNumber()` |
| Turkish ID | `maskTurkishId()` |

Apply masking before calling `buildAuditEntry()`.

---

## Retention Policy

- Audit log rows are retained indefinitely by default.
- No automated deletion job may target the `admin_audit_logs` table.
- If a legal hold or regulatory archive export is required, it is performed by
  the database backup and export tooling — not by modifying table rows.
- If future data minimisation policy requires trimming, a formal documented
  decision must be made and a new version of this file must be published.

---

## Tamper Resistance

The `admin_audit_logs` table must be protected at the database level:

- Application database user must not have `DELETE` or `UPDATE` privilege on
  `admin_audit_logs`.
- No Prisma repository method should expose `delete` or `update` on this model.
- Admin UI must never surface a delete or edit action for audit log rows.
- Waived penalties and reversed decisions must appear as additional new rows,
  not as edits to the original row.

---

## Access Control

- Only users with the `audit:view` permission may read the full audit log.
- In the current permission matrix (`packages/security/src/permission-matrix.ts`),
  only the `admin` role holds `audit:view`.
- The `support` role does not have `audit:view` and must not be given read
  access to raw audit log rows without explicit policy change.
- Audit log reads must themselves be server-side only — never exposed through
  an unguarded public API route.

---

## Implementation Checklist

For every new high-impact action added to the platform:

1. Add the `AuditAction` string to the type union in `audit-logger.ts`.
2. Add the corresponding `AdminActionType` enum value to `schema.prisma`.
3. Create a convenience builder function if the action is common.
4. Ensure the service that performs the action writes the audit entry in the
   same transaction as the state mutation.
5. Add a test asserting that the audit entry is created with the correct fields.

---

## Marketing Consent Trail (2026-07-17)

Campaign email (`product_discount_favorited` / `product_discount_in_cart`) is
consent-gated, distinct from the append-only admin audit log above but built on the
same traceability principle: every consent state must be attributable and timestamped,
never inferred.

- `MarketingConsent` (`db/schema/schema.prisma`) records `emailConsentAt` /
  `emailRevokedAt` and `smsConsentAt` / `smsRevokedAt` as explicit timestamp pairs, plus
  `consentSource` (e.g. `signup`, `hesabim`) so the origin of consent is always known —
  never a bare boolean flag with no history.
- Revocation is a new timestamp on the existing row (`emailRevokedAt`), not a delete —
  consistent with the append/traceability principle used for `AdminAuditLog` and
  `SellerLedgerEntry` elsewhere in this repository.
- Global opt-out is available without an authenticated session via a unique
  `optOutToken`, exposed through `/api/marketing/unsubscribe` (GET link + POST
  One-Click per RFC 8058) and rate-limited under the API rate limit tier.
- Campaign email sending is gated at the point of dispatch: `product_discount_*` mail is
  only sent to users with an active (non-revoked) `emailConsentAt`. This is a legal
  requirement (KVKK / Turkish Electronic Commerce Law no. 6563 — commercial electronic
  message consent), not just a UX preference, and must not be weakened to a soft
  best-effort filter.
- Store-follow discount notices (`store_discount_followed_seller`) remain governed by
  the separate, pre-existing per-follow opt-out — they are **not** gated by
  `MarketingConsent`. Do not conflate the two consent surfaces when reviewing or
  extending campaign email logic.
- The inbound Postmark reply-to-invoice (RET) flow can also revoke global marketing
  consent when a customer replies asking to stop. This trusts the `From` header of the
  inbound email, which is spoofable; the failure direction is fail-safe (consent can be
  revoked in error, never granted in error), so the residual risk is accepted as low but
  should be kept in mind in any future hardening pass.

Cross-reference: `docs/06-engineering/database-schema.md` (`MarketingConsent`,
`CampaignEmailDispatch` models), `docs/06-engineering/queue-jobs-plan.md`
§"campaign-discount", `.claude/rules/12-production-readiness.md` §18.

---

## Cross-Reference

- `.claude/rules/05-security-rules.md` — logging and audit rules
- `.claude/rules/10-admin-panel-rules.md` — auditability rules for admin actions
- `.claude/rules/07-marketplace-finance-rules.md` — manual adjustment logging
- `packages/security/src/audit-logger.ts` — implementation source of truth
- `packages/security/src/permission-matrix.ts` — `audit:view` permission
- `db/schema/schema.prisma` — `AdminAuditLog` model
- `docs/05-security/admin-action-policy.md` — per-action audit field requirements
