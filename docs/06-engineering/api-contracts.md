# Son güncelleme: 2026-04-18
# Durum: taslak v1

# API Contracts — Hanuja Marketplace

All API routes live under `api/routes/`. Route handlers are thin: validate input with Zod, resolve auth, call the service layer, return a structured response. Business logic never lives in route handlers.

---

## Auth Model

Authentication is provided by Better Auth via a server-side session cookie. Every protected route reads the session from the cookie and resolves the user record and role before any business operation.

- Session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.
- Role is resolved server-side from the session; never trusted from the request body or query params.
- Seller-scoped routes verify `user.role === 'seller'` and load `seller.id` from the session.
- Admin-scoped routes verify `user.role === 'admin'`.
- Unauthenticated requests to protected routes receive `401`.
- Authenticated requests with insufficient role receive `403`.

---

## Standard Response Shape

All responses return JSON.

### Success — single resource
```json
{ "data": { ... } }
```

### Success — list
```json
{ "data": [ ... ], "meta": { "total": 42, "page": 1, "pageSize": 20 } }
```

### Success — action with no body
```json
{ "success": true }
```

### Error
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable summary",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

`errors[]` is present for validation failures (400, 422). It is omitted for auth, permission, and server errors.

---

## HTTP Status Codes

| Code | When used |
|---|---|
| 200 | Successful read or update |
| 201 | Successful resource creation |
| 400 | Malformed request, missing required field, business rule violation detected at input boundary |
| 401 | No valid session |
| 403 | Valid session but insufficient role or permission |
| 404 | Resource not found, or foreign record access (ownership check returns 404, not 403) |
| 409 | Conflict — duplicate resource, idempotency key collision, or illegal state transition |
| 422 | Zod validation failure with field-level detail |
| 500 | Unhandled server error — internal details are not exposed to the caller |

### Ownership check rule
When a seller or customer requests a record that exists but belongs to a different owner, the API returns `404`, not `403`. Returning `403` would confirm the record exists and expose cross-seller information.

---

## Zod Validation

Every route that accepts a request body or query parameters validates with a Zod schema before calling any service. If validation fails, the route returns `422` with `errors[]` populated from `ZodError.flatten()`. No business logic runs on invalid input.

---

## Idempotency

Payment and payout routes must be safe to call more than once with the same intent.

- Iyzico webhook callbacks are verified by signature and processed at most once per `providerPaymentId` using a database uniqueness check.
- EFT approval endpoints check current payment status before applying the transition; re-approving an already-confirmed payment is a `409`.
- Payout release endpoints check `payout.status` before transitioning; releasing an already-paid payout is a `409`.
- BullMQ job handlers for payout maturity and delivery confirmation are idempotent: they check current state before writing.

---

## Rate Limiting

Rate limiting is applied by `packages/security`. Response headers on limited routes:

- `X-RateLimit-Limit` — requests allowed per window
- `X-RateLimit-Remaining` — requests remaining in current window
- `X-RateLimit-Reset` — Unix timestamp when the window resets

When the limit is exceeded the route returns `429 Too Many Requests`.

Tighter limits apply to: login, password reset, registration, coupon application, checkout initiation, payout detail changes.

---

## Route Families

### /api/catalog

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/catalog/products` | None | List published products; supports `categorySlug`, `q`, `page`, `pageSize` query params |
| GET | `/api/catalog/products/:slug` | None | Product detail by slug |
| GET | `/api/catalog/categories` | None | Category tree |
| GET | `/api/catalog/categories/:slug` | None | Single category with children |

Meilisearch is used for full-text search (`q`). PostgreSQL is authoritative for availability, price, and stock. Search results are never used for finance decisions.

---

### /api/cart

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/cart` | Optional | Get current cart (user or guest session) |
| POST | `/api/cart/items` | Optional | Add item; body: `{ productId, variantId?, quantity }` |
| PATCH | `/api/cart/items/:id` | Optional | Update quantity |
| DELETE | `/api/cart/items/:id` | Optional | Remove item |
| POST | `/api/cart/coupon` | Optional | Apply coupon code |
| DELETE | `/api/cart/coupon` | Optional | Remove applied coupon |

Guest carts use a session cookie to carry `sessionId`. On login, guest cart is merged into the authenticated user cart.

---

### /api/checkout and /api/payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/checkout` | Customer | Convert cart to order; returns `orderId` and Iyzico payment token |
| POST | `/api/payments/start` | Customer | Initiate Iyzico payment session for an order |
| POST | `/api/payments/callback` | None (webhook) | Iyzico result callback; signature verified before processing |
| POST | `/api/payments/eft` | Customer | Submit EFT payment proof; moves order to `bank_transfer_waiting` |

Payment confirmation is always server-driven. The storefront redirect URL after Iyzico completion is not trusted as confirmation; the webhook callback is the authoritative signal.

---

