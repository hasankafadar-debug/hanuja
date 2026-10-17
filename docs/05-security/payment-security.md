# Son güncelleme: 2026-10-17
# Durum: taslak v2 — iyzico standart sanal POS, 3D Secure, taksit (kart satışı bayrakla kapalı)

# Payment Security

## Durum (2026-10-16)

Kart ödemesi iyzico **standart sanal POS** (pazaryeri değil) üzerinden, **3D Secure** ile ve **kendi
`/odeme` formumuzla** çalışır; taksitte **vade farkını müşteri öder**. Kart satışı yalnız web servisinde
`IYZICO_CARD_PAYMENTS_ENABLED=true` ile açılır; eski `CARD_PAYMENTS_ENABLED` açmaz. Bayrak yalnız **yeni ödeme
başlatmayı** (`/api/payment/quote`, `/api/payment/start`) kapatır: başlamış ödemelerin callback'i ve iyzico
webhook'u bayrak kapalıyken de işlenir.

Canlıya geçiş şartları (bayrak bunlar olmadan açılmaz):

1. iyzico'nun PCI DSS şartı (SAQ türü) yazılı netleşti ve karşılandı — kart numarası/CVC sunucumuzdan geçer;
   3D Secure bu sorumluluğu kaldırmaz.
2. X-IYZ-SIGNATURE-V3 webhook'u hesapta aktif ve canlıda imzalı bildirim doğrulandı.
3. Taksit oranları iyzico panelinde ("Taksit ve Komisyon Yönetimi") müşteriye yansıyacak şekilde tanımlı;
   canlıda bir taksitli ödeme uçtan uca doğrulandı (sandbox'ta 2026-10-17'de doğrulandı, aşağıya bakın).
4. Mali müşavir vade farkının müşteri faturasındaki (Uyumsoft) gösterimini onayladı.

### Sandbox uçtan uca test (2026-10-17)

Yerelde iyzico sandbox anahtarları ve gerçek 3D Secure test sayfasıyla doğrulandı: taksit sorgusu (bireysel
kartlarda 1/2/3/6/9/12, ticari kartlarda — `commercial: true` — iyzico yalnız tek çekim döndürür), 3 taksitli
tahsilat ve onay (müşteri 777,76 TL; tasarımcı hakedişi peşin tutarda), aynı siparişe yeniden ödeme, siparişe
bağlanamayan tahsilatın geri ödenmesi, kısmi iptalde vade farkı payının oransal kart iadesi, başarısız 3D dönüşü
ve süre dolumunda stok iadesi. Bu testte bulunan ve düzeltilen dört hata:

- iyzico taksitte kalem `paidPrice` değerlerini 8 ondalıkla döndürür (ör. 673.56752371 + 104.19247632 = 777.76);
  birebir eşitlik bekleyen kontrol tahsilatı reddediyordu → kuruşa yuvarlama (Adım 4).
- Açıklama gönderilen iptal isteğinde iyzico `reason` alanını zorunlu tutar → iptal isteği `reason` gönderir (§4).
- Başarısız 3D dönüşünde iyzico `paymentId` göndermez → imzası geçerli başarısızlık bildirimi kabul edilir (Adım 3).
- Sipariş sayfasından açılan yeniden ödeme ekranında sözleşme önizlemesi yüklenmiyordu → önizleme teklifle yüklenir.

iyzico callback'te `signature` alanını gönderir ve imza `IYZICO_SECRET_KEY` ile doğrulanır (her dönüş
`card_callback_received` olayına imza durumuyla yazılır). Webhook (V3), fraud incelemesi ve mobil tarayıcılarda
3D sayfası sandbox'ta denenmedi.

## Purpose

This document describes the security design for all payment-related flows in Hanuja: the card flow (quote,
3D Secure start, callback, v2 auth, confirmation), iyzico response and webhook signature verification,
reconciliation of uncertain outcomes, EFT/havale manual approval with audit logging, idempotency guards, and
environment separation between sandbox and production.

