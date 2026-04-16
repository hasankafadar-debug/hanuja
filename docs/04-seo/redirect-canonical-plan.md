# Redirect canonical plan

Defines how Hanuja handles URL changes, canonical selection, and redirect mapping.

## Key points
- canonical URLs must always point to the primary route for a resource
- when a slug changes, old URL must 301 redirect to new canonical URL
- redirect creation must be logged and testable
- route changes must be evaluated together with `seo-url-slug-rules.md`

## Canonical rules
- one primary URL per resource type
- do not canonicalize across different resource types
- query parameter variants should normally point back to the clean canonical route

## Redirect rules
- preserve old-to-new path mapping
- avoid redirect chains
- avoid creating competing live URLs for the same resource

## Cross-reference
Read together with:
- `seo-url-slug-rules.md`
