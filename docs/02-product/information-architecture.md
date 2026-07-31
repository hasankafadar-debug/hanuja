# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Information Architecture — Hanuja Marketplace

## Source of Truth

IA decisions derive from:
- `CLAUDE.md` sections 6 and 8 (repository map, SEO and route rules)
- `.claude/rules/00-project-scope.md` (routing and SEO direction)
- `.claude/rules/04-seo-rules.md` (stable entity namespace rule)
- `docs/04-seo/seo-url-slug-rules.md`

Route families are permanent decisions. Changing a namespace requires a full canonical and redirect review.

---

## 1. Storefront IA (`apps/web`)

The storefront is customer-facing and SEO-first. All public routes must follow namespace discipline to prevent entity type collision.

### 1.1 Route Map

| Route | Content type | Indexable | Notes |
|-------|-------------|-----------|-------|
| `/` | Homepage | Yes | Featured products, curated sections, editorial blocks |
| `/kategori/[...slug]` | Category listing | Yes | Hierarchical — e.g. `/kategori/mobilya/orta-sehpa` |
| `/urun/[slug]` | Product detail | Yes | One canonical URL per product |
| `/magaza/[slug]` | Seller storefront | Conditional | Indexed only if store meets quality threshold |
| `/blog/[slug]` | Editorial article | Yes | Must have unique informational intent |
| `/blog` | Blog index | Yes | Lists published articles |
| `/arama` | Search results | No | Non-indexable; dynamic query params |
| `/sepet` | Cart | No | Authenticated or session-based |
| `/odeme` | Checkout | No | Authenticated |
| `/hesabim` | Account overview | No | Authenticated — customer scope only |
| `/siparis` | Order history | No | Authenticated; rendered inside the shared customer account shell |
| `/faturalarim` | Customer invoices | No | Authenticated; rendered inside the shared customer account shell |
| `/hesabim/adresler` | Saved addresses | No | Authenticated |
| `/hesabim/iade-taleplerim` | Return requests | No | Authenticated |
| `/siparis/[id]` | Order detail | No | Authenticated; customer owns the order |
| `/giris` | Login | No | Auth surface |
| `/kayit` | Registration | No | Auth surface |
| `/sifremi-unuttum` | Password reset | No | Auth surface |

### 1.2 Namespace Ownership Rules

Each namespace owns one content type. Cross-type collisions are not permitted.

| Namespace prefix | Owned content type |
|-----------------|-------------------|
| `/kategori/` | Product category listings |
| `/urun/` | Product detail pages |
| `/magaza/` | Seller storefront pages |
| `/blog/` | Editorial and informational articles |
| `/hesabim/` | Authenticated customer account surfaces |
| `/siparis/` | Authenticated order detail surfaces |

No other entity type may reuse these prefixes. If a new content type is introduced, it must receive its own namespace.

### 1.3 Non-Indexable Routes

These routes must carry `noindex` directives and must not appear in sitemaps:

- `/arama` and all search query variations
- `/sepet`
- `/odeme`
- `/hesabim/*`
- `/faturalarim`
- `/siparis`
- `/siparis/*`
- `/giris`, `/kayit`, `/sifremi-unuttum`
- All filter/facet parameter combinations by default
- Empty or below-threshold category pages
- Paginated variants beyond page 1 unless an explicit pagination SEO strategy is approved

---

## 2. Seller Panel IA (`apps/seller-panel`)

The seller panel is operational and status-driven. It is not customer-facing and has no SEO requirements. All routes require seller authentication.

### 2.1 Route Map

| Route | Purpose |
|-------|---------|
| `/dashboard` | Summary: new orders, pending actions, earnings overview, delay warnings |
| `/siparisler` | Order list with status filters (new / preparing / shipped / return / dispute) |
| `/siparisler/[id]` | Order detail: product lines, customer address, shipment entry, status timeline |
| `/urunler` | Product catalog list with status indicators |
| `/urunler/[id]` | Product edit: title, description, pricing, inventory, images, status |
| `/urunler/yeni` | New product creation form |
| `/finans` | Finance summary: pending / hold / ready / paid earnings, deductions, penalties |
| `/finans/hakedisler` | Payout detail by order with hold-period status |
| `/finans/cezalar` | Penalty history and waiver status |
| `/ayarlar` | Account settings: store profile, payout bank details, notification preferences |
| `/kargolar` | Shipment tracking management (if surfaced separately from order detail) |

### 2.2 Seller Panel Rules

- Every route is scoped to the authenticated seller's own data. Server-side ownership checks are mandatory.
- Unpaid or unverified orders must not appear in `/siparisler` as actionable items.
- Finance amounts must be broken down by type. A single total balance number is not sufficient.
- Payout state transitions are read-only for the seller. The seller cannot release, block, or modify payout holds.

---

## 3. Admin Panel IA (`apps/admin-panel`)

The admin panel is the operational control surface of the marketplace. It is dense, role-partitioned, and all state-mutating actions are audited. All routes require admin authentication.

### 3.1 Route Map

| Route | Purpose |
|-------|---------|
| `/dashboard` | Marketplace health: collected today, pending EFT, delayed orders, payout-ready totals, open disputes |
| `/odemeler` | Payment list and EFT/bank transfer approval queue |
| `/odemeler/[id]` | Payment detail with approval/rejection action |
| `/siparisler` | Order list across all sellers with status, delay, and risk filters |
| `/siparisler/[id]` | Order detail with full lifecycle timeline, admin action zone |
| `/saticilar` | Seller list with status, risk, payout, and penalty indicators |
| `/saticilar/[id]` | Seller profile: order history, payout summary, ledger, penalty history, bank detail state |
| `/finans` | Finance overview: pending payouts, held balances, blocked payouts, negative balances |
| `/finans/hakedisler` | Payout readiness review and batch payout management |
| `/finans/cezalar` | Penalty list, waiver actions |
| `/finans/ayarlamalar` | Manual ledger adjustments |
| `/anlasmalar` | Return and dispute management queue |
| `/anlasmalar/[id]` | Return or dispute detail with resolution action zone |
| `/urunler` | Product moderation queue (pending review, reported content) |
| `/urunler/[id]` | Product moderation detail with approve/reject/request-revision actions |
| `/denetim` | Audit log viewer: actor, action, timestamp, target, before/after state |
| `/ayarlar` | Platform configuration (super admin only) |

### 3.2 Admin Panel Rules

- Action zones must separate "view" from "act". Destructive or finance-mutating actions must require an explicit confirmation step with reason input.
- Every `AdminActionType` action must write an audit log entry before the response is returned.
- Payout release must show: maturity date, open return status, dispute status, fraud flags, and bank detail verification state — before the release action is available.
- Sensitive values (full IBAN, full payment card data) must be masked in table views. Detail drill-down may unmask where operationally necessary and permission allows.
- The EFT approval queue at `/odemeler` must be a dedicated, filterable screen — not embedded in a generic order list.

---

## 4. Cross-Reference

Route and IA decisions must remain aligned with:
- `.claude/rules/04-seo-rules.md` — namespace and indexation rules
- `docs/04-seo/seo-url-slug-rules.md` — slug generation rules
- `docs/04-seo/redirect-canonical-plan.md` — redirect obligations on route changes
- `docs/04-seo/technical-seo-spec.md` — robots and canonical implementation
- `docs/02-product/user-roles.md` — which roles access which surfaces
- `docs/03-design/seller-panel-wireframe.md`
- `docs/03-design/admin-panel-wireframe.md`

Any addition of a new route namespace, or any change to an existing namespace, must trigger a review of canonical logic, redirect rules, and sitemap inclusion policy in the same work.
