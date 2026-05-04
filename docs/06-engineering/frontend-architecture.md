# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Frontend Architecture — Hanuja

## Purpose

This document describes the frontend architecture for all three Hanuja Next.js applications:
`apps/web` (storefront), `apps/seller-panel`, and `apps/admin-panel`.

It covers App Router conventions, server/client component rules, auth patterns per panel,
shared package usage, SEO concerns, form validation, and what must never run in the browser.

Source of truth order: `CLAUDE.md` > `.claude/rules/01-architecture.md` > this file.

---

## Framework

All three apps use **Next.js 14 with App Router**.

Pages Router is not used. Do not introduce it.

App Router features in use:
- `layout.tsx` for shared layout and metadata defaults
- `page.tsx` as the entry point per route segment
- `loading.tsx` for streaming-compatible skeleton fallbacks
- `error.tsx` for per-segment error boundaries
- `not-found.tsx` for 404 handling
- `generateMetadata()` for per-page metadata (server-side, not client-side)
- Route groups (`(storefront)`, `(panel)`, `(auth)`) to separate layout contexts

---

## Server Components as Default

**Server components are the default.** Every page and layout is a server component unless it needs browser interaction.

Server components in Hanuja call `api/services/` directly, without an intermediate HTTP fetch:

```ts
// Correct: server component calling service directly
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export default async function ProductDetailPage({ params }) {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const product = await svc.getProductBySlug(params.slug)
  // ...
}
```

This pattern avoids an unnecessary HTTP round-trip and keeps business logic in the service layer.

Server components must never:
- compute payout amounts
- evaluate penalty eligibility
- determine order lifecycle transitions
- write to seller ledger

These operations belong in `api/services/` and `api/domain/`.

---

## Client Components

A component is a client component only when it needs one of:
- browser events (`onClick`, `onChange`, form submission)
- React state (`useState`, `useReducer`)
- browser APIs (`useEffect`, `localStorage`, `useRouter`)
- client-side interactivity (cart quantity control, modals, tabs)

Mark client components with `'use client'` at the top of the file.

### Boundary rule

The checkout page (`apps/web/src/app/(storefront)/odeme/page.tsx`) is a client component
because it manages multi-step form state, address selection, and payment method toggling.

The product detail page (`/urun/[slug]/page.tsx`) is a server component; only the
"Add to Cart" button (`add-to-cart-button.tsx`) is a client component.

Keep the client boundary as narrow as possible. Wrap only the interactive subtree,
not the entire page, in a client component.

---

## Route Structure Per App

### apps/web (storefront, :3000)

```
app/
  layout.tsx                        — Root layout: fonts, Toaster, metadata base
  (storefront)/
    layout.tsx                      — Storefront shell: header, footer
    page.tsx                        — Homepage
    kategori/[...slug]/page.tsx     — Category listing
    urun/[slug]/page.tsx            — Product detail (server component)
    urun/[slug]/add-to-cart-button.tsx — Add to cart (client component)
    sepet/page.tsx                  — Cart
    odeme/page.tsx                  — Checkout (client component)
    siparis/[id]/page.tsx           — Order confirmation / status
    hesabim/page.tsx                — Customer account
    hesabim/adresler/page.tsx       — Saved addresses
    blog/page.tsx                   — Blog listing
    magaza/[slug]/page.tsx          — Seller store page
    arama/page.tsx                  — Search results
  (auth)/
    giris/page.tsx                  — Login
    kayit/page.tsx                  — Registration
  api/
    auth/[...all]/route.ts          — Better Auth handler
    payment/start/route.ts          — Payment initiation API
  robots.ts                         — robots.txt generation
  sitemap.ts                        — Sitemap generation
```

### apps/seller-panel (seller workspace, :3001)

```
app/
  (panel)/
    dashboard/page.tsx              — Seller dashboard
    siparisler/page.tsx             — Order queue
    siparisler/[id]/page.tsx        — Order detail with shipment form
    urunler/page.tsx                — Product list
    urunler/[id]/page.tsx           — Product edit
    hakedisler/page.tsx             — Payout summary
    ayarlar/page.tsx                — Seller account settings
  (auth)/
    giris/page.tsx                  — Seller login
  onboarding/page.tsx               — New seller onboarding
  api/
    auth/[...all]/route.ts
    seller/                         — Seller-scoped API routes
```

### apps/admin-panel (admin operations, :3002)