Source of truth for rules: `.claude/rules/05-security-rules.md`, sections 9.2 and 9.4 of `CLAUDE.md`.

---

## 1. Core Payment Security Principle

Hanuja collects all customer payments centrally. The platform must never allow an order to become visible to a
seller, or a payout to be computed, based on unverified payment state.

- Payment confirmation comes only from a verified backend source: the signed iyzico v2 auth response, a signed
  payment query, or an admin action with audit log. Never from a browser redirect or a callback field alone.
- Every amount is computed server-side. The customer chooses only the **number** of installments.
- Card data is forwarded to iyzico in a single request and never stored, logged or returned.
- Network errors, timeouts and responses whose signature cannot be verified are never treated as "no money moved".

---

## 2. Card Payment Flow (iyzico 3D Secure)

Code: `api/services/card-payment.service.ts` (business logic), `api/lib/iyzico.ts` (adapter),
`api/routes/card-payments.ts` (thin handlers), `apps/web/src/app/api/payment/*` and
`apps/web/src/app/api/webhooks/iyzico/route.ts`.

### Step 1 — Quote (`POST /api/payment/quote`)

When the first 8 digits of the card number are entered, the server builds a quote:

- `price` = the order's cash total (`buildCheckoutDraft`, or `Order.totalAmount` when retrying an unpaid order).
- iyzico `installmentInfo(BIN, price)` returns the installment options with their `totalPrice`
  (merchant panel rates). Offers shown = iyzico offers ∩ the basket's category limit
  (`Category.maxInstallmentCount`, inherited from parents, minimum across the basket); debit cards get single
  payment only; a BIN that iyzico does not recognise gets single payment at the cash price.
- A single payment whose `totalPrice ≠ price` produces no quote (the contract does not allow an installment
  difference without installments).
- The chosen option is stored as `CardPaymentQuote` (15 min) together with the contract context; the contract
  preview (`/api/checkout/contracts-preview?quoteId=`) is rendered from this quote.

### Step 2 — Start (`POST /api/payment/start`)

Order of checks: card flag → CSRF → IP and per-user rate limits → session and verified e-mail → Zod → Turnstile.
Then `startAttempt`:

1. `startKey` (one per "pay" intent, unchanged on network retries) is unique: a repeated request returns the
   existing attempt and never starts a second 3D Secure.
2. The quote must belong to the user, be unexpired and unconsumed, and match the current contract versions; the
   card BIN must equal the quote BIN.
3. Installment rates are queried again; if the total differs from the quote, nothing starts and the customer
   confirms the new total (`CARD_QUOTE_CHANGED`). On the first attempt the cart hash must still match
   (`CARD_CART_CHANGED`).
4. Billing identity: individual Turkish citizens only (TCKN from the billing address, or the form). Corporate and
   foreign-national billing profiles are refused until iyzico confirms the accepted `identityNumber` value.
5. Under the **quote row lock** (first attempt) or the **order row lock** (retry): the order is created in the same
   transaction (`checkoutSvc.writeOrderRecords`, `cardPaymentExpiresAt = +30 min`), or on retry older attempts that
   never reached auth are expired. Max 5 attempts per order; an attempt in `authorizing / outcome_unknown /
   fraud_review` blocks a new one.
6. The attempt stores the contract HTML/hash and acceptance evidence, then 3D Secure is initialised **outside**
   the transaction. The initialise response signature (`paymentId:conversationId`) is verified and its `paymentId`
   is stored on the attempt immediately.

### Step 3 — Callback (`POST /api/payment/callback`)

No callback field is proof of payment on its own:

1. The attempt is found by `conversationId`; the posted `paymentId` must equal the stored one. Exception: a
   failure callback (`status ≠ success`) carries no `paymentId` (sandbox, 2026-10-17) and is accepted only when its
   signature verifies. A success callback without a matching `paymentId` is always rejected.
