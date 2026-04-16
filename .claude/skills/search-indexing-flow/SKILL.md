---
name: search-indexing-flow
description: Apply Hanuja Meilisearch indexing and search rules. Use when implementing search index sync, facet configuration, search UI, unpublished content exclusion, or search relevance tuning.
user-invocable: false
paths:
  - "api/jobs/search*"
  - "api/services/search*"
  - "apps/web/src/**/search*"
  - "packages/seo/**/*"
model: sonnet
effort: medium
---

This skill defines Hanuja search and indexing discipline.

Main principle:
Meilisearch is a read projection only. PostgreSQL is source of truth. Never trust search index for finance, lifecycle, or authorization decisions.

Index design:
- products index: searchable product catalog
- categories index: category autocomplete / navigation support (optional)
- stores index: seller storefront discovery (optional)
- blog index: editorial content search (optional)

Products index document shape:
- id
- name (Turkish)
- slug
- description_short
- category_id, category_slug, category_name
- seller_id, seller_slug, seller_name
- price (current)
- compare_at_price
- images[0] (primary image)
- status (only PUBLISHED items go in index)
- is_in_stock
- attributes (key-value pairs for faceting)
- created_at, updated_at

Unpublished exclusion rules (critical):
- DRAFT products must NEVER appear in search index
- SUSPENDED seller products must be removed from index
- OUT_OF_STOCK may remain indexed (configurable)
- Admin-hidden products must be removed from index
- Deleted products must be removed immediately

Index sync strategy:
1. Full reindex job: scheduled nightly or on-demand via admin
2. Incremental sync: event-driven via BullMQ (product.published, product.updated, product.unpublished)
3. Batch sync: process queue in bulk for performance
4. Sync failure: log + retry, never silently lose update

Facet configuration:
- category (hierarchical)
- price range
- seller
- attributes (color, material, size, etc.) — configurable per category
- in_stock

Facet SEO rules (from SEO rules):
- Facet URL combinations must NOT be indexed by default
- Only approved faceted pages with real search demand get indexable treatment
- Use noindex on facet combination URLs unless explicitly approved

Search UI rules (storefront):
- Search box in header (instant search or suggestions)
- Full search results page at /ara?q=...
- Apply filters without page reload where possible
- Show total result count
- Preserve search term in URL for shareability
- Empty state must suggest alternatives

Turkish language rules:
- Configure Meilisearch with Turkish language settings
- Enable typo tolerance appropriate for Turkish
- Stem-aware tokenization if Meilisearch version supports it
- Accent-insensitive matching (ş→s, ğ→g, etc. for typo tolerance)

When implementing search logic:
- always check document's publication status before indexing
- always remove document when product is unpublished or seller is suspended
- test that private/draft products don't appear in search results
- test facet combinations don't leak unpublished content

Never accept:
- using Meilisearch results for finance or order decisions
- indexing unpublished or draft products
- indexing suspended seller's products
- facet combination pages indexed by default
- search sync without retry mechanism
