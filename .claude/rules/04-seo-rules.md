# SEO Rules

## Purpose

This file defines the non-negotiable SEO rules of the Hanuja marketplace.

It exists to keep SEO decisions stable across:

- storefront routes
- category architecture
- product pages
- store pages
- blog content
- metadata generation
- canonical handling
- redirect handling
- internal linking
- structured data
- indexation control

If implementation conflicts with this file, this file wins unless an explicitly approved SEO decision replaces it.

## Core SEO Principle

Hanuja must be built with **SEO stability from day one**.

Do not treat SEO as a layer added after UI completion.

For Hanuja, SEO decisions affect:

- information architecture
- route design
- slug strategy
- duplication control
- crawl efficiency
- content templates
- canonical logic
- redirect cost
- long-term brand discoverability

Never choose short-term route convenience over long-term SEO stability.

## SEO Priority Order

When SEO decisions conflict with design or implementation convenience, use this priority:

1. route and canonical stability
2. entity separation clarity
3. index quality
4. duplicate-content control
5. metadata consistency
6. internal linking quality
7. design convenience
8. developer shortcut

## Stable Entity Namespace Rule

Entity types must not compete for the same root namespace.

Preferred route families:

- `/kategori/...`
- `/urun/...`
- `/blog/...`
- `/magaza/...`

This approach is intentionally explicit.
It reduces collision risk across:

- categories
- products
- blog posts
- seller storefronts

Do not move to ambiguous flat routes unless there is a fully approved SEO migration plan.

## Route Ownership Rules

Each route family must have a single content purpose.

### Category routes
Used for listing/indexable commercial collection pages.

Examples:
- `/kategori/mobilya`
- `/kategori/mobilya/orta-sehpa`

### Product routes
Used only for product detail pages.

Examples:
- `/urun/masif-meşe-orta-sehpa`
- `/urun/rattan-konsol-aynali`

### Blog routes
Used only for editorial/informational content.

Examples:
- `/blog/kucuk-salon-dekorasyon-fikirleri`
- `/blog/ev-ofis-duzeni-nasil-kurulur`

### Store routes
Used only for seller storefront pages.

Examples:
- `/magaza/atelier-noa`
- `/magaza/woodform-design`

Do not let one entity type reuse another entity type’s namespace.

## URL and Slug Governance Rule

All slug behavior must stay aligned with:

- `docs/04-seo/seo-url-slug-rules.md`
- `docs/04-seo/redirect-canonical-plan.md`

If a slug rule changes, canonical and redirect logic must be reviewed in the same work. :contentReference[oaicite:1]{index=1}

Never change slug generation in isolation.

## Canonical Rules

Canonical logic must be explicit and deterministic.

### Canonical expectations

1. Every indexable entity page must have a self-referencing canonical unless another approved canonical rule applies.
2. Canonical URLs must use the approved route family and final slug form.
3. Alternate filter/sort/query variations must not create canonical ambiguity.
4. Canonical must not point to temporary or UI-only URLs.
5. Canonical decisions must be server-driven, not left to frontend guesswork.

### Examples

- product detail → canonical to its primary `/urun/...` URL
- category page with sortable UI → canonical to clean category URL unless approved exception exists
- paginated category pages → follow explicit pagination strategy, do not invent ad hoc canonical behavior
- store pages → canonical to clean `/magaza/...` URL

## Redirect Rules

Redirect behavior must always stay aligned with canonical logic.

### Redirect expectations

- slug changes must produce controlled redirects
- retired URLs must not silently 404 if they had value
- redirect chains must be avoided
- permanent route migrations should normally use 301 behavior
- redirect maps must be traceable and documented

Do not introduce SEO-significant route changes without checking:

- old URL pattern
- new URL pattern
- canonical target
- redirect necessity
- sitemap impact
- internal link updates

## Indexation Rules

Not every page should be indexable.

Hanuja should protect search quality by indexing only pages with strong search value.

### Indexable by default

Usually indexable:

- primary category pages
- meaningful subcategory pages
- strong product detail pages
- approved store pages
- approved editorial/blog content
- brand or curated collection pages with actual search intent value

### Usually non-indexable or controlled

Usually not indexable without approval:

- internal account pages
- cart and checkout
- login/register/reset pages
- filtered/faceted combinations by default
- low-value search result pages
- duplicate sort variants
- empty listing pages
- thin auto-generated pages
- internal operational screens

Do not allow mass indexation of low-value parameter pages.

## Facet and Filter Rules

Marketplace filtering can easily create crawl waste and duplication.

### Default rule

Facet/filter combinations should be non-indexable by default unless explicitly approved.

Examples of risky index bloat sources:

- color filters
- size filters
- price ranges
- sort orders
- availability toggles
- seller-only filtered collections
- multi-filter combinations with little search demand

### Approved exception principle

A filtered collection may become indexable only if:

- it has real search demand
- it has stable URL strategy
- it has unique metadata
- it has sufficient product depth
- it is intentionally curated, not automatically exposed

## Category Page SEO Rules

Category pages are major commercial landing pages and must be treated as first-class SEO assets.

### Category requirements

- clean, stable URLs
- clear H1 hierarchy
- unique title and meta description logic
- meaningful intro text where appropriate
- internal links to subcategories and key products
- structured data when appropriate
- avoidance of duplicate collection pages
- no thin or near-empty indexable categories

### Category hierarchy rule

Category architecture must reflect real user intent and search logic, not only merchandising convenience.

Do not create deeply nested category paths unless they are structurally justified.

## Product Page SEO Rules