2. If iyzico sends `signature` (it does, sandbox 2026-10-17), it must verify
   (`conversationData:conversationId:mdStatus:paymentId:status`; a missing `paymentId` is an empty part). Every
   accepted callback is recorded as `card_callback_received` with the signature state.
3. Success requires `status=success` **and** `mdStatus=1`; otherwise the attempt fails and the order stays payable.
4. Under the order lock the attempt moves `threeds_pending → authorizing`; an expired attempt or an order whose
   window passed never calls auth.
5. v2 auth (`/payment/v2/3dsecure/auth`) binds `paymentId, conversationId, paidPrice, basketId, currency`; the
   response signature (`paymentId:currency:basketId:conversationId:paidPrice:price`) must verify.
6. Redirects are **303** (SameSite=Lax session cookie is sent on the following GET). Error codes, not messages,
   travel in the URL.

### Step 4 — Confirmation

`processCapturedPayment` compares the provider response with the attempt's **immutable** values (`price`,
`paidPrice`, installment, `basketId`, currency, `mdStatus`, item ids and per-item prices). Then, under the order lock:

- same attempt already confirmed → no effect;
- order confirmed by another attempt → `duplicate_capture` → attempt reversal;
- order no longer payable → `late_capture` → attempt reversal;
- otherwise confirm: `Order.totalAmount = paidPrice`, installment fields, per-line customer amounts
  (`customerPaidProductAmount = item paidPrice`), `Order.customerPaidShippingAmount`,
  `PaymentProviderItem.amount = item paidPrice`, `Payment.amount = paidPrice`, the accepted contract becomes the
  `OrderLegalSnapshot`, seller accruals (from `OrderLine` only) and the "Siparişiniz Alındı" notification.

Item amounts: in installments iyzico returns each item's `paidPrice` with up to 8 decimals (e.g. `673.56752371`).
`roundCapturedPaidPrices` (`api/domain/card-installments.ts`) floors each to kuruş and gives the missing kuruş to
the items with the largest remainders, so the stored item amounts add up to `paidPrice` exactly. A raw sum that is
off by one kuruş or more makes the capture unusable (`item_paid_sum_mismatch` → attempt reversal). The raw values
stay in `CardPaymentAttempt.itemTransactions`. iyzico accepted the rounded item amount (673.57 against 673.5675…)
as the refund cap in sandbox.

Fraud: `fraudStatus` **1** or **2** (approved after review) confirms. **0** keeps the order in `payment_pending`
(no seller visibility, no accrual) and is polled. **-1** after review is refunded by iyzico itself; Hanuja does not
send a second refund. iyzico's fraud push notification is unsigned and is not used.

Only the purchased products are removed from the cart; items added while paying stay.

---

## 3. Signatures

All iyzico signatures are HMAC-SHA256 with `IYZICO_SECRET_KEY`, hex, compared in constant time. Prices in the
signature input drop trailing zeros (`10.50 → 10.5`, `10.0 → 10`). Parts are joined with `:`.

| Response | Fields |
|---|---|
| 3DS initialize | `paymentId:conversationId` |
| 3DS callback | `conversationData:conversationId:mdStatus:paymentId:status` |
| v2 auth, payment detail | `paymentId:currency:basketId:conversationId:paidPrice:price` |
| refund | `paymentId:price:currency:conversationId` |

**Webhook** (`X-IYZ-SIGNATURE-V3`): HMAC-SHA256(secretKey, `secretKey + iyziEventType + paymentId +
paymentConversationId + status`), hex. There is no development bypass: without the secret every webhook is
rejected. The old SHA1 `X-IYZ-SIGNATURE` verifier and `IYZICO_WEBHOOK_SECRET` were removed.
`packages/security/src/webhook-verifier.ts` (`verifyIyzicoWebhook`) is unused legacy code and must not be used.

