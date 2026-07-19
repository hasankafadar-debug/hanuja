# Son güncelleme: 2026-07-19
# Durum: taslak v1

# Auth and Authorization Plan

## Purpose

This document describes how authentication and authorization work in the Hanuja marketplace. It covers the Better Auth setup, role types, panel access boundaries, middleware enforcement per app, server-side session validation, privilege boundaries, and seller data isolation.

Source of truth for rules: `.claude/rules/05-security-rules.md`

---

## 1. Auth System

Hanuja uses **Better Auth** for session management across all three apps. Better Auth handles:

- email/password login and registration
- server-side session creation and validation
- session cookie issuance
- logout and session invalidation
- the `auth.api.getSession({ headers })` server call used by API routes and server components

The auth server is mounted at `/api/auth/[...all]` in `apps/web`. All three apps share the same auth backend by calling the auth session endpoint from their own domain using the request's forwarded cookie.

Google OAuth ile giriş yalnızca müşteri storefront'unda (apps/web) mevcuttur; GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env değişkenleriyle kapılıdır; Better Auth `socialProviders.google` kullanılır; satıcı/admin panellerinde sosyal giriş yoktur.

---

## 2. Role Types

The `UserRole` enum in `db/schema/schema.prisma` defines three roles:

| Role | Enum value | Description |
|------|-----------|-------------|
| Customer | `customer` | End buyer registered on the storefront |
| Seller | `seller` | Approved vendor with a seller profile |
| Admin | `admin` | Platform operator with full operational access |

Roles are stored on the `User` record and are set at registration or elevated by an admin action. Role escalation (customer → seller) occurs through the seller onboarding flow. Role escalation (any → admin) requires a manual database or admin-level action; there is no self-serve path.

---

## 3. Panel Access Boundaries

Each app enforces its own role boundary in Next.js middleware. The middleware runs on the edge before any page or API handler.

### 3.1 Storefront — `apps/web`

Protected paths: `/hesabim/*`, `/siparis/*`, `/sepet/odeme`

Behavior:
- Unauthenticated request on a protected path → redirect to `/giris?callbackUrl=<path>`
- Authenticated request (any role) → allowed through
- Sellers and admins who browse the storefront are permitted; there is no role exclusion on the storefront

Public paths (`/`, `/urun/*`, `/kategori/*`, `/blog/*`, `/magaza/*`, `/giris`, `/api/*`, `/_next/*`) bypass session lookup entirely.

### 3.2 Seller Panel — `apps/seller-panel`

Behavior:
- Unauthenticated → redirect to `/giris?callbackUrl=<path>`
- Authenticated `customer` role on a non-onboarding path → redirect to `/onboarding`
- Authenticated `seller` role → allowed through
- Authenticated `admin` role → allowed through (for support and inspection purposes)

The `/onboarding/*` path requires authentication but not the seller role, allowing the onboarding flow to complete before the role is elevated.

### 3.3 Admin Panel — `apps/admin-panel`

Behavior:
- Unauthenticated → redirect to `/giris`
- Authenticated with `role !== 'admin'` → redirect to `/giris?error=unauthorized`
- Authenticated `admin` → allowed through

