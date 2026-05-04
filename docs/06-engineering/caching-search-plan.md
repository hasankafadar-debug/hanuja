# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Caching and Search Plan

This document covers Meilisearch as a read projection, index sync triggers, indexed content
rules, Next.js cache strategy, Redis roles, and search key separation.

---

## Core principle

PostgreSQL is the single source of truth for all business state.

Meilisearch is a **read projection** — a derived, disposable index built from PostgreSQL
data. It must never be consulted for:

- finance decisions
- payout eligibility
- order lifecycle state
- penalty or refund amounts
- seller visibility rules

If Meilisearch data conflicts with PostgreSQL, PostgreSQL wins. The index can always be
rebuilt from PostgreSQL via a full re-index.

---

## Meilisearch — Read Projection Rules

### What gets indexed

The `products` index contains one document per published, in-stock product.

Fields indexed per document:

| Field          | Source                           |
|----------------|----------------------------------|
| `id`           | `product.id`                     |
| `slug`         | `product.slug`                   |
| `name`         | `product.name`                   |
| `description`  | `product.description`            |
| `price`        | `product.price` (as float)       |
| `categoryId`   | `product.category.id`            |
| `categorySlug` | `product.category.slug`          |
| `categoryName` | `product.category.name`          |
| `sellerId`     | `product.sellerId`               |
| `storeSlug`    | `seller.profile.storeSlug`       |
| `storeName`    | `seller.profile.storeName`       |
| `imageUrl`     | Primary `mediaAsset.url` or null |
| `stock`        | `product.stock`                  |

### Index configuration

Configured once via `configureProductsIndex()` in `api/lib/meilisearch.ts`:

- Searchable: `name`, `description`, `categoryName`, `storeName`
- Filterable: `categoryId`, `categorySlug`, `sellerId`, `storeSlug`, `stock`
- Sortable: `price`, `name`
- `maxValuesPerFacet`: 100

### Non-indexable states

A product must be removed from the index (or never added) if any of these are true:

- `status` is `DRAFT`
- `status` is `UNLISTED`
- `status` is `REJECTED`
- `status` is `PENDING_REVIEW`
- `stock <= 0`
- product is deleted

When `reindexProduct()` is called for a product in a non-indexable state, the service
calls `removeFromIndex()` rather than adding the document. This ensures the index never
contains stale non-public entries.

---

## Index Sync via BullMQ

### Trigger points

The catalog service must call `enqueueProductSync()` for the following events:

| Event                     | Operation |
|---------------------------|-----------|
| Product created           | `upsert`  |
| Product updated           | `upsert`  |
| Product published         | `upsert`  |
| Product unpublished       | `delete`  |
| Product stock changed     | `upsert`  |
| Product rejected/unlisted | `delete`  |
| Product deleted           | `delete`  |

### Job configuration

Queue: `SEARCH_INDEX_SYNC` (defined in `api/lib/queue.ts`)
Worker: `api/jobs/search-index-sync.job.ts`
Concurrency: 3
Retry attempts: 3
Backoff: exponential, 5 s base

### Job data shape

```typescript
interface SearchIndexSyncJobData {
  type: 'product' | 'category' | 'store'
  entityId?: string   // undefined = full re-index
  operation: 'upsert' | 'delete'
}
```

### Full re-index

Triggered via the admin panel or CLI via `reindexAll()` in `search.service.ts`. The
function queries all `PUBLISHED` products with `stock > 0` from PostgreSQL and sends them
to Meilisearch in one batch. A full re-index is the recovery path when the index is
corrupted or out of sync.

### Idempotency

Both `upsert` and `delete` operations are safe to retry:

- `upsert` to Meilisearch is an HTTP `POST` to the documents endpoint, which overwrites
  existing documents with the same primary key.
- `delete` uses `DELETE /indexes/products/documents/:id`; a 404 from Meilisearch is treated
  as success and does not cause a retry.

---

## Search Key Separation

Two keys must exist in a production Meilisearch instance:

| Key                      | Actions     | Used in                                           |
|--------------------------|-------------|---------------------------------------------------|
| `MEILISEARCH_ADMIN_KEY`  | `*` (all)   | Server-side indexing, `configureProductsIndex()`, sync job |
| `MEILISEARCH_SEARCH_KEY` | `search` only | Storefront server components, `searchProducts()` |

`MEILISEARCH_ADMIN_KEY` must never appear in browser bundles, public API responses, or
client-side code. It belongs in server-only modules only.

`MEILISEARCH_SEARCH_KEY` is safe to use in Next.js server components that run on the server.
It must not be used to perform write or configuration operations.

Keys are generated from a running Meilisearch instance using the master key:

