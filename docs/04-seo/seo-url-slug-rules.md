# SEO URL slug rules

This file locks route namespaces and slug behavior early to avoid expensive later migrations.

## Route namespaces
- category pages: `/kategori/...`
- product pages: `/urun/...`
- blog pages: `/blog/...`
- store pages: `/magaza/...`

## Why namespace routes
- prevents slug collisions across resource types
- keeps routing explicit
- reduces canonical ambiguity
- makes redirects easier to manage

## Slug normalization
- convert Turkish characters to ASCII-safe equivalents where needed
- lowercase all slugs
- replace spaces with hyphens
- collapse repeated separators
- remove leading/trailing separators

## Uniqueness rules
- slug uniqueness should be enforced within each resource type
- cross-type collisions are acceptable only because route namespaces differ
- historical slug changes must be recorded for redirects

## Change management
If a slug changes:
1. create redirect from old URL to new URL
2. update canonical output
3. update internal links where possible
4. review sitemap impact
5. review analytics continuity

## Cross-reference
Read together with:
- `redirect-canonical-plan.md`
