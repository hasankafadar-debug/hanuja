# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Payment Security

## Purpose

This document describes the security design for all payment-related flows in Hanuja. It covers Iyzico webhook signature verification, the payment confirmation flow, EFT/havale manual approval with audit logging, idempotency guards, the rule that payment state transitions are backend-only, and environment separation between sandbox and production.

Source of truth for rules: `.claude/rules/05-security-rules.md`, section 9.2 and 9.4 of `CLAUDE.md`.

---

## 1. Core Payment Security Principle

Hanuja collects all customer payments centrally. This makes payment integrity a first-class concern. The platform must never allow an order to become visible to a seller, or a payout to be computed, based on unverified payment state.

The non-negotiable rules are:

- Payment confirmation must come from a verified backend source, not from a client redirect or a frontend success state.
- The amount used for all financial calculations is computed server-side at order creation time. No client-supplied price is trusted.
- Card data is passed to Iyzico and never stored in the Hanuja database.
- Payment state transitions are triggered only by verified webhook callbacks or by admin actions with full audit logging.

---

## 2. Card Payment Flow (Iyzico 3DS)

### Step 1 — Payment initiation

`POST /api/payment/start` in `apps/web` is the entry point for card payments.

Before any Iyzico call is made, the handler enforces:

1. CSRF token verification (`checkCsrf(req)`)
2. Rate limit check (`SENSITIVE_RATE_LIMIT`)
3. Server-side session validation — unauthenticated requests are redirected to `/giris`
4. Zod schema validation of the request body

The `totalAmount` sent to Iyzico is taken from the order record written to the database by `checkoutSvc.createOrder()`, not from any client-supplied value. The client cannot influence the amount charged.

Card fields (`cardNumber`, `expireMonth`, `expireYear`, `cvc`) are forwarded directly to Iyzico and are not persisted anywhere in Hanuja's database or logs.

### Step 2 — 3DS page display

Iyzico returns an HTML page that the browser renders in-place (`text/html` response). The browser interacts with the bank's 3DS system. This is why the storefront middleware does not set `X-Frame-Options: DENY` — the 3DS flow requires iframe rendering from Iyzico's domain.

### Step 3 — Callback and confirmation

After 3DS completes, Iyzico posts to `/api/payment/callback`. This callback handler:

1. Verifies the Iyzico webhook signature using `verifyIyzicoWebhook` from `packages/security/src/webhook-verifier.ts`
2. Checks for duplicate processing using `isDuplicateWebhook` (idempotency guard)
3. Validates that the `conversationId` matches a real pending order in the database
4. Calls `paymentService.confirmCardPayment()` inside a database transaction

The frontend redirect that Iyzico may send to the browser after 3DS is used only for UX navigation. It is never the trigger for payment confirmation. Payment confirmation happens only through the server-to-server callback.

---

## 3. Webhook Signature Verification

`packages/security/src/webhook-verifier.ts` exports:

- `verifyIyzicoWebhook(payload, signature, secret)` — verifies the HMAC-SHA256 signature that Iyzico attaches to every callback. The secret is read from the environment variable `IYZICO_SECRET_KEY`. If verification fails, the request is rejected with 400 before any order state is touched.
- `isDuplicateWebhook(conversationId, store)` — checks whether a webhook with this conversation ID has already been processed. Safe for use with a Redis set or an in-memory store in test environments.
- `isWebhookTimestampFresh(timestamp, maxAgeSeconds)` — rejects replayed webhooks with stale timestamps.

These three checks must all pass before `confirmCardPayment` is called. If any check fails, the response is an error and the order state is unchanged.

---

## 4. Idempotency Guards

Card payment confirmation is designed to be safe when called more than once with the same provider reference.

In `payment.service.ts`, `confirmCardPayment` begins with:

```typescript
if (payment.status === 'confirmed') return payment
```

If the payment record is already confirmed, the function returns the existing record without executing the transaction or appending a duplicate status history entry. This means a retried webhook or a rare duplicate delivery from Iyzico will not create duplicate ledger entries, duplicate seller notifications, or duplicate status history rows.

