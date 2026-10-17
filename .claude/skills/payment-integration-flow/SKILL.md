---
name: payment-integration-flow
description: Apply Hanuja Iyzico payment integration rules. Use when implementing card payment, 3D Secure, EFT/havale approval, webhook handling, refund API, or any payment provider interaction.
user-invocable: false
paths:
  - "api/services/payment*"
  - "api/routes/payment*"
  - "api/routes/webhook*"
  - "api/jobs/payment*"
  - "api/repositories/payment*"
model: sonnet
effort: high
version: 1.0.0
last-updated: 2026-09-12
---

This skill defines Hanuja payment integration discipline.

Main principle:
Payment truth comes only from the provider (Iyzico) via verified backend callback — never from frontend redirect parameters.

Iyzico integration rules:
1. Use Iyzico REST API — initialize payment, handle 3D Secure callback, verify result
2. Never trust GET/POST params from payment redirect page as proof of payment
3. Payment confirmation must come from server-side status query or signed webhook
4. Store conversationId / payment token for idempotency checks
5. Iyzico sandbox credentials for dev/staging — never use live credentials locally

3D Secure flow:
1. Create Iyzico payment initialization request (server-side)
2. Return redirect URL to frontend
3. Customer completes 3D Secure on Iyzico page
4. Iyzico posts callback to our backend webhook endpoint
5. Verify payment status via Iyzico API (don't trust raw POST params alone)
6. Update Payment record with confirmed status
7. Trigger order confirmation service

EFT / Havale flow:
1. Customer selects bank transfer option
2. Platform bank account details shown to customer
3. Customer reference number generated and shown
4. Admin receives transfer notification
5. Admin reviews evidence in admin panel
6. Admin approves → payment confirmed → order enters seller queue
7. Admin rejects → order stays blocked, customer notified

Webhook rules:
- Verify Iyzico webhook signature on every request
- Implement idempotency: check if payment event already processed (by conversationId)
- Return 200 immediately to avoid retry storms
- Process asynchronously via BullMQ queue if needed
- Log every incoming webhook with full payload (masked sensitive data)
- Handle: payment success, payment failure, refund completed, chargeback

Confirm-time binding invariants (card payment, `api/services/card-payment.service.ts`):
- The provider response must match the attempt's immutable values: `price` (cash total), `paidPrice`
  (installment total from the quote), installment count, `basketId` (order id), currency, item ids/prices;
  per-item `paidPrice` values must add up to `paidPrice` to the cent
- One iyzico `paymentId` confirms at most one order and must equal the `paymentId` stored at initialise;
  a returned `conversationId` alone is not proof of ownership
- 3DS success needs `status=success` + `mdStatus=1` and a signed v2 auth (or signed payment query) response
- `fraudStatus` 1 or 2 confirms; 0 holds the order (`fraud_review`); -1 after review is refunded by iyzico
- Money captured but not attachable to the order (late, duplicate, mismatched) goes to `CardAttemptReversal`
- Network errors and unverifiable signatures are `unknown`, never "no money moved"; reconcile, never retry blindly
- Installment difference (paidPrice − price) is paid by the customer and never reaches seller payout

Refund API rules:
- Refund must be triggered by platform business logic, not by seller directly
- Record refund intent in DB before calling Iyzico refund API
- Handle partial refunds (refundable line items, not always full order)
- Store Iyzico refund response and map to internal refund status
- Update SellerLedgerEntry for refund impact

Payment record must capture:
- provider (iyzico)
- provider_payment_id
- provider_conversation_id
- amount
- currency
- status (PENDING, CONFIRMED, FAILED, REFUNDED, CHARGEBACKED)
- method (CARD, EFT)
- confirmed_at
- raw_response (masked)
- PaymentEvent history (append-only)

When implementing payment logic:
- identify the payment method (card / EFT)
- design the server-side verification step first
- never skip signature/status verification
- add idempotency check for webhook/callback
- test failure paths (declined, timeout, chargeback)
- test duplicate callback safety

Never accept:
- trusting frontend "payment success" param without verification
- EFT approval outside the admin panel audit flow
- webhook processing without signature verification
- payment confirmation before provider confirmation
- refund without internal refund record creation
- float for money amounts
