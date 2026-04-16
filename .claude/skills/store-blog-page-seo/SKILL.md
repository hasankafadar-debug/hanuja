---
name: store-blog-page-seo
description: Apply Hanuja SEO standards for store (/magaza/) and blog (/blog/) pages. Use when implementing seller storefront pages or editorial blog pages including metadata, structured data, and canonical rules.
user-invocable: false
paths:
  - "apps/web/src/app/(storefront)/magaza/**/*"
  - "apps/web/src/app/(storefront)/blog/**/*"
  - "packages/seo/**/*"
model: sonnet
effort: medium
---

This skill defines SEO standards for Hanuja store and blog pages.

## Store Pages (/magaza/{store-slug})

Route pattern: `/magaza/[store-slug]`

Indexability:
- Index only active sellers with sufficient product depth (min. 3+ published products)
- Noindex: suspended, incomplete, or low-quality seller pages
- Noindex: seller pages with 0 published products

Title tag pattern:
`{StoreName} | Mağaza | {BrandName}`
Example: `Atelier Noa | Mağaza | Hanuja`

Meta description pattern:
`{StoreName} mağazasında {category_hint} ürünleri keşfedin. {product_count}+ ürün, hızlı teslimat.`

Canonical rule:
- Self-referencing canonical to clean `/magaza/{store-slug}` URL
- No trailing slash
- No query parameters in canonical

Open Graph:
- og:title — store display name
- og:description — store bio excerpt (max 160 chars)
- og:image — store banner/avatar (fallback to brand default)
- og:type — "website"

Structured data (LocalBusiness or Organization):
```json
{
  "@type": "Store",
  "name": "{StoreName}",
  "url": "https://example.com/magaza/{store-slug}",
  "image": "{store_banner_url}",
  "description": "{store_bio}"
}
```

Store slug rules:
- Lowercase Turkish-to-ASCII normalized
- Hyphens as separators
- Max 60 characters
- Must be unique
- Changing store slug requires 301 redirect from old to new

Internal linking from store page:
- Link to store's product listings
- Link to relevant category pages
- Breadcrumb: Ana Sayfa > Mağazalar > {StoreName}

---

## Blog Pages (/blog/{post-slug})

Route pattern: `/blog/[post-slug]`

Indexability:
- Index: published posts with meaningful content
- Noindex: draft, scheduled, archived posts
- Noindex: very short posts (under 300 words)

Title tag pattern:
`{PostTitle} | Blog | {BrandName}`
Example: `Küçük Salon için Mobilya Seçimi | Blog | Hanuja`

Meta description:
- Use explicitly written meta description field
- If empty, use first 160 chars of post body (trimmed, no HTML)

Canonical rule:
- Self-referencing canonical to clean `/blog/{post-slug}`
- No pagination ambiguity (canonical to first page for paginated posts if any)

Open Graph:
- og:type — "article"
- og:title — post title
- og:description — meta description
- og:image — featured image
- article:published_time — ISO 8601
- article:modified_time — ISO 8601
- article:author — author display name

Structured data (Article):
```json
{
  "@type": "Article",
  "headline": "{PostTitle}",
  "datePublished": "{published_at_iso}",
  "dateModified": "{updated_at_iso}",
  "author": { "@type": "Person", "name": "{author_name}" },
  "image": "{featured_image_url}",
  "publisher": { "@type": "Organization", "name": "{BrandName}" }
}
```

Blog slug rules:
- Turkish-to-ASCII normalized, lowercase, hyphen-separated
- Descriptive — reflects post topic
- Max 80 characters
- Must be unique
- Changed slugs require 301 redirect

Internal linking from blog:
- Link to relevant category pages naturally
- Link to featured products mentioned in article
- Breadcrumb: Ana Sayfa > Blog > {PostTitle}
- Related posts section (up to 3 related articles)

Blog SEO anti-patterns to avoid:
- Blog posts that duplicate category page intent
- Shallow AI-generated content under 300 words
- Multiple posts with identical structure and swapped keywords
- Posts with no internal links to product/category pages

---

## generateMetadata() implementation pattern:

```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  const entity = await fetchEntityBySlug(params.slug)
  if (!entity) return { robots: { index: false } }
  
  return {
    title: buildTitle(entity),
    description: buildDescription(entity),
    alternates: { canonical: buildCanonicalUrl(entity) },
    openGraph: buildOpenGraph(entity),
  }
}
```

Never accept:
- Hardcoded title/description strings in page files
- Missing canonical on indexed pages
- og:image pointing to local/unoptimized image
- Structured data that conflicts with visible page content
- Index allowed for suspended/draft content