```bash
curl -X POST 'http://localhost:7700/keys' \
  -H 'Authorization: Bearer <MEILI_MASTER_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin Key","actions":["*"],"indexes":["*"],"expiresAt":null}'
```

---

## Next.js Cache Strategy

### Cache boundaries

The storefront (`apps/web`) uses Next.js App Router with React server components. Caching
follows the Next.js `fetch` cache and `unstable_cache` / `cache()` model with revalidation
tags.

### Tag conventions

| Tag pattern                      | Invalidated when                                   |
|----------------------------------|----------------------------------------------------|
| `product:<slug>`                 | Product is updated, published, or unpublished      |
| `product-list:<categorySlug>`    | Any product in the category is updated             |
| `category:<slug>`                | Category metadata is updated                       |
| `store:<storeSlug>`              | Seller profile or store page content changes       |
| `blog:<slug>`                    | Blog post is published or updated                  |
| `homepage`                       | Featured products or homepage content changes      |

### On-demand revalidation

After a product update or status change, the catalog service calls Next.js on-demand
revalidation via `revalidateTag()`. This clears the affected cached entries without
requiring a full redeploy.

On-demand revalidation requires `NEXT_PUBLIC_APP_URL` and an internal revalidation secret
(not currently in `.env.example` — add `REVALIDATION_SECRET` when wiring this up).

### Static vs dynamic pages

- Category listing pages: statically generated with `revalidate` interval or on-demand
  invalidation on product change.
- Product detail pages: statically generated per slug; invalidated on product update.
- Search results (`/arama`): fully dynamic — not cached at the page level. Results come
  from Meilisearch at request time.
- Order, account, and seller panel pages: fully dynamic and never statically cached.

### Cache must not be used for

- Order state
- Payment status
- Payout eligibility
- Seller-specific finance data
- Admin panel data

All finance and lifecycle data must come from PostgreSQL at request time with no
intermediate cache layer.

---

## Redis — Roles in Caching and Queue

Redis is not used as an application-level data cache (no Redis-backed page or query
caching). Its two roles are:

### 1. BullMQ queue persistence

Redis is the persistent store for all BullMQ job queues. Job state (pending, active,
completed, failed, delayed) is held in Redis. Workers read jobs from Redis and write results
back to PostgreSQL. Redis job state survives server restarts in production.

### 2. Rate limiting

Sliding-window rate limiting counters are stored in Redis with TTL. Each counter key
encodes the endpoint and the client identifier (IP or user ID). The `packages/security`
rate limiter increments and reads these counters without maintaining any in-process state.

Redis is **not** used for:

- Meilisearch query result caching
- Next.js page caching
- Session storage (sessions are stored in PostgreSQL via Better Auth)
- Finance or order state caching

---

## Search in the Storefront

### Storefront search flow

1. User submits a search query at `/arama`.
2. The Next.js server component calls `searchProducts()` in `search.service.ts`.
3. `searchProducts()` calls `searchIndex()` in `api/lib/meilisearch.ts` using
   `MEILISEARCH_ADMIN_KEY` (server-side) or a scoped `MEILISEARCH_SEARCH_KEY`.
4. Meilisearch returns hits. The server component renders results.
5. Results are not cached at the page level; each request queries Meilisearch.

### Category listing with search filter

Category pages may optionally use Meilisearch for in-category search with facet filtering.
Unfiltered category listings may be served from PostgreSQL and statically cached.

### Search does not affect finance or lifecycle

Search results are display-only. Adding a product to the cart, confirming an order, or
checking payout eligibility always queries PostgreSQL directly, never Meilisearch.

---

## Failure Modes and Recovery

| Failure                        | Impact                         | Recovery                                      |
|--------------------------------|--------------------------------|-----------------------------------------------|
| Meilisearch unreachable        | Search returns empty or error  | BullMQ sync retries; admin triggers re-index  |
| Stale index entry              | Product shown that is out of stock | Sync job corrects on next trigger          |
| Redis unreachable              | BullMQ stops; rate limiting fails | Investigate Redis; restart workers after fix |
| Next.js cache not invalidated  | Stale product page shown       | On-demand revalidation or deploy              |

---

## Cross-references

- `api/lib/meilisearch.ts` — Meilisearch client and `configureProductsIndex()`
- `api/lib/redis.ts` — Redis singleton
- `api/services/search.service.ts` — `searchProducts()`, `reindexProduct()`, `reindexAll()`
- `api/jobs/search-index-sync.job.ts` — BullMQ worker and `enqueueProductSync()`
- `docs/06-engineering/integrations.md` — Integration details for all external services
- `docs/06-engineering/queue-jobs-plan.md` — Full BullMQ queue job inventory
- `.claude/rules/01-architecture.md` — Search must not be source of truth
- `.claude/rules/07-marketplace-finance-rules.md` — Finance decisions must use PostgreSQL