```
app/
  (panel)/
    siparisler/[id]/page.tsx        — Order detail with admin actions
    odemeler/page.tsx               — Payment / EFT approval queue
    hakedisler/page.tsx             — Payout management
    saticilar/page.tsx              — Seller list and oversight
  (auth)/
    giris/page.tsx                  — Admin login
  api/
    auth/[...all]/route.ts
```

---

## Auth Helper Pattern Per Panel

Each app has its own auth helper that reads the session server-side and enforces role.

`apps/seller-panel/src/lib/seller-session.ts` provides `getSellerFromSession()`:
- reads Better Auth session via server-side headers
- throws or redirects if not authenticated
- throws or redirects if role is not `seller` or `admin`
- returns the authenticated seller entity

`apps/admin-panel/src/lib/admin-session.ts` provides `getAdminFromSession()`:
- same pattern but enforces `admin` role

`apps/web/src/lib/auth.ts` provides the Better Auth instance shared across the storefront.

Route protection for panels is enforced at the middleware layer (`middleware.ts`) and
re-confirmed in server components via the session helper. Both layers must pass.

---

## Shared Packages Usage

### @hanuja/ui

All shared UI components come from `packages/ui`. Do not create one-off styled variants
in app-specific component folders when an equivalent shared component exists.

Components in use: `Button`, `Separator`, `Tabs`, `Breadcrumb`, `StatusBadge`, `PageHeader`,
`Toaster`, `Spinner`, `Input`, `Select`, `Textarea`, `Badge`, `Card`.

### @hanuja/seo

All metadata generation and structured data must use helpers from `packages/seo`.

Functions in use:
- `buildProductMetadata()` — generates `Metadata` for product detail pages
- `buildProductStructuredData()` — generates JSON-LD for product schema
- `buildBreadcrumbStructuredData()` — generates JSON-LD for breadcrumbs
- `JsonLd` — React component that renders `<script type="application/ld+json">`

Do not write inline metadata objects in page files. Call the canonical builder.

### @hanuja/types

Shared TypeScript types for domain entities. Use these instead of inlining ad hoc type shapes.

### @hanuja/security

Rate limiting, masking helpers, CSRF utilities, and fraud-scoring primitives used in API routes
and middleware. Do not duplicate these in app-specific utilities.

---

## SEO Concerns in apps/web

SEO logic must be server-side and centralized.

- `generateMetadata()` is exported from each indexable `page.tsx` and calls `@hanuja/seo` builders.
- Canonical URLs are generated by `@hanuja/seo` helpers, not handwritten strings.
- `robots.ts` and `sitemap.ts` at the app root control crawl and indexation policy.
- Route namespaces (`/kategori/`, `/urun/`, `/blog/`, `/magaza/`) are fixed; do not flatten them.

Apps `seller-panel` and `admin-panel` must not emit SEO metadata into public indexes.
Operational panels are non-indexable surfaces.

---

## Form Validation

Forms use **Zod** for schema definition and client-side validation.

- Zod schemas are defined close to the form file or in a shared `schemas/` folder within the feature.
- Server-side API routes also validate with Zod independently — never trust only client validation.
- React Hook Form may be used to connect Zod schemas to form state in client components.
- Validation errors must be shown inline, not only as toasts.

---

## Finance Logic — Never in the Browser

No finance computation may happen in the browser. This includes:

- payout amount calculation
- penalty amount calculation
- commission deduction
- net payout derivation
- ledger balance changes

These computations run in `api/domain/` and are called from `api/services/`.
Frontend components receive pre-computed values from server components or API responses
and display them — they do not recalculate them.

---

## State Management

There is no global client state library (no Redux, no Zustand).

State rules:
- Local UI state (modal open/close, tab selection, form fields): `useState` in client components.
- Server truth (order status, payout state, seller balance): driven by server component fetch on each render.
- Cart state: managed via server-side session through the cart API route, not browser localStorage.

Do not duplicate server-authoritative values in frontend state and then trust the frontend copy.

---

## Security Headers

Each app's `middleware.ts` applies security headers on every response:

```
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

Panel middlewares also enforce role-based redirects before any page component renders.

---

## Cross-Reference

This document must stay aligned with:
- `.claude/rules/01-architecture.md` — frontend architecture rules section
- `.claude/rules/03-ui-design-system.md` — component and design rules
- `.claude/rules/04-seo-rules.md` — canonical, metadata, and route rules
- `.claude/rules/05-security-rules.md` — auth, session, and permission rules
- `docs/06-engineering/system-architecture.md` — monorepo structure and service layering
- `docs/04-seo/seo-url-slug-rules.md` — route namespace and slug rules
- `docs/05-security/auth-authorization-plan.md` — role enforcement detail
