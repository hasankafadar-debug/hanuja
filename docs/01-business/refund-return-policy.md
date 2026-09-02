# Son güncelleme: 2026-09-02
# Durum: taslak v1

# Refund and Return Policy

## Purpose

This document defines the return and refund rules for the Hanuja marketplace.

It is the source of truth for the 14-day withdrawal window, the after-14-day evaluation
process, how returns interact with seller payout (before and after payment), how partial
refunds work, and the distinction between a return and a dispute.

Implementation in `api/services/`, `api/domain/`, and `db/schema/schema.prisma` must align
with this document. The `ReturnRequest`, `Dispute`, `Payout`, and `SellerLedgerEntry` models
reflect these rules.

---

## 1. Why Returns Are Finance-Critical

Hanuja uses a central collection model. All customer payments are collected by Hanuja.
The seller does not collect money directly and is paid later through a payout process.

This means a return or refund is not simply a customer-facing cancellation. It is a
financial event that:

- may reduce or block a seller payout that has not yet been released
- may create a seller ledger debt if payout has already been sent
- must be reconcilable between the order, payment, and payout records
- must remain visible in admin finance tools and seller finance summaries

Return flows must never be treated as informal customer service decisions. They have direct
and auditable financial consequences.

---

## 2. Return vs Dispute

These are separate flows with different meaning. Do not merge them.

### Return Request

A return request is initiated by the customer who received the product but wants to send
it back and receive a refund.

Typical reasons:

- customer changed their mind (withdrawal right)
- product does not match description
- product arrived damaged
- wrong item received

A return follows a structured approval and logistics flow before refund is finalized.

### Dispute

A dispute is a broader challenge to the order outcome. It may involve:

- delivery conflict (seller claims delivered, customer denies it)
- incomplete or wrong item with seller-customer disagreement
- fraud suspicion
- situation where the customer is not simply returning a product but contesting
  the validity of the transaction or fulfillment

When a dispute is open, `Dispute.payoutBlocked = true` and payout cannot be released until
the dispute is explicitly resolved by admin.

Both return requests and disputes block payout while open. The resolution path differs.

---

## 3. The 14-Day Withdrawal Window

Turkish consumer law provides customers with a right of withdrawal within 14 days of
receiving the product, without needing to provide a justification.

Hanuja treats a return request submitted within this window as a **standard fast-path return**.

The `ReturnRequest.isWithinWindow` field records whether the request fell within this window
at the time of submission. This is determined at request creation time based on:

```
isWithinWindow = (request submitted at) <= (deliveredAt + 14 days)
```

### Fast-path behavior within 14 days

When `isWithinWindow = true`:

- the return request enters review state
- admin may approve without detailed evaluation in standard cases
- once approved, the return-in-transit and item-received steps proceed
- refund is finalized after item is received and verified
- payout is blocked while the return is open

Fast-path does not mean automatic. Admin still confirms receipt and processes the refund.
It means the customer's legal right is not contested unless there is a documented
exception reason.

---

## 4. After-14-Day Return Requests

Return requests submitted after 14 days from delivery are not assumed to be automatically
approved.

`ReturnRequest.isWithinWindow = false` for these cases.

### Evaluation required

After-14-day returns require admin evaluation based on:

- the specific reason provided by the customer
- whether the seller accepts or contests the return
- whether the product qualifies for return under platform policy
- whether there is evidence of a manufacturing defect, damage in transit, or seller fault

Admin must make an explicit `return_approved` or `return_rejected` decision. There is no
automatic approval path for after-14-day returns.

### Seller involvement

For after-14-day returns, the seller may submit a response or evidence through the seller
panel. Admin weighs both sides before deciding.

---

## 5. Return Lifecycle

Regardless of window timing, a return that enters review follows this lifecycle:

| Status | Meaning |
|---|---|
| `requested` | Customer submitted the return request |
| `under_review` | Admin or seller is evaluating |
| `approved` | Return approved, customer may ship the item back |
| `rejected` | Return rejected, payout proceeds normally |
| `in_transit` | Customer has shipped the item back |
| `received` | Seller or platform has received the returned item |
| `refund_completed` | Refund has been finalized and released to customer |

These map directly to `ReturnRequestStatus` in the schema.

While the return is in any status from `requested` through `received`, payout for the
affected order must remain blocked.

Only when status reaches `refund_completed` or `rejected` is the payout block eligible
to be lifted. Admin must confirm this explicitly.

---

## 6. Finance Effect: Return Before Seller Payout

If a return or refund is finalized **before** the seller's payout has been released:

- the refund amount is deducted from the seller's pending payout
- the `Payout.refundAmount` field is updated
- the `Payout.netAmount` is recalculated
- a `SellerLedgerEntry` of type `refund` is written with a negative amount
- the seller does not receive payout for the refunded amount
- admin finance screens show why the payout was reduced

