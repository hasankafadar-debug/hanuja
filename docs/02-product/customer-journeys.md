# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Customer Journeys — Hanuja Marketplace

## Source of Truth

Journey logic derives from:
- `CLAUDE.md` section 15 (Net ruling sentences)
- `.claude/rules/08-order-lifecycle-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `db/schema/schema.prisma` (OrderStatus enum, PaymentMethod enum, ReturnRequestStatus enum)

All journey steps must reflect actual platform business rules.
No journey step may imply that seller receives payment directly or that payout occurs before `delivery_confirmed`.

---

## Journey 1: Card Payment Purchase — Standard Flow

**Entry point:** Storefront homepage, category page, product search, or direct product URL.

**Steps:**

1. Customer browses `/kategori/...` or `/urun/...` product pages.
2. Customer views product detail and clicks "Sepete Ekle".
3. Customer navigates to `/sepet`, reviews cart contents and totals.
4. Customer proceeds to `/odeme`, enters shipping address and selects card payment.
5. Iyzico payment form loads. Customer enters card details.
6. On successful card authorization, order status moves to `payment_confirmed`.
7. Customer sees order confirmation page at `/siparis/[id]`.
8. Seller receives the order in their queue (status `seller_queue_ready`).
9. Seller accepts order; status moves through `preparing` → `awaiting_shipment` → `shipped`.
10. Customer can view the order history under `/siparis` and shipment tracking under `/siparis/[id]`.
11. Cargo provider marks delivery. Status moves to `delivered`.
12. Customer receives notification to confirm delivery.
13. Customer clicks "Teslim Aldım" — status moves to `delivery_confirmed`.
    - If customer does not act within 72 hours of `delivered`, silent confirmation applies.
14. Payout hold countdown begins (30 days from `delivery_confirmed`).
15. If no return or dispute is opened, payout becomes eligible after hold period.

**Outcome:** Order complete. Seller payout scheduled after 30-day hold.

---

## Journey 2: EFT / Bank Transfer Purchase

**Entry point:** Same as Journey 1, but customer selects EFT/Havale at checkout.

**Steps:**

1. Customer completes cart and checkout flow, selects EFT payment method.
2. Platform displays Hanuja bank account details and reference code.
3. Order status is set to `bank_transfer_waiting`.
4. Customer transfers the amount and submits transfer evidence (where supported).
5. Finance admin reviews the evidence in the admin panel.
6. Admin approves the transfer — status moves to `bank_transfer_confirmed` then `payment_confirmed`.
   - Admin rejection moves status to `payment_failed`; customer is notified.
7. After `payment_confirmed`, seller receives the order in their fulfillment queue.
8. Remaining steps follow Journey 1 from step 8 onward.

**Key rule:** Seller does not see the order while status is `bank_transfer_waiting`.
EFT approval is logged with actor, timestamp, and evidence reference.

---

## Journey 3: Return Request — Within 14 Days

**Entry point:** Customer has received a wrong, damaged, or unwanted item.

**Steps:**

1. Customer navigates to `/siparis/[id]` and initiates a return request.
2. Customer selects return reason and submits the request.
3. Order status moves to `return_requested`.
4. Platform treats requests within the 14-day withdrawal window as fast-path.
5. Admin or automated flow reviews and approves the return.
6. Order status moves to `return_approved`.
7. Customer ships the item back. Status moves to `return_in_transit`.
8. Seller or warehouse receives the item. Status moves to `return_received`.
9. Refund is processed. Status moves to `refund_pending` then `refund_completed`.
10. If seller payout has not yet been released, the related amount is blocked or reduced.
    If payout was already paid, a seller ledger debt is created and offset from future payouts.

**Key rule:** A return request within 14 days does not require seller approval to proceed.
Return requests after 14 days are not automatically approved; they require admin evaluation.

---

## Edge Case: Payment Failure

- Customer submits card payment but authorization fails.
- Order status moves to `payment_failed`.
- Customer is shown an error and invited to retry with a different card or switch to EFT.
- Seller does not see the order at any point during payment failure states.
- If no retry occurs, order may be moved to `cancelled_due_to_payment_failure`.

---

## Edge Case: Seller Rejection

- Seller rejects a `payment_confirmed` order with a mandatory reason.
- Order status moves to `seller_rejected` then `cancelled_due_to_seller_rejection`.
- Customer is notified and refund flow is initiated.
- A 20% penalty on the product amount is evaluated and written to the seller ledger.
- Admin sees the rejection reason and penalty outcome in the admin panel.
- Seller cannot hide or delete the rejection event from history.

---

## Edge Case: 20-Day Fulfillment Delay Warning

- If the order remains unfulfilled and approaches the 20-day platform commitment threshold:
  - Admin receives a delayed order signal in the operations queue.
  - Customer may be notified of the delay.
- If the 20-day limit is breached and cancellation is triggered by customer or admin:
  - Order status moves to `cancelled_due_to_20day_breach`.
  - A 20% penalty on the product amount is evaluated for the seller.
  - Refund flow is initiated for the customer.
- A 10-day extension may be granted only with an explicit admin decision, documented in the audit log.
  Silent extension is not permitted.

---

## Delivery Confirmation Rules

`delivered` and `delivery_confirmed` are distinct states.

| State | Meaning | Payout effect |
|-------|---------|--------------|
| `delivered` | Cargo reports physical delivery | None yet |
| `delivery_confirmed` | Platform accepts delivery as complete | Payout countdown starts |

Confirmation sources accepted by the platform:
1. Customer explicitly clicks "Teslim Aldım"
2. Admin manually confirms delivery (`delivery_confirmed_manual`)
3. Silent confirmation: 72 hours pass after `delivered` with no customer objection

---

## Cross-Reference

- `.claude/rules/08-order-lifecycle-rules.md` — canonical lifecycle rules
- `.claude/rules/07-marketplace-finance-rules.md` — payout and refund finance rules
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/01-business/refund-return-policy.md`
- `docs/01-business/penalty-policy.md`
- `docs/02-product/user-roles.md`