### /api/orders (customer-facing)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/orders` | Customer | List own orders with status and summary |
| GET | `/api/orders/:id` | Customer | Order detail; 404 if order belongs to different user |
| POST | `/api/orders/:id/confirm-delivery` | Customer | Customer confirms delivery; triggers `delivery_confirmed` transition |
| POST | `/api/orders/:id/cancel` | Customer | Cancel before shipment where policy allows |
| POST | `/api/orders/:id/return` | Customer | Open return request; body: `{ reason, description }` |

---

### /api/seller/*

All seller routes require `role === 'seller'` and `seller.status === 'active'`. Seller ID is always taken from the session, never from the request body.

| Method | Path | Description |
|---|---|---|
| GET | `/api/seller/dashboard` | Summary counts: new orders, pending payout, alerts |
| GET | `/api/seller/orders` | List seller-scoped payment-confirmed orders |
| GET | `/api/seller/orders/:id` | Order detail; 404 if orderLine.sellerId does not match session seller |
| POST | `/api/seller/orders/:id/accept` | Accept order |
| POST | `/api/seller/orders/:id/reject` | Reject order; body: `{ reason }` required; triggers penalty evaluation |
| POST | `/api/seller/orders/:id/ship` | Create shipment; body: `{ cargoProvider, trackingNumber }` |
| GET | `/api/seller/products` | List own products |
| POST | `/api/seller/products` | Create product draft |
| PATCH | `/api/seller/products/:id` | Update own product; 404 if product.sellerId does not match |
| DELETE | `/api/seller/products/:id` | Soft-delete (set status to `unlisted`) |
| GET | `/api/seller/finance/ledger` | Paginated ledger entries |
| GET | `/api/seller/finance/payouts` | Payout list with status and hold dates |
| GET | `/api/seller/finance/penalties` | Penalty history |
| GET | `/api/seller/bank-details` | Masked bank detail list |
| POST | `/api/seller/bank-details` | Add bank detail; triggers delayed activation flow |

Seller order queries filter by `orderLine.sellerId = session.sellerId` and `order.status IN (payment-confirmed family)`. Unpaid orders are never returned.

---

### /api/admin/*

All admin routes require `role === 'admin'`. High-impact actions log to `AdminAuditLog`. Action endpoints require a `reason` field in the body where the schema enforces it.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/dashboard` | Marketplace health summary |
| GET | `/api/admin/payments` | Payment list with status filter |
| POST | `/api/admin/payments/:id/approve-eft` | Approve EFT; body: `{ reason? }` |
| POST | `/api/admin/payments/:id/reject-eft` | Reject EFT; body: `{ reason }` |
| GET | `/api/admin/orders` | Order list with full status filter |
| POST | `/api/admin/orders/:id/cancel` | Cancel order; body: `{ reason }` |
| POST | `/api/admin/orders/:id/confirm-delivery` | Manual delivery confirmation |
| GET | `/api/admin/sellers` | Seller list with status and risk indicators |
| POST | `/api/admin/sellers/:id/suspend` | Suspend seller; body: `{ reason }` |
| POST | `/api/admin/sellers/:id/activate` | Reactivate seller |
| GET | `/api/admin/payouts` | Payout list filterable by status |
| POST | `/api/admin/payouts/:id/release` | Release payout hold; body: `{ reason }` |
| POST | `/api/admin/payouts/:id/block` | Block payout; body: `{ reason }` |
| POST | `/api/admin/payouts/batch` | Create payout batch from ready payouts |
| GET | `/api/admin/penalties` | Penalty list |
| POST | `/api/admin/penalties/:id/waive` | Waive penalty; body: `{ reason }` required |
| GET | `/api/admin/returns` | Return request list |
| POST | `/api/admin/returns/:id/approve` | Approve return |
| POST | `/api/admin/returns/:id/reject` | Reject return; body: `{ reason }` |
| GET | `/api/admin/disputes` | Dispute list |
| POST | `/api/admin/disputes/:id/resolve` | Resolve dispute; body: `{ resolution, refundAmount? }` |
| GET | `/api/admin/audit-logs` | Audit log search; filterable by actorId, targetType, actionType |
| POST | `/api/admin/ledger/adjust` | Manual ledger adjustment; body: `{ sellerId, amount, reason }` |

---

## Error Code Reference

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | Zod schema failure; `errors[]` populated |
| `UNAUTHENTICATED` | No valid session |
| `FORBIDDEN` | Valid session, insufficient role |
| `NOT_FOUND` | Resource does not exist or ownership check failed |
| `CONFLICT` | Duplicate resource or illegal state transition |
| `PAYMENT_ALREADY_CONFIRMED` | Idempotency guard on payment confirmation |
| `PAYOUT_ALREADY_PAID` | Idempotency guard on payout release |
| `ORDER_NOT_PAYABLE` | Order is not in a payment-confirmable state |
| `SELLER_NOT_ACTIVE` | Seller account is suspended or pending |
| `PAYOUT_BLOCKED` | Payout cannot be released while block is active |
| `INTERNAL_ERROR` | Unhandled server error; no internal detail exposed |
