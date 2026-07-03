# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Security Architecture

## Purpose

This document describes the overall security design of the Hanuja marketplace.
It covers the role model, defense layers, session handling, CSRF protection, server-side enforcement, and the principle that no client-side state is trusted for security decisions.

Source of truth for rules: `.claude/rules/05-security-rules.md`

---

## 1. Design Principle

Hanuja collects all customer payments centrally and holds seller funds for 30 days after `delivery_confirmed`. This makes the platform financially sensitive at every layer. Security is not only about account protection — it includes finance integrity, payout safety, admin action traceability, and seller identity protection.

The guiding principles are:

- **Least privilege** — every actor gets the minimum access required.
- **Explicit server-side authorization** — frontend visibility rules are never the security boundary.
- **Defense in depth** — no single control layer is relied upon alone.
- **Secure defaults** — ambiguous states block or require review rather than auto-approve.
- **Auditability** — every high-impact action is attributable to an actor, timestamp, and reason.

---

## 2. Role Model (RBAC)

Roles are stored in the `UserRole` enum in the Prisma schema and enforced in middleware and service layers.

| Role | Description | Panel access |
|------|-------------|--------------|
| `customer` | End buyer | Storefront (`apps/web`) only |
| `seller` | Approved marketplace vendor | Seller panel (`apps/seller-panel`) |
| `admin` | Platform operator | Admin panel (`apps/admin-panel`) |

The schema currently defines one `admin` role. Operationally, admin sub-roles should be treated as follows pending fine-grained permission implementation:

| Sub-role concept | Sensitive capabilities |
|-----------------|----------------------|
| finance admin | payout release, EFT approval, penalty waiver, manual adjustment |
| operations admin | order oversight, delivery confirmation override, seller suspension |
| support admin | dispute and return review, customer-side read access |
| moderation admin | product approval/rejection, content review |

The `permissionsFor` / `assertCan` helpers in `packages/security/src/permission-matrix.ts` implement the action permission matrix. All service-layer operations that carry financial or lifecycle consequences call `assertCan` before proceeding.

---

## 3. Defense Layers

Every mutating or privileged request passes through multiple independent control layers. These layers are applied in order and no layer trusts the one before it to have completed.

### Layer 1 — Authentication (middleware)

Each app's Next.js middleware calls `betterFetch('/api/auth/get-session', ...)` using the request cookie. The session object is validated server-side by Better Auth. Unauthenticated requests are redirected to `/giris` before reaching any page or API handler.

### Layer 2 — Role check (middleware)

After authentication, middleware verifies the role matches the panel:

- `apps/admin-panel/middleware.ts` — only `role === 'admin'` is allowed; any other role receives a redirect to `/giris?error=unauthorized`.
- `apps/seller-panel/middleware.ts` — `seller` and `admin` roles are allowed; a `customer` without a seller account is redirected to `/onboarding`.
- `apps/web/middleware.ts` — any authenticated user is allowed on protected storefront paths.

### Layer 3 — Ownership check (service layer)

The middleware confirms role, but the service layer confirms data ownership. Every seller-scoped query must filter by the authenticated seller's ID. Every customer-scoped query must filter by the authenticated customer's ID. Repositories never receive a request to "get all orders" without an ownership predicate attached by the service layer.

### Layer 4 — Input validation (Zod schemas)

All external input is validated against typed Zod schemas defined in `packages/security/src/input-validator.ts` before it reaches business logic. This includes schemas for EFT approval, penalty waiver, bank detail change, return request, and all other finance-sensitive operations. Client-supplied amounts, statuses, or identifiers are never used directly.

### Layer 5 — CSRF protection (double-submit cookie)

Mutating API routes on the storefront are protected by an explicit CSRF token layer in addition to SameSite cookie behavior. See Section 5 for the full CSRF design.

### Layer 6 — Rate limiting

Rate limiting is Redis-backed: `api/lib/rate-limit-redis.ts` implements a sliding window
on the shared ioredis client (`rl:` key prefix, atomic MULTI of
ZREMRANGEBYSCORE/ZADD/ZCARD/PEXPIRE), so limits hold across all app containers on
Coolify. `api/lib/rate-limit.ts` wraps it with async `checkRateLimit` (IP-keyed) and
`checkUserRateLimit` (user-keyed) helpers returning ready-made 429 responses.

Preset configs still live in `packages/security/src/rate-limiter.ts`, which also serves
as the in-memory fallback: when `REDIS_URL` is unset (local dev) or Redis errors at
runtime, the limiter fails open to the per-instance memory window and logs the error —
availability is preferred over strictness for this layer.

Coverage: `SENSITIVE_RATE_LIMIT` on payment initiation, checkout, returns, product
import (preview/commit) and media upload-URL issuance; `HIGH_RISK_RATE_LIMIT` on seller
bank-detail changes and OTP requests, first-password, and admin seller password reset;
`API_RATE_LIMIT` on barcode availability checks, review submission, dispute/support
message creation and Turnstile verification endpoints. Better Auth's built-in rate
limiter is enabled in the shared factory (`api/lib/auth.ts`) with stricter per-path
rules for sign-in/sign-up/password-reset.