The admin panel applies stricter security headers (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`) on every response including redirects. No page in the admin panel can be embedded in an iframe.

---

## 4. Server-Side Session Validation

All three middlewares call:

```
betterFetch('/api/auth/get-session', {
  baseURL: request.nextUrl.origin,
  headers: { cookie: request.headers.get('cookie') ?? '' },
})
```

The session is fetched from the server using the incoming request cookies. There is no JWT decoding client-side. The session object exposes `user.id`, `user.email`, and `user.role`. These are the only identity values considered authoritative.

Server components and API route handlers that need the session call:

```
auth.api.getSession({ headers: await headers() })
```

This always goes to the server. No client-side storage or localStorage is used for session state.

---

## 5. Privilege Boundaries — What Each Role Can Do

### Customer
- Browse catalog, product detail, blog, store pages
- Add to cart, initiate checkout, complete payment
- View own orders, track shipment
- Confirm delivery
- Request return within policy window
- Manage own account: addresses, profile, password

Customers cannot:
- See other customers' orders or data
- Access seller or admin panels
- Trigger payout or penalty actions
- Modify product catalog

### Seller
- View own products, create/edit/delete own product listings
- View own paid orders only (payment-confirmed)
- Accept or reject orders (with mandatory reason)
- Enter shipment and tracking details
- View own payout hold status and payout-ready balance
- View own ledger entries: commissions, penalties, deductions
- View own return/dispute items and submit responses
- Manage own store profile and bank details (subject to verification flow)

Sellers cannot:
- See other sellers' products, orders, or finance data
- Release their own payout hold
- Waive their own penalty
- Mark payment confirmed
- Access admin tools or admin-only order notes

### Admin
- Full read access to all orders, sellers, customers, payments
- Approve or reject EFT/havale payments
- Mark delivery confirmed manually
- Cancel orders with audit trail
- Waive or apply seller penalty
- Release or block payout hold
- Approve or reject return and dispute
- Suspend or reactivate seller accounts
- Apply manual finance adjustments to seller ledger
- Review fraud risk signals
- Review admin audit log

Admin sub-role partitioning (finance admin, operations admin, support admin, moderation admin) is the intended final state. Until fine-grained role columns are introduced, the `assertCan` permission matrix in `packages/security/src/permission-matrix.ts` governs which actions are permitted per role.

---

## 6. Seller Data Isolation

Seller data isolation is a server-layer concern, not a UI-layer concern. Middleware confirms the seller role, but middleware does not prevent a seller from attempting to access another seller's resource ID through a valid API endpoint. Data isolation is enforced at the service and repository layer.

Rules enforced at service layer:

- Every order query from a seller-panel context includes a `sellerId` filter matching the authenticated seller's ID.
- Every product management operation asserts that the product's `sellerId` matches the authenticated seller's ID before proceeding.
- Every payout, penalty, or ledger query is scoped to the authenticated seller's ID.
- If an ownership check fails, the service throws a permission or not-found error. It does not return another seller's data.

Pattern:

```typescript
// Typical ownership enforcement in a service function
const order = await orders.findById(orderId)
if (!order || order.lines.every(line => line.sellerId !== authenticatedSellerId)) {
  throw new NotFoundError('Order', orderId)
}
```

Returning a not-found error rather than a permission error for cross-ownership attempts prevents information leakage about resource existence.

---

## 7. Admin Action Authorization

For high-impact admin actions, `assertCan(role, action)` from `packages/security/src/permission-matrix.ts` is called before any business logic executes. This provides a consistent permission check that is independent of middleware and can be tested in isolation.

High-impact actions that require explicit permission checks include:
- approve or reject EFT payment
- release payout hold
- waive penalty
- apply manual finance adjustment
- suspend seller
- mark delivery confirmed manually
- approve or reject return

Every such action also calls an audit helper to create an `AdminAuditLog` record before the action result is returned.

---

## 8. Auth Boundaries Summary

| Concern | Where enforced |
|---------|---------------|
| Authentication (is logged in) | Next.js middleware per app |
| Role gate (has correct role) | Next.js middleware per app |
| Data ownership (right seller/customer) | Service layer, repository layer |
| Action permission (can do this thing) | `assertCan` in service layer |
| Input validity | Zod schema at API handler entry |
| Finance truth | Server-computed, never from client |

No single layer is relied upon exclusively. Each layer provides independent protection.

---

## 9. Şifre Oluşturma Politikası

Şifre güçlendirme kuralları role'e göre değişir ve şifre oluşturma noktalarında (kayıt, sıfırlama, değiştirme, satıcı ilk-şifre) uygulanır:

- **Müşteri:** ≥8 karakter + ≥1 harf + ≥1 rakam
- **Satıcı:** ≥8 karakter + ≥1 büyük harf + ≥1 küçük harf + ≥1 rakam + ≥1 sembol
- **Admin:** min 8 karakter (kapsam dışı; bilinçli olarak sınırlandırılmaz)

Kural detayları:

- Türkçe harfler (ç, ğ, ı, ö, ş, ü vb.) Unicode ile harf sayılır.
- Sembol = harf, rakam veya boşluk olmayan karakter.
- Başı/sonu boşluk içeren şifreler reddedilir.
- Kurallar **giriş akışlarında muaf**; mevcut zayıf şifreli hesaplar giriş yapabilir (kilitlenmez).
- Zorlama katmanları (düzende sırayla): istemci form validasyonu → route zod şeması → Better Auth `hooks.before` (app-bazlı, web=müşteri kuralı, seller-panel=satıcı kuralı).
- Kaynak modül: `packages/security/src/password-policy.ts` (Unicode-aware).

---

## Cross-Reference

- `.claude/rules/05-security-rules.md` — authoritative security policy
- `docs/05-security/security-architecture.md` — full defense layer overview
- `docs/05-security/admin-action-policy.md` — admin action audit requirements
- `docs/05-security/seller-iban-verification.md` — bank detail change privilege flow
- `apps/web/middleware.ts` — storefront middleware implementation
- `apps/seller-panel/middleware.ts` — seller panel middleware implementation
- `apps/admin-panel/middleware.ts` — admin panel middleware implementation
- `packages/security/src/permission-matrix.ts` — action permission matrix
