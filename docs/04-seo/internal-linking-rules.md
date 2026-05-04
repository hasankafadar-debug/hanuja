# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Internal Linking Rules

Rules for cross-linking between category, product, blog, and store pages on the Hanuja storefront.

## Purpose

Internal links serve two purposes simultaneously: they guide users to relevant content and they
signal topical relationships to crawlers. Every link decision must justify itself on both axes.

This file defines which page types link to which other page types, how many links are appropriate,
and what patterns are prohibited.

---

## Primary Linking Map

### Category pages (`/kategori/...`)

Category pages are the main commercial landing pages and carry the highest internal link authority.

Category pages must link to:

- direct subcategories below them in the category hierarchy
- featured or representative products within the category (4–8 products, editorially chosen)
- sibling subcategories where topically adjacent (e.g., orta sehpa linking to konsol)
- relevant blog posts that support the commercial intent of that category

Category pages must not link to:

- unrelated categories at the same level without editorial reason
- product pages outside the category's scope
- store pages generically (store links belong on product pages)

### Product pages (`/urun/...`)

Product pages link outward to their surrounding context.

Product pages must link to:

- the product's primary parent category (`/kategori/...`)
- the seller's store page (`/magaza/...`)
- related products in the same category (3–6 items, server-rendered, not client-only)

Product pages should link to:

- a relevant blog post only when the editorial content directly supports the purchase decision

Product pages must not link to:

- unrelated categories
- other sellers' store pages
- blog posts that are topically distant from the product

### Blog posts (`/blog/...`)

Blog posts are editorial content. Their internal links must feel natural and serve the reader.

Blog posts must link to:

- at least one relevant category page (`/kategori/...`) per article
- specific product pages (`/urun/...`) only when they are contextually referenced in the content,
  not appended as a promotional block at the end

Blog posts should not link to:

- every product in a category indiscriminately
- other blog posts unless directly referenced for further reading
- store pages unless the article is explicitly about a seller's story

### Store pages (`/magaza/...`)

Store pages represent seller identity on the storefront.

Store pages must link to:

- the seller's active, published products (rendered as a product listing)

Store pages should not link to:

- other stores
- category pages generically (the category context comes from the products themselves)
- blog posts unless there is a specific seller-authored editorial association

---

## Footer Links

The global footer is a site-wide linking surface and must be kept selective.

Footer must include:

- top-level categories (limit to 6–8 most important)
- legal and policy pages (gizlilik, kullanım koşulları, iade politikası)
- static informational pages (hakkımızda, iletişim)

Footer must not include:

- product pages (footer is not a product discovery surface)
- long lists of subcategories that duplicate sitemap function
- blog post links individually
- store pages

---

## Breadcrumb Rules

Breadcrumbs are the primary hierarchical navigation signal for both users and crawlers.

Every breadcrumb must reflect real information architecture, not a fabricated UI path.

Required breadcrumb structures:

- product page: `Ana sayfa > [Kategori] > [Alt kategori if applicable] > [Ürün adı]`
- category page: `Ana sayfa > [Üst kategori if applicable] > [Kategori adı]`
- blog post: `Ana sayfa > Blog > [Makale başlığı]`
- store page: `Ana sayfa > Mağazalar > [Mağaza adı]`

Breadcrumb structured data must match the visible breadcrumb trail exactly.

Do not invent breadcrumb depth that does not reflect the real category hierarchy.

---

## Orphan Page Prevention

An orphan page is a page that receives no internal links from any other indexed page.

Orphan pages must not exist for:

- published category pages
- published product pages
- published blog posts
- approved store pages

Detection method: any page that appears in the sitemap but receives zero internal links from
other indexed pages should be flagged for review.

Resolution: add the page to at least one appropriate parent context (category listing,
blog roundup, related product block, or sitemap-accessible navigation).

---

## Circular and Excessive Linking Prohibitions

Circular over-linking occurs when pages link back to each other in tight loops with no
topical purpose, inflating crawl depth without adding value.

Prohibited patterns:

- category page A links to category page B and B links back to A with no editorial reason
- every product page linking to every other product page in the catalog
- blog posts linking to other blog posts in long chains

Excessive footer link dumps are also prohibited. A footer that contains 80 category links
does not help users or crawlers — it dilutes signal and creates noise.

---

## Implementation Notes

Internal links must be server-rendered. Do not rely on client-side JavaScript to inject
internal links into page content after load. Crawlers may not execute JavaScript for
link discovery.

Related product blocks on product pages should be generated server-side based on shared
category membership or explicit editorial curation, not randomized at request time.

When a slug changes, internal links must be updated or redirects must be in place.
A 301 redirect handles crawlers, but stale internal links add unnecessary redirect hops.
Update internal links at the source wherever practical.

---

## Cross-Reference

- `docs/04-seo/seo-url-slug-rules.md` — route namespaces this file depends on
- `docs/04-seo/redirect-canonical-plan.md` — what happens when a linked URL changes
- `docs/04-seo/schema-markup-plan.md` — breadcrumb structured data alignment
- `.claude/rules/04-seo-rules.md` — governing SEO rules file