The idempotency key is the `providerRef` (Iyzico's payment reference). The same `providerRef` cannot confirm the same payment twice from a different code path because the status check happens inside a database transaction.

---

## 5. EFT / Havale Manual Approval

Bank transfer payments follow a different flow and require explicit admin action before the order becomes visible to the seller.

### EFT flow

1. Customer selects EFT at checkout. The order is created with status `bank_transfer_waiting` and payment method `eft`.
2. The order is not visible to the seller at this point.
3. Admin sees all pending EFT orders in `GET /api/admin/payments/eft/pending`.
4. Admin reviews the bank transfer evidence and takes one of two actions:

**Approve:** `POST /api/admin/payments/eft/:orderId/approve`
- Requires: `adminActorId` resolved from the admin's server-side session (never from the request body)
- Accepts: optional `evidenceNote`, optional `discountAmount` (paise, integer), optional `discountReason`
- Calls `paymentService.approveEftPayment()` inside a database transaction
- Creates an `AdminAuditLog` entry via `auditEftApproved()` with actor, timestamp, order ID, evidence note, and discount reasoning if any
- Updates order status to `bank_transfer_confirmed` then `payment_confirmed`
- Makes order visible to seller

**Reject:** `POST /api/admin/payments/eft/:orderId/reject`
- Requires a `reason` string of at least 5 characters
- Creates an audit log entry recording the actor and reason
- Updates order status to `cancelled_due_to_payment_failure`
- Does not transition into seller flow

### Audit log requirement

Every EFT approval or rejection must produce an `AdminAuditLog` record. The record must contain:

- `actorId` — admin user ID
- `action` — `eft_approved` or `eft_rejected`
- `targetEntityId` — order ID
- `previousState` — `bank_transfer_waiting`
- `newState` — result status
- `reason` — evidence note or rejection reason
- `createdAt` — timestamp

This record cannot be deleted or overwritten. It exists for reconciliation and legal audit purposes.

---

## 6. Payment State Transitions Are Backend-Only

The following state transitions are triggered only by verified server-side events:

| Transition | Trigger |
|------------|---------|
| `payment_pending` → `payment_confirmed` | Iyzico webhook with verified signature |
| `bank_transfer_waiting` → `bank_transfer_confirmed` → `payment_confirmed` | Admin action with audit log |
| `payment_pending` → `payment_failed` | Iyzico webhook with verified failure status |
| `payment_confirmed` → `seller_queue_ready` | Automatic, inside the same transaction as payment confirmation |

No route handler accepts a client-supplied `status` or `paymentStatus` field that is applied directly to the order or payment record. Status transitions are driven by the state machine in `api/domain/order-state-machine.ts` which calls `assertTransition(currentStatus, targetStatus)` before allowing any change.

---

## 7. Amount Calculation — Server Authority

The `totalAmount` for a payment is calculated at `checkoutSvc.createOrder()` time using:

- cart line items and quantities from the database
- server-side price lookup for each product
- server-side coupon validation and discount application
- server-side shipping calculation

The resulting amount is written to the `Order` record. This is the only amount sent to Iyzico. The handler at `/api/payment/start` reads `order.totalAmount.toFixed(2)` from the freshly created order — it does not read any amount from the request body.

Client-supplied amounts are rejected. Any attempt to tamper with the amount in the checkout form has no effect on what is sent to the payment provider.

---

## 8. Card Data Handling

Card data submitted in the payment form:
- Is validated by Zod schema on the server (format only)
- Is forwarded to Iyzico via the `initiate3DS` adapter function
- Is never written to any Hanuja database table, log file, or audit entry
- Is never echoed back in any API response

The Iyzico SDK or HTTP adapter is the only code path that sees the raw card number. After the Iyzico call returns, card data goes out of scope.

---

## 9. Environment Separation — Sandbox vs Production

Iyzico provides separate sandbox and production API endpoints and credentials.

| Environment | `IYZICO_BASE_URL` | Credential set |
|-------------|------------------|----------------|
| Local / development | `https://sandbox-api.iyzipay.com` | Sandbox API key and secret |
| Staging | `https://sandbox-api.iyzipay.com` | Sandbox API key and secret |
| Production | `https://api.iyzipay.com` | Production API key and secret |

Rules:

- Sandbox credentials must never be committed to source control. They go in `.env.local` for development.
- Production credentials are set only in the production deployment environment (Coolify).
- The application reads `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, and `IYZICO_BASE_URL` from environment variables. The `initiate3DS` adapter and webhook verifier use these variables and have no hardcoded credentials.
- If `NODE_ENV !== 'production'` and `IYZICO_BASE_URL` points to the production endpoint, the application should log a warning at startup. This guard prevents accidental real charges during local development.
- Webhook signature verification uses `IYZICO_SECRET_KEY`. The key must be rotated immediately if it is suspected to have been exposed. After rotation the new key must be deployed to production before the old key is decommissioned to avoid missed webhooks.

---

## 10. What Must Never Happen

- An order must never reach `payment_confirmed` status based on a client-side redirect success state alone.
- A seller must never see an order with status `bank_transfer_waiting` or `payment_pending` as an actionable fulfillment order.
- Card data must never appear in logs, database records, or API responses.
- The payment amount must never come from the client request body.
- A webhook must never be processed without signature verification.
- An EFT approval must never happen without an audit log entry.
- A duplicate webhook must never produce a duplicate payment confirmation event.

---

## Cross-Reference

- `.claude/rules/05-security-rules.md` — authoritative security policy, sections on payment and payout security
- `docs/05-security/security-architecture.md` — defense layers overview
- `docs/05-security/audit-logging-plan.md` — audit log entry structure
- `docs/07-operations/order-lifecycle.md` — order status transitions and EFT flow in operations context
- `apps/web/src/app/api/payment/start/route.ts` — card payment initiation handler
- `api/routes/payments.ts` — EFT approval/rejection route handlers
- `api/services/payment.service.ts` — payment confirmation service with idempotency
- `packages/security/src/webhook-verifier.ts` — signature verification and duplicate guard
