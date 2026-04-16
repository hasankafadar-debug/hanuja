---
name: cart-checkout-flow
description: Apply Hanuja cart and checkout rules. Use when implementing cart state management, checkout steps, cart-to-order conversion, guest checkout, coupon application, or address handling.
user-invocable: false
paths:
  - "apps/web/src/app/(shop)/**/*"
  - "api/services/cart*"
  - "api/services/checkout*"
  - "api/routes/cart*"
  - "api/routes/checkout*"
  - "api/repositories/cart*"
model: sonnet
effort: high
---

This skill defines Hanuja cart and checkout discipline.

Main principle:
Cart is a client-side convenience; checkout is a server-side financial commitment. The transition must be explicit and validated.

Cart rules:
1. Cart may be server-side (persistent) or client-side (session) — define clearly
2. Cart items must reference product + variant with current price snapshot at add time
3. Quantity limits must be enforced at add and at checkout
4. Out-of-stock items must be flagged before checkout proceeds
5. Price changes between add and checkout must be surfaced clearly

Checkout step model:
1. Cart review (items, quantities, prices)
2. Address selection/entry
3. Shipping method selection
4. Coupon/discount application
5. Payment method selection
6. Order summary confirmation
7. Payment initiation → payment result
8. Order confirmation display

Cart-to-order conversion rules:
- Only occurs after payment confirmation signal from Iyzico or EFT approval
- Cart must be locked/invalidated after successful order creation
- Order lines must capture price at time of purchase (immutable snapshot)
- Multi-seller orders → one Order with multiple OrderLine groups by seller
- Each seller's lines are independent for fulfillment purposes

Coupon rules:
- Validate coupon server-side at application and at final checkout
- Check: active, not expired, not exceeded usage limit, applicable to items in cart
- Capture: discount type (percentage/fixed), discount amount, cost-share (platform vs seller)
- Store coupon reference in order for finance traceability

Address rules:
- Logged-in users: address book, select existing or add new
- Guest checkout: address captured inline (store in order only)
- Turkish address format: name, phone, address line, district, city, postcode

Guest checkout:
- Allow order without account creation
- Offer post-order account creation
- Guest orders must be traceable by email + order number
- Guest cannot access seller panel — no seller intent from guest flow

Finance awareness:
- Cart must never be the financial source of truth
- Server must re-calculate totals at checkout confirmation
- Never trust client-submitted total for order creation
- Price, discount, coupon, and shipping amounts must all be server-validated at order creation

When implementing cart/checkout:
- identify the step in checkout flow
- validate all inputs server-side
- capture immutable price snapshot at order creation
- protect against double-submit (idempotency key at checkout)
- handle payment failure gracefully (don't destroy cart on failure)

Never accept:
- client-submitted final price for order creation
- cart that persists as modifiable after order is placed
- checkout without server-side stock validation
- coupon discounts applied without finance traceability
- partial order creation without payment confirmation
