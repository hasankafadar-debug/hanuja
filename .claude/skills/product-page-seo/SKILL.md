---
name: product-page-seo
description: Product page SEO guidance for Hanuja. Use when building or reviewing /urun/... pages, product metadata, on-page structure, internal links, schema opportunities, and duplication risk.
paths:
  - "apps/web/**/*"
  - "packages/seo/**/*"
  - "docs/04-seo/**/*"
model: sonnet
effort: high
---

This skill defines SEO standards for Hanuja product pages.

Route family:
- /urun/...

Product page purpose:
- rank for product-intent queries
- convert users with trust and clarity
- avoid duplication across store/category/product layers

Product page SEO rules:
1. Each product page must have a distinct value proposition and product identity.
2. Avoid manufacturer-copy style descriptions where possible.
3. Metadata must align with product-intent search.
4. Product content must not cannibalize category pages.
5. Product pages should include clean internal links back to relevant category/store context where useful.
6. Avoid indexable duplicate variants unless intentional.
7. Trust, shipping, return, and seller language must be accurate to the actual marketplace model.

Recommended page blocks:
- primary product title
- concise differentiating summary
- product detail content
- trust/support information
- seller/store context where useful
- related discovery blocks if they do not create crawl clutter

Metadata guidance:
- title: product + meaningful qualifier
- description: intent-matching, non-generic, non-misleading
- canonical: one primary product URL
- structured data only if implemented accurately

Reject:
- keyword stuffing
- cloned descriptions
- vague generic metadata
- multiple competing canonical targets