The webhook route verifies the signature, **stores** the event (`IyzicoWebhookEvent`, unique
`iyziReferenceCode`), then returns 2xx. If the store fails it returns 5xx so iyzico retries; a duplicate reference
returns 2xx. Processing is a worker job that only triggers a signed payment query; a periodic sweep re-queues
unprocessed events.

---

## 4. Idempotency and Uncertain Outcomes

- Request level: `startKey` (unique) and single-use quotes; one order per quote.
- State moves only forward. `succeeded / voided / refunded` attempts are never set back by a late `FAILURE`.
- Money moves only at v2 auth. Attempts that never reached auth (`initialized`, `threeds_pending`) are closed
  locally when the window ends. Only `authorizing` / `outcome_unknown` waits for reconciliation.
- Network calls run **outside** database transactions: lock → check → write the intermediate state
  (`authorizing`, reversal `processing`) → commit → call iyzico → record the result in a new transaction.
- `card-payment` worker (every 5 min): expires unpaid orders whose window passed (status `payment_cancelled`,
  stock and coupon usage returned, once), reconciles `authorizing / outcome_unknown / fraud_review` attempts with
  the signed payment query, processes attempt reversals and unprocessed webhook events, and sweeps card refunds.
- Attempt reversals (`CardAttemptReversal`, one per attempt): same-day `cancel`, otherwise item refunds. A
  rejected cancel falls back to item refunds. The cancel request sends iyzico's `reason` (`double_payment` for a
  duplicate capture, otherwise `other`) with our reason code as `description`; iyzico rejects a description
  without `reason`. `uncertain` is never retried blindly; the reporting service (`/v2/reporting/payment/details`, matched by our
  `conversationId`) decides. Order refunds use the same rule: uncertain card refund items are reconciled from the
  report (`refund-item-<id>`), and reopened for retry only after an hour without a trace.

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
- Accepts: optional `evidenceNote`, optional `discountAmount` (kuruş, non-negative integer), optional `discountReason`
- Input cap: `discountAmount` may not exceed what the customer pays for products (shipping is never discounted)
- `Payment.amount` and `Order.totalAmount` are set to the collected amount (pre-discount total − discount)
- Calls `paymentService.approveEftPayment()` inside a database transaction
- Creates an `AdminAuditLog` entry with action type `payment_approved`, actor, timestamp, order ID, evidence note,
  and discount information (amount and reason) if any. The audit log also records the per-line discount share breakdown
  for reconciliation
- Stores discount in `Payment.eftDiscountAmount` and reason in `Payment.eftDiscountReason`
- Discount is absorbed by Hanuja and does NOT reduce `Payout.grossAmount`, `Payout.netAmount`, or seller ledger accrual
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

| Transition | Trigger |
|------------|---------|
| `payment_pending` → `payment_confirmed` → `seller_queue_ready` | Signed v2 auth or signed payment query, fraud 1/2, inside one transaction |
| `payment_pending` → `payment_cancelled` | `card-payment` worker after the 30-minute window, only when no attempt may have captured money |
| `bank_transfer_waiting` → `bank_transfer_confirmed` → `payment_confirmed` | Admin action with audit log |
| `bank_transfer_waiting` → `cancelled_due_to_payment_failure` | Admin EFT rejection |

No route handler accepts a client-supplied `status` or amount. Transitions go through `assertTransition` in
`api/domain/order-state-machine.ts`. Card attempt statuses are listed in
`docs/06-engineering/event-status-model.md`.

---

## 7. Amount Calculation — Server Authority

```
price      = Order.totalAmount before payment (products + shipping − coupons)
paidPrice  = quote total from iyzico installmentInfo (installment difference included)
difference = paidPrice − price   → paid by the customer; not seller revenue
```

### Confirm-time binding (fail-closed)