### Layer 7 — Audit logging

Every high-impact action writes a structured audit entry via `packages/security/src/audit-logger.ts`. Audit helpers include `auditPayoutReleased`, `auditPenaltyWaived`, `auditEftApproved`, `auditSellerSuspended`, `auditBankDetailChanged`, and `auditManualFinanceAdjustment`. Each entry records actor ID, role, timestamp, target entity, previous state, new state, and reason.

---

## 4. Session Handling

Sessions are managed by Better Auth. The auth library issues a server-side session on login and provides `auth.api.getSession({ headers })` for server component and API route use.

Rules:

- Sessions are validated on the server. Client-supplied session tokens or user IDs are never trusted.
- Logout invalidates the session server-side.
- Admin sessions are subject to the same mechanism but operate on the `apps/admin-panel` domain, which applies stricter security headers (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`).
- Storefront sessions deliberately omit `X-Frame-Options: DENY` to allow Iyzico 3DS iframe rendering.

---

## 5. CSRF Protection

CSRF protection uses the double-submit cookie pattern implemented in `packages/security/src/csrf.ts`.

### Token lifecycle

1. On every HTML page response (non-API, non-asset path), `apps/web/middleware.ts` issues two cookies if not already present:
   - `hanuja-csrf` — `HttpOnly: true`, `SameSite: lax`, 24-hour TTL. Server comparison target.
   - `hanuja-csrf-mirror` — `HttpOnly: false`, `SameSite: lax`, 24-hour TTL. Client reads this to set the `x-csrf-token` request header.
2. The token is a 32-byte cryptographically random hex string generated by `generateCsrfToken()`.
3. Mutating API route handlers call `checkCsrf(req)` which calls `verifyCsrfToken(cookieToken, headerToken)` using `timingSafeEqual` to prevent timing attacks.
4. If the tokens do not match, the request is rejected with 403 before reaching any business logic.

### Origin check

`isOriginAllowed(originHeader, allowedOrigins)` in the same module provides a complementary origin header check. It is used in combination with token verification for the highest-risk state-mutating routes.

### Why two cookies

The `hanuja-csrf` cookie is `HttpOnly` so JavaScript cannot steal the server-side reference token via XSS. The `hanuja-csrf-mirror` cookie is readable by JavaScript so the fetch client can attach it as a request header. The server then compares cookie value (from `hanuja-csrf`) against header value (sent by the client from the mirror). A cross-origin attacker cannot read the mirror value from a different origin.

---

## 6. Security Headers

| Header | Storefront | Seller panel | Admin panel |
|--------|-----------|-------------|------------|
| `X-Content-Type-Options: nosniff` | Yes | Yes | Yes |
| `Referrer-Policy: strict-origin-when-cross-origin` | Yes | Yes | Yes |
| `X-Frame-Options: DENY` | No (Iyzico 3DS) | Yes | Yes |
| `Content-Security-Policy: frame-ancestors 'none'` | No | Yes | Yes |

---

## 7. Data Masking

Sensitive values are masked in any log output, admin display, or API response using helpers in `packages/security/src/data-masker.ts`:

- `maskIban` — shows last 4 digits only
- `maskEmail` — shows first character and domain only
- `maskCardNumber` — shows last 4 digits only
- `maskTurkishId` — masks all but last 2 digits
- `maskSensitiveObject` — applies masking rules to a plain object by key name

Full unmasked values are accessed only in the specific code paths that require them (e.g., payout dispatch, IBAN change audit).

---

## 8. Fraud Scoring

`packages/security/src/fraud-scorer.ts` exports `scoreOrderRisk(input: OrderRiskInput)`. The scorer evaluates signals such as order amount relative to history, account age, address consistency, and payment pattern. High-risk orders are flagged before seller visibility is granted. The score is readable in admin order detail. It does not automatically cancel orders — it surfaces review recommendations.

---

## 9. What Is Never Trusted Client-Side

- Payment confirmation status
- Payout eligibility
- Order status
- Ownership of a resource
- Role or permission level
- Price or amount calculations
- Session or user identity

All of these are resolved from the server using validated database state or verified session data.

---

## Cross-Reference

- `.claude/rules/05-security-rules.md` — source of truth for security policy
- `docs/05-security/auth-authorization-plan.md` — role model and middleware detail
- `docs/05-security/payment-security.md` — payment and webhook security
- `docs/05-security/audit-logging-plan.md` — audit entry structure and storage
- `docs/05-security/seller-iban-verification.md` — bank detail change flow
- `docs/05-security/fraud-risk-rules.md` — fraud scoring detail
- `docs/05-security/secrets-env-policy.md` — secret storage rules
- `packages/security/src/` — implementation home for all shared security utilities
