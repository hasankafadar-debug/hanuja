// Canonical URL builders
export { getBaseUrl, absoluteUrl, canonical, absoluteCanonical } from './canonical-builder'

// Metadata builders (Next.js Metadata objects)
export {
  buildProductMetadata,
  buildCategoryMetadata,
  buildStoreMetadata,
  buildBlogPostMetadata,
  buildHomeMetadata,
  buildPublicPageMetadata,
  buildBlogListMetadata,
} from './metadata-builder'
export type {
  ProductMetaInput,
  CategoryMetaInput,
  StoreMetaInput,
  BlogPostMetaInput,
  PublicPageMetaInput,
} from './metadata-builder'

// Structured data (JSON-LD schema.org)
export {
  buildProductStructuredData,
  buildBreadcrumbStructuredData,
  buildOrganizationStructuredData,
  buildWebsiteStructuredData,
  buildDesignerStructuredData,
  buildArticleStructuredData,
  buildLocalBusinessStructuredData,
} from './structured-data'
export type {
  ProductStructuredDataInput,
  BreadcrumbItem,
  ArticleStructuredDataInput,
  LocalBusinessStructuredDataInput,
  OrganizationStructuredDataInput,
  DesignerStructuredDataInput,
} from './structured-data'

// Sitemap helpers
export {
  buildSitemapEntry,
  homeSitemapEntry,
  categorySitemapEntry,
  productSitemapEntry,
  storeSitemapEntry,
  blogSitemapEntry,
} from './sitemap-builder'
export type { SitemapEntry, SitemapEntryOptions } from './sitemap-builder'

// Robots config
export { buildRobotsConfig } from './robots-builder'

// JSON-LD React component
export { JsonLd } from './json-ld'

export { selectProductSchemaImageUrl } from './structured-data/product'