Product pages should be indexable only if they meet quality expectations.

### Product SEO requirements

- unique product title
- meaningful product description
- stable primary URL
- correct canonical
- valid availability and price signals where applicable
- product structured data where appropriate
- crawlable primary media
- internal links from category/store/editorial flows

### Product duplication rule

Do not create multiple indexable product URLs for the same underlying product identity without an approved reason.

If variants are involved, define one primary SEO URL strategy and keep it consistent.

### Product thin-content rule

Avoid indexing product pages that are too weak, such as:

- empty descriptions
- near-duplicate placeholder products
- unavailable temporary catalog entries with no long-term value
- hidden seller test products

## Store Page SEO Rules

Seller/store pages may be indexable if they provide meaningful search value.

### Store page expectations

- clean `/magaza/...` URL
- unique store title
- meaningful store description
- seller branding fields where appropriate
- internal links to live products
- no exposure for incomplete or low-quality stores if indexation is not desired

### Store quality rule

Not every seller page must be indexed automatically.
Low-quality or incomplete store pages may need indexation control.

## Blog / Editorial SEO Rules

Editorial content should support both discovery and conversion.

### Blog expectations

- unique informational intent
- no overlap with product or category pages
- clear title/H1 relationship
- structured headings
- internal links to relevant categories/products/store pages where natural
- avoid shallow AI-like filler content
- build topical clusters intentionally

### Blog separation rule

Blog content must not compete directly with category or product routes by reusing ambiguous URL spaces or duplicated page purposes.

## Metadata Rules

Metadata generation must be systematic, not manually random.

### Required metadata logic

At minimum define repeatable logic for:

- title tag
- meta description
- canonical URL
- open graph title
- open graph description
- open graph image fallback
- robots directives where needed

### Metadata rules

1. Metadata should be entity-aware.
2. Metadata fallbacks must be deterministic.
3. Do not rely only on manually entered fields.
4. Do not generate identical title/meta across many pages.
5. Metadata should reflect search intent, not only UI labels.

## Structured Data Rules

Structured data should be applied where it improves search understanding.

Typical targets:

- product pages
- category/breadcrumb context
- organization/site identity
- article/blog pages
- store pages where appropriate and valid

### Rules

- use valid schema types only
- match visible page reality
- do not inject misleading data
- keep price/availability consistent with page state
- keep structured data generation centralized where possible

## Breadcrumb Rules

Breadcrumbs should reflect real hierarchy, not decorative UI only.

### Rules

- breadcrumb path must match site architecture
- breadcrumb structured data should align with visible breadcrumb
- product pages should connect back to their primary category context where appropriate
- avoid misleading breadcrumb trails that imply false taxonomy

## Sitemap Rules

Sitemaps must be selective and quality-driven.

### Include

- approved indexable categories
- approved products
- approved blog posts
- approved store pages
- other approved landing pages

### Exclude

- non-indexable pages
- duplicate or parameter pages
- empty/low-value pages
- private/authenticated pages
- operational UI routes

Sitemap generation should reflect actual indexation policy, not just all known URLs.

## Internal Linking Rules

Internal linking must support both crawlability and relevance.

### Rules

- link categories to meaningful subcategories and products
- link product pages back to relevant category/store context
- use blog content to support discovery into category/product areas naturally
- avoid orphan pages
- avoid excessive repetitive footer-style link spam
- prioritize semantically relevant internal links

## Content Quality Rules

SEO success depends on quality, not only structure.

### Do not publish indexable pages that are:

- empty
- placeholder-like
- duplicated with tiny wording changes
- mechanically generated without usefulness
- inconsistent with user-visible content
- misleading about stock, price, or product details

### Prefer pages that are:

- specific
- useful
- unique enough
- semantically clear
- connected to real commercial or informational intent

## Internationalization and Language Rule

Primary SEO language for Hanuja is Turkish unless expansion strategy explicitly adds more locales.

### Rules

- Turkish route logic must be consistent
- slug normalization must follow approved Turkish-to-ASCII rules from slug docs
- metadata and content should not mix languages carelessly
- do not prepare fake multilingual structures before they are operationally supported

## SEO Safety Rules for Implementation

When implementing SEO-sensitive features:

- keep route generation centralized
- keep canonical generation centralized
- keep redirect logic centralized
- keep metadata generation deterministic
- keep indexation decisions explicit
- avoid ad hoc component-level SEO hacks

Do not bury core SEO logic inside random page components.

## Change Management Rules

Any change touching one of these areas is high-impact:

- route family
- slug generator
- canonical logic
- redirect logic
- indexation rules
- filter indexation
- metadata templates
- structured data format
- sitemap inclusion rules

For such changes, update related docs in the same work.

## Things Claude Must Not Do

Do not:

- flatten all route types into one ambiguous namespace
- allow entity route collisions
- change slug logic without reviewing redirect/canonical consequences
- index filter combinations by default
- create many near-duplicate pages with identical metadata
- expose empty or weak pages in sitemaps
- trust client-side SEO decisions for canonical/indexation
- treat redirects as optional after slug changes
- build SEO around temporary UI shortcuts

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `docs/04-seo/seo-strategy.md`
- `docs/04-seo/technical-seo-spec.md`
- `docs/04-seo/metadata-rules.md`
- `docs/04-seo/internal-linking-rules.md`
- `docs/04-seo/seo-url-slug-rules.md`
- `docs/04-seo/schema-markup-plan.md`
- `docs/04-seo/redirect-canonical-plan.md`

If SEO logic changes, update the connected documents in the same work.