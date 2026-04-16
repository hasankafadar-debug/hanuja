---
name: category-page-seo
description: Category page SEO guidance for Hanuja. Use when building or reviewing /kategori/... pages, collection hierarchy, metadata, indexation, internal linking, and scalable marketplace discovery pages.
paths:
  - "apps/web/**/*"
  - "packages/seo/**/*"
  - "docs/04-seo/**/*"
model: sonnet
effort: high
---

This skill defines SEO standards for Hanuja category pages.

Route family:
- /kategori/...

Category page purpose:
- capture discovery and comparison intent
- organize product groups clearly
- scale cleanly as catalog and sellers grow

Category SEO rules:
1. Category pages must target collection/discovery intent, not product-detail intent.
2. Category metadata must be distinct from product and store pages.
3. Category pages should avoid thin indexable combinations.
4. Filtering should not automatically become crawlable SEO surface unless explicitly designed.
5. Internal links should reinforce hierarchy and discovery.
6. Category text should add useful context, not filler.
7. Category pages must not become duplicates of blog pages or store pages.

Recommended category blocks:
- category heading
- concise category intro
- curated product listing
- subcategory or sibling discovery links
- trust/discovery support blocks where useful
- structured FAQ or guide content only when genuinely valuable

Metadata guidance:
- title: category + clear commercial/discovery framing
- description: useful summary, not generic catalog filler
- canonical: stable primary category route
- indexing: prioritize meaningful category pages, not clutter

Reject:
- indexing every filter state
- generic repeated intros
- category pages with no distinct purpose
- route patterns outside approved public families