This is the normal and expected path. Most returns happen during the 30-day hold period,
so payout has not yet been released when the return is resolved.

---

## 7. Finance Effect: Return After Seller Payout

If a valid return or refund is finalized **after** the seller's payout has already been
released (`Payout.status = payout_paid`):

- the refund amount creates a seller ledger debt
- a `SellerLedgerEntry` of type `refund` is written with a negative amount
- the seller's balance becomes negative if there are no other funds to offset against
- future payouts automatically apply this outstanding negative balance as an offset
- admin panel shows the negative balance as a risk and operational indicator

If the seller's negative balance is large and cannot be recovered through normal future
payouts within a reasonable window, admin may initiate a separate recovery workflow.

The seller panel must show the negative balance and its source clearly. Sellers must not
be surprised by a payout reduction without a visible explanation.

---

## 8. Partial Refunds

The platform supports partial refunds. Not every return results in a full-order refund.

Partial refund scenarios include:

- only some items in a multi-line order are returned
- only part of a product's value is refunded due to condition assessment
- shipping cost is partially or fully retained per platform policy
- a coupon or discount was applied and the refund reflects the net amount paid

The `ReturnRequest.refundAmount` field records the specific amount to be refunded.

Partial refund handling must:

- update only the portion of the payout that corresponds to the refunded amount
- write a ledger entry for exactly the refunded amount
- not blindly block the entire order's payout if only part of the order is being returned

---

## 9. Refund Visibility Requirements

Refund-related adjustments must be visible in:

- admin finance screens (per order, per seller, per payout)
- seller finance summary (deductions breakdown, with refund as a named line item)
- order detail view in both admin and seller panel

The seller must be able to see:

- which order triggered the refund deduction
- the refund amount
- whether the refund reduced a pending payout or created a ledger debt
- the current status of the refund process

---

## 10. Payout Blocking Rules During Return

| Return Status | Payout Blocked |
|---|---|
| `requested` | Yes |
| `under_review` | Yes |
| `approved` | Yes |
| `in_transit` | Yes |
| `received` | Yes |
| `rejected` | No — payout may proceed |
| `refund_completed` | No — payout proceeds for remaining eligible amount |

The payout is blocked by the presence of an unresolved return, not by the return reason.
Admin must resolve the return to one of the two terminal states before payout can be released.

---

## 11. Dispute Finance Interaction

When a dispute is open:

- `Dispute.payoutBlocked = true` is set at dispute creation
- payout status transitions to `payout_blocked`
- `Payout.blockedReason` is updated to reflect the open dispute
- no payout can be released until the dispute is explicitly resolved by admin

When a dispute is resolved:

- `resolvedBy`, `resolvedAt`, and `resolution` are recorded
- if resolved in favor of the customer, refund is applied and payout adjusted
- if resolved in favor of the seller, payout block is lifted and payout can proceed
- `Dispute.payoutBlocked` is set to `false` on resolution
- admin records the resolution in `AdminAuditLog`

---

## 12. Admin Return and Refund Actions

Admin manages the return and refund flow. Actions available to admin:

| Action | Audit record required |
|---|---|
| Approve return | Yes — `return_approved` |
| Reject return | Yes — `return_rejected` |
| Mark item received | Yes |
| Complete refund | Yes — triggers ledger entry and payout update |
| Resolve dispute for customer | Yes — `dispute_resolved` |
| Resolve dispute for seller | Yes — `dispute_resolved` |
| Lift payout block after return resolved | Yes — `payout_hold_released` |

All admin actions on returns and disputes must create an `AdminAuditLog` entry with
`actorId`, `actionType`, `targetType`, `targetId`, `reason`, and timestamps.

---

## 13. Seller Participation

Sellers may participate in the return and dispute process through the seller panel but
cannot control outcomes unilaterally.

Sellers can:

- see return requests and disputes opened against their orders
- submit a response or evidence
- read the current status

Sellers cannot:

- close a return or dispute unilaterally
- issue a platform refund directly
- remove or suppress evidence
- modify the return history

---

## 14. Return Evidence

The `ReturnRequest.evidence` relation connects to `MediaAsset` records where customers
or sellers can attach photographic or documentary evidence.

Evidence is stored in Cloudflare R2 with `MediaAssetType = return_evidence` or
`dispute_evidence`.

Evidence must be associated with the return or dispute record, not stored loosely.
Access to evidence files must be authorization-checked. Evidence is not publicly accessible.

---

## 14.1 Seller-Driven Return Flow (2026-05-15)

The return flow is **seller-driven**. Admin enters only on dispute escalation.