1. The provider response must match the attempt's immutable `price`, `paidPrice`, installment, `basketId` and
   currency; item ids and per-item prices must match the basket; per-item `paidPrice` values must add up to
   `paidPrice` to the cent. A mismatch after capture never leaves money unexplained: the attempt gets a reversal.
2. One iyzico `paymentId` confirms at most one order (`Payment.providerPaymentId` and
   `CardPaymentAttempt.providerPaymentId` are unique) and must equal the `paymentId` stored at initialise.
3. A returned `conversationId` alone is never proof of ownership.

### Installment difference

- After confirmation `Order.totalAmount`, `Payment.amount` and `installmentTotalAmount` equal `paidPrice`;
  `installmentDifferenceAmount = paidPrice − price`.
- Seller payout, accrual, commission and the seller's invoice to Hanuja read `OrderLine` seller fields only
  (`totalPrice`, coupon, commission) and are unchanged.
- Refunds: product refunds use `customerPaidProductAmount` (installment share included); shipping refunds use
  `Order.customerPaidShippingAmount ?? shippingAmount`. The refunded installment share stays with Hanuja via
  `platformFundedAmount`.
- iyzico commission (`iyziCommissionFee`, `iyziCommissionRateAmount`) and `merchantPayoutAmount` are stored per
  attempt so "collected from the customer", "provider deduction" and "net to Hanuja" stay separate.

---

## 8. Card Data Handling

- Card fields exist only in the body of `POST /api/payment/start` and the single `initiate3DS` request.
- Never written to a table, log, audit entry, queue payload or error response. `handleCardPaymentError` logs only
  the error name and a message with 12–19 digit sequences masked; it never logs the request.
- Only the BIN (first 8) and last 4 digits, card family/bank and type are stored (from iyzico's response).
- The browser never stores card data (no localStorage, no URL); the CVC field is cleared after an error.
- The 3DS HTML is written into the page with `document.write`; this must be verified on iOS Safari and Android
  Chrome before go-live.

---

## 9. Environment Separation — Sandbox vs Production

| Environment | `IYZICO_BASE_URL` | Credential set |
|-------------|------------------|----------------|
| Local / development | `https://sandbox-api.iyzipay.com` | Sandbox API key and secret |
| Staging | `https://sandbox-api.iyzipay.com` | Sandbox API key and secret |
| Production | `https://api.iyzipay.com` | Production API key and secret |

- `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` are needed by **web** (quote, 3DS, callback, webhook)
  and **worker** (reconciliation, refunds). `IYZICO_CARD_PAYMENTS_ENABLED` belongs to web only.
- `tools/scripts/check-env.ts`: production requires `https://api.iyzipay.com` and rejects `sandbox-` keys; outside
  production the live URL is reported as a warning.
- Production keys are entered only in Coolify by the business owner; never in chat, repository or docs.

---

## 10. What Must Never Happen

- An order reaches `payment_confirmed` from a browser redirect or a callback field alone.
- A seller sees an order in `payment_pending` or `bank_transfer_waiting`.
- Card data appears in logs, database records, queue payloads or API responses.
- An amount comes from the client request body.
- A webhook is processed without signature verification, or acknowledged with 2xx before it is stored.
- An uncertain capture or refund is treated as "nothing happened", or retried without a report check.
- An EFT approval happens without an audit log entry.

---

## Cross-Reference

- `.claude/rules/05-security-rules.md` — authoritative security policy
- `.claude/rules/07-marketplace-finance-rules.md` — installment difference and confirm-time binding
- `docs/06-engineering/integrations.md` — iyzico integration contract
- `docs/06-engineering/event-status-model.md` — card attempt statuses
- `docs/06-engineering/queue-jobs-plan.md` — `card-payment` queue
- `docs/07-operations/reconciliation-process.md` — card reconciliation
- `api/services/card-payment.service.ts`, `api/lib/iyzico.ts`, `api/routes/card-payments.ts`
- `tests/postgres/card-payment-flow.test.ts`, `tests/security/iyzico-signature.test.ts`