Locked policy decisions:

1. **14 CALENDAR-day hard cutoff.** `openRequest` is rejected by the backend if
   `now > deliveryConfirmedAt + 14 calendar days`. There is **no** post-window
   admin-evaluation path (the previously documented post-14-day path is removed).
   The storefront button is hidden/passive after the window.
2. **Seller receipt confirmation auto-triggers the customer refund**
   (`confirmReceiptBySeller` → idempotent `refund.service`). The seller's payout for
   the order is already blocked, so this is finance-safe. Card → Iyzico; EFT →
   manual. A negative `SellerLedgerEntry` (`type = refund`) is written for
   reconciliation.
3. **Seller rejection of the received item auto-opens a `Dispute`** (status `open`,
   `payoutBlocked = true`), linked to the return via `ReturnRequest.disputeId` /
   `Dispute.escalatedFromReturn`. The conversation continues on the single
   `ReturnMessage` thread (customer ↔ seller ↔ admin).

Status mapping (order ← ReturnRequest):

```
delivery_confirmed
  → return_requested   (requested)    customer reason+desc+photos, seller notified
  → return_approved    (approved)     seller provides return cargo info
  → return_in_transit  (in_transit)   customer ships: carrier+tracking OR barcode photo
  → return_received → refund_pending → refund_completed   (seller confirms → auto refund)
  OR return_rejected → dispute_open   (seller rejects → admin dispute)
  → dispute_resolved   (admin closes; customer-favored with amount → refund)
```

New `ReturnRequest` fields: `sellerReturnAddress`, `sellerReturnCargoCarrier`,
`sellerReturnInstructions`, `sellerCargoInfoProvidedAt`, `customerShippedAt`,
`sellerReceivedAt`, `sellerRejectReason`, `sellerRejectDescription`,
`sellerRejectedAt`, `disputeId`. `ReturnMessage` gains message-level attachments
(`MediaAsset.returnMessageId`).

### Quantity lifecycle v2 (new orders)

`Order.quantityLifecycleVersion = 2` olan yeni siparişlerde iade, sipariş satırı ve
adet bazında çalışır. Eski siparişler yukarıdaki order-level akışta kalır; backfill
yapılmaz.

- Müşteri aynı satırdan 1–uygun kalan adet arasında seçim yapabilir ve kalan adetler
  için daha sonra yeni talep açabilir.
- Tek istekte farklı satıcılar seçilirse backend her satıcı için ayrı `ReturnRequest`
  ve `ReturnRequestItem` kayıtları oluşturur; ortak neden her işleme kopyalanır.
- Satıcı teslimde her satır için kabul ve red adedi girer. Toplam talep adedine eşit
  olmalı; reddedilen her satır için gerekçe zorunludur.
- Kabul edilen adetler sağlayıcı-bağımsız `RefundTransaction` kaydına, reddedilen
  adetler aynı iadeye bağlı tek uyuşmazlığa aktarılır. İade ürünleri stoğu değiştirmez.
- Müşteri refund tutarı kupon ve EFT indirimi sonrası satır net ürün bedelinin
  kümülatif kuruş dağıtımıyla hesaplanır. Ardışık işlemler satır snapshot'ını aşamaz.
- İlk gönderim kargo ücreti yalnız bütün sipariş adetleri iptal veya kabul edilmiş
  iadeyle kapandığında ve yalnız bir kez müşteriye eklenir.
- Açık iade/uyuşmazlık yalnız ilgili satıcının payout'unu bloke eder. İlgili adetlerin
  satıcı net hakedişi ve komisyon snapshot'ı ayrıca düzeltilir.
- Gerçek ödeme sağlayıcısı bağlanana kadar yeni akıştaki bütün refund kayıtları
  `pending` kalır; operasyon kaydı kendiliğinden tamamlanmış sayılmaz.

Satıcı tarafı zaman aşımı (kargo bilgisi veya teslim kararı verilmemesi) halen manuel
operasyonla izlenir; otomatik SLA işi ayrı geliştirmedir.

---

## 15. Cross-Reference

This document must remain aligned with:

- `.claude/rules/07-marketplace-finance-rules.md` (source of truth for finance rules)
- `.claude/rules/08-order-lifecycle-rules.md` (return lifecycle and dispute rules)
- `CLAUDE.md` sections 2.7, 15.3 (ruling sentences 9, 10, 11)
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/07-operations/dispute-management.md`
- `db/schema/schema.prisma` — `ReturnRequest`, `ReturnRequestStatus`, `Dispute`, `DisputeStatus`, `Payout`, `SellerLedgerEntry`, `MediaAsset`

If return, refund, or dispute logic changes, update this document and the aligned files
in the same work.
