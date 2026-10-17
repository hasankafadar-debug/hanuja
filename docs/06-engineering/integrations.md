# Son güncelleme: 2026-10-16
# Durum: taslak v1

# Integrations

This document covers every external integration in the Hanuja platform: purpose, environment
variables, connection method, failure handling, and sandbox usage.

---

## 1. Iyzico — Payment Collection (standart sanal POS)

### Purpose

Iyzico is the card processor. Hanuja is the seller of record and uses a **standard** iyzico merchant
account (not marketplace; no sub-merchants). EFT/havale does not go through iyzico: it is a manual bank
transfer approved by an admin (`manual_eft`).

### What is used

| Capability | iyzico endpoint (SDK `iyzipay@2.0.67` resource) | Adapter (`api/lib/iyzico.ts`) |
|---|---|---|
| Installment options by BIN + amount | `/payment/iyzipos/installment` (`installmentInfo`) | `getInstallmentOptions` |
| 3D Secure initialise (own card form) | `/payment/3dsecure/initialize` (`threedsInitialize`) | `initiate3DS` |
| 3D Secure v2 auth (captures money) | `/payment/v2/3dsecure/auth` (`threedsV2Payment`) | `complete3DS` |
| Payment query | `/payment/detail` (`payment.retrieve`) | `retrievePayment` |
| Reporting (refund/cancel evidence) | `/v2/reporting/payment/details` (`reportingTransactionDetails`, by `paymentConversationId`) | `getPaymentReport` |
| Same-day cancel | `/payment/cancel` (`cancel`) | `cancelPayment` |
| Item refund | `/payment/refund` (`refund`, by `paymentTransactionId`) | `refundPayment` |
| Webhook | `X-IYZ-SIGNATURE-V3` | `verifyWebhookSignatureV3` |

Requests are signed by the SDK (`IYZWSv2`). Responses are verified with the `signature` field
(see `docs/05-security/payment-security.md` §3). Outcomes are `success`, `failure` (iyzico explicitly
declined) and `unknown` (network error, timeout, unverifiable signature) — `unknown` is never treated as
"no money moved".

### Installments and the installment difference

- The customer chooses the number of installments; the amount comes from iyzico `installmentInfo`
  (`totalPrice`) using the rates defined in the iyzico merchant panel ("Taksit ve Komisyon Yönetimi").
- `price` = cash total, `paidPrice` = installment total. The difference is paid by the customer and does not
  reach seller payout. Category limits: `Category.maxInstallmentCount` (inherited, minimum across the basket).
- Debit cards: single payment only. Unknown BIN (usually foreign cards): single payment at the cash price;
  acceptance is iyzico's decision.

### Environment variables

| Variable | Service | Purpose |
|---|---|---|
| `IYZICO_API_KEY` | web, worker | API key |
| `IYZICO_SECRET_KEY` | web, worker | Request signing, response and webhook signature verification |
| `IYZICO_BASE_URL` | web, worker | `https://sandbox-api.iyzipay.com` or `https://api.iyzipay.com` (production) |
| `IYZICO_CARD_PAYMENTS_ENABLED` | web | Opens new card payments (`true`); callback and webhook work regardless |

`IYZICO_WEBHOOK_SECRET` is no longer used (V3 signatures use the secret key).

### Webhook

URL: `https://www.hanuja.com.tr/api/webhooks/iyzico`. X-IYZ-SIGNATURE-V3 must be enabled on the account
(entegrasyon@iyzico.com). The route verifies the signature, stores the event (`IyzicoWebhookEvent`), returns
2xx and queues `card-payment:webhook`; processing only triggers a signed payment query. Bad signature → 401;
store failure → 503 (iyzico retries); duplicate `iyziReferenceCode` → 2xx.

### Sandbox vs production

Local and staging use sandbox keys and `https://sandbox-api.iyzipay.com`. The sandbox account must have
installment rates defined, otherwise only single payment is offered. Do not store real card numbers in tests
or fixtures; `tests/postgres/card-payment-flow.test.ts` uses a fake gateway.

### Failure handling

- Initialise failure: the attempt fails, the order stays payable for its 30-minute window.
- Lost auth response: the attempt becomes `outcome_unknown`; the `card-payment` worker reconciles it with the
  signed payment query. The order is not cancelled while money may have moved.
- Capture that cannot be attached to the order (late, duplicate, mismatched): `CardAttemptReversal`
  (same-day cancel, otherwise item refunds), reconciled from the reporting service when uncertain.
- Order refunds (`RefundTransaction`): uncertain card refund items are reconciled from the report; an admin can
  trigger "iyzico ile mutabakat" on the order detail page (audit logged).

### Still to confirm with iyzico (go-live conditions)

PCI DSS self-assessment type for the own-form direct API; whether the callback POST carries `signature`;
the accepted `identityNumber` for corporate and foreign-national buyers; the full `fraudStatus` list
(2 = approved after review, −1 = refunded by iyzico); foreign card acceptance; merchant MCC and installment
limits.

---

## 2. Meilisearch — Product Search

### Purpose

Meilisearch provides fast full-text product search for the storefront. It is a **read
projection only**. PostgreSQL is the source of truth for all business state. Meilisearch
must never be consulted for finance, order lifecycle, payout, or lifecycle decisions.

### Environment variables

| Variable                 | Purpose                                                          |
|--------------------------|------------------------------------------------------------------|
| `MEILISEARCH_URL`        | Meilisearch instance URL (default `http://localhost:7700`)       |
| `MEILISEARCH_ADMIN_KEY`  | Full-access key — server-side indexing and configuration only    |
| `MEILISEARCH_SEARCH_KEY` | Search-only key — safe for storefront server component queries   |

`MEILISEARCH_ADMIN_KEY` must never be exposed to browser bundles or included in public API
responses. It is used exclusively in `api/lib/meilisearch.ts`, `api/services/search.service.ts`,
and `api/jobs/search-index-sync.job.ts`.

`MEILISEARCH_SEARCH_KEY` is scoped to the `search` action only and may be used in Next.js
server components for storefront search queries.

### Connection method

SDK-free fetch-based HTTP client defined in `api/lib/meilisearch.ts`. All requests use
`Authorization: Bearer <key>` and `Content-Type: application/json`. There is no SDK
dependency; the client is a thin wrapper over the Meilisearch REST API.

### Indexes

**`products`** is the only active index. It is configured via `configureProductsIndex()`:

- Searchable attributes: `name`, `description`, `categoryName`, `storeName`
- Filterable attributes: `categoryId`, `categorySlug`, `sellerId`, `storeSlug`, `stock`
- Sortable attributes: `price`, `name`
- `maxValuesPerFacet`: 100

Each indexed document contains:
`id`, `slug`, `name`, `description`, `price`, `categoryId`, `categorySlug`, `categoryName`,
`sellerId`, `storeSlug`, `storeName`, `imageUrl`, `stock`

Only `PUBLISHED` products with `stock > 0` are indexed. Draft, unlisted, and rejected
products must not appear in any index.

### Sync mechanism

Index updates are triggered via the `SEARCH_INDEX_SYNC` BullMQ queue defined in
`api/jobs/search-index-sync.job.ts`. Call `enqueueProductSync()` from the catalog service
on product create, update, publish, unpublish, or delete. The worker runs with concurrency 3,
up to 3 retry attempts, and exponential backoff starting at 5 seconds.

A full re-index can be triggered via `reindexAll()` in `search.service.ts` and is intended
for admin-triggered recovery.

### Failure handling

- If Meilisearch is unavailable, the sync job fails and is retried with exponential backoff.
- Failed jobs are logged with the `[search-index-sync]` prefix and visible in the BullMQ
  job queue for operator inspection.
- Meilisearch downtime does not affect order, payment, or payout flows — those are
  PostgreSQL-backed.
- Index state is fully recoverable by running a full re-index from PostgreSQL.

### Sandbox vs production

No separate Meilisearch sandbox environment exists. Use a local Meilisearch instance
(default port 7700) for development and a dedicated instance for staging. Index state is
disposable; a full re-index restores it at any time.

---

## 3. Cloudflare R2 — Object Storage

### Purpose

Cloudflare R2 stores all media assets: product images, seller store assets, and dispute or
return evidence attachments. R2 is accessed via S3-compatible API.

### Environment variables

| Variable               | Purpose                                                |
|------------------------|--------------------------------------------------------|
| `R2_ACCOUNT_ID`        | Cloudflare account ID                                  |
| `R2_ACCESS_KEY_ID`     | R2 API token access key                                |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret key                                |
| `R2_BUCKET_NAME`       | Target bucket name (default `hanuja-media`)            |
| `R2_PUBLIC_URL`        | Public CDN base URL, e.g. `https://media.yourdomain.com` |
| `R2_PUBLIC_HOSTNAME`   | Hostname added to Next.js Image optimization allowlist |

### Connection method

AWS SDK v3 S3 client pointed at the R2 endpoint
(`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`). Presigned `PUT` URLs are generated
server-side for seller uploads. The browser uploads directly to R2 using the presigned URL —
the API server never proxies binary data.

`R2_PUBLIC_URL` and `R2_PUBLIC_HOSTNAME` are used for public media delivery and image display.
They do not control the upload target. Upload requests always go to the S3-compatible R2
endpoint derived from `R2_ACCOUNT_ID`, using `R2_BUCKET_NAME` plus the configured access key.

Production uses `https://media.hanuja.tr` as the current R2 public host. The legacy
`https://media.hanuja.com.tr` host remains recognized by the API and shared UI media helpers for
asset URLs already stored in the database, so this migration does not require a database URL
backfill.

### Browser upload compatibility

The R2 bucket CORS policy must allow the panel origins to issue `PUT` requests to the
S3-compatible endpoint. It must allow the upload `Content-Type` header and expose any response
headers the browser flow needs. This is separate from the public custom domain: `R2_PUBLIC_URL`
only serves already-uploaded media and cannot make browser uploads work.

AWS SDK v3.729.0 and later can automatically calculate CRC32 request checksums. For a browser
presigned `PutObject` URL this can sign the checksum of an empty body, causing the URL to include
`x-amz-checksum-crc32=AAAAAA==`. The browser then uploads the real file, R2 rejects the checksum,
and a missing error-response CORS header can misleadingly surface as a browser CORS/network error.

The dedicated client that creates browser presigned uploads must therefore set
`requestChecksumCalculation: 'WHEN_REQUIRED'`. Keep this setting scoped to that presign client;
server-side upload and read clients retain their normal SDK checksum behavior. Do not change
`responseChecksumValidation` for this issue.

The R2 API token must not use **Client IP Address Filtering**. A presigned URL is redeemed by the
seller's browser, so the upload request reaches R2 from that client's IP address, never from the
application server. An IP-restricted token still passes the server-side `HeadBucket` validation and
still produces a valid presigned URL, so the configuration looks correct right up to the point where
the browser `PUT` fails with `403 Forbidden` — which Chrome then reports as a CORS error, because R2
omits CORS headers on error responses. When browser uploads return `403`, check the token's IP filter
before changing bucket CORS or any other setting.

### Public access

The bucket is configured with a public custom domain (`R2_PUBLIC_URL`). Asset URLs stored
in the database use this public base. Next.js `<Image>` optimization is permitted only for
`R2_PUBLIC_HOSTNAME`.

There is no image sitemap in this project, and this hostname migration does not add one.

**Announcement media (2026-09-24).** Folder `announcements` accepts JPEG, PNG (10 MB) and MP4, WebM
(50 MB; slider videos stay at 10 MB). WebP is not accepted because the image doubles as the e-mail cover.
On confirm the server checks the file signature (PNG/JPEG header, MP4 `ftyp`, WebM EBML doctype) using a
64-byte ranged read for video. The folder is a public prefix: the files are public by unguessable URL and
the seller panel's authorization does not protect them — do not upload confidential media. Videos are
played straight from `R2_PUBLIC_URL`, because the app's media proxy has no HTTP Range support. When the
planned public-prefix allowlist (HNJ-SEC-003) is applied on the custom domain, `announcements/` must be on it.

### Authorization

- Upload: only authenticated sellers may request a presigned upload URL. The server validates
  ownership and allowed file types before generating the URL.
- Download: product images are publicly accessible via the CDN URL. Dispute or return
  attachments may be access-controlled depending on the feature implementation.
- Storage keys are generated server-side; client-supplied filenames are never used directly
  as R2 object keys.

### Failure handling

- If presigned URL generation fails, the upload flow returns an error to the seller and no
  database record is created.
- If upload setup returns `404 Not Found`, first verify `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
  `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. A wrong custom media domain alone should
  not cause upload `404`, because uploads do not use `R2_PUBLIC_URL`.
- R2 outages affect media display but do not affect order, payment, or payout logic.
- File type and size must be validated server-side before issuing a presigned URL.
- If the browser reports a CORS/network failure during the direct `PUT`, inspect the presigned URL
  for `x-amz-checksum-crc32` before changing bucket CORS. With SDK v3.729.0+, the empty-body
  checksum symptom above can be the actual cause even when preflight succeeds.

### Sandbox vs production

Use a separate R2 bucket for staging, or a local MinIO instance for development. Never
point development uploads at the production bucket.

---

## 4. Redis — Queue Backend and Rate Limiting

### Purpose

Redis serves two roles in Hanuja:

1. **BullMQ queue backend** — persists all background job queues (payout maturity, search
   sync, delivery timer, reconciliation, notifications).
2. **Rate limiting** — sliding-window counters for sensitive endpoints (login, checkout,
   payout detail changes, coupon application, etc.).

### Environment variables

| Variable    | Purpose                                                    |
|-------------|------------------------------------------------------------|
| `REDIS_URL` | Redis connection string (default `redis://localhost:6379`) |

### Connection method

`ioredis` singleton in `api/lib/redis.ts`. Created with `maxRetriesPerRequest: null` and
`enableReadyCheck: false`, both required by BullMQ. A singleton pattern prevents connection
leaks during Next.js dev hot-reload.

### BullMQ usage

BullMQ uses Redis for job persistence, delayed jobs, retry state, and worker coordination.
All queue names are defined in `api/lib/queue.ts`. Active queues include:

- `SEARCH_INDEX_SYNC` — product index upsert and delete operations
- Payout maturity jobs
- Delivery silent-confirmation timer jobs
- Reconciliation jobs
- Notification dispatch jobs

### Rate limiting usage

Sliding-window counters are stored as Redis keys with TTL. The `packages/security` rate
limiter reads and increments these counters per endpoint per identifier (IP address or
authenticated user ID).

### Failure handling

- If Redis is unreachable, BullMQ workers cannot process jobs. Finance-critical endpoints
  protected by rate limiting should fail closed when Redis is unavailable.
- Rate limiting counters are ephemeral. Job queue state is persistent and should be backed
  up in production Redis deployments.

### Sandbox vs production

Use a local Redis instance (default port 6379) for development. Staging and production must
use a persistent, dedicated Redis deployment. Do not share a Redis instance between
environments.

---

## 5. Cargo Providers — Shipment and Delivery Tracking

### Purpose

Cargo provider integrations supply shipment tracking status and delivery signals used to
drive the `delivered` and `delivery_confirmed` order lifecycle transitions. Delivery
confirmation from a cargo provider is one input into `delivery_confirmed` but not the only
valid source.

### Supported integration model

- Seller enters a tracking code in the seller panel.
- The platform polls or receives webhooks from cargo providers to update delivery status.
- When the cargo provider signals delivery, the order moves to `delivered`.
- `delivery_confirmed` is triggered only by an admin. Designer delivery reports wait for admin verification.

### Delivery confirmation

Only admin confirmation establishes delivery_confirmed. Customer confirmation and the 72-hour silent task are removed; carrier tracking and designer reports provide evidence for admin review.

### Environment variables

Cargo provider credentials are provider-specific and must be added to `.env.example` when
an integration is implemented. No provider is hardcoded. Integration adapters must be
isolated behind a stable interface in `api/` so provider-specific payload shapes do not
leak into domain logic.

### Failure handling

- Cargo status polling failures must be retried via BullMQ.
- A failed cargo status update must not block order progression. Admin can manually mark
  delivery status when required.
- Cargo provider downtime must not affect payout eligibility logic; admin override exists
  for confirmed delivery.

### Sandbox vs production

Each cargo provider has its own sandbox or test environment. Never point development or
staging at a live carrier account that generates real shipment events or charges.

---

## 6. Resend — Transactional and Campaign Email

### Purpose

Resend is the production SMTP provider for all outbound Hanuja email: password reset,
order/shipment/delivery notifications, invoice notices, return/dispute updates,
payout/penalty notices, and the marketing campaign emails (discount-on-favorite /
discount-on-cart-item). Resend is reached through the standard SMTP interface
(`api/lib/mailer.ts`) — there is no Resend SDK dependency, only the Resend SMTP
endpoint with an API key as the password.

> **Migration note (2026-07-18):** Resend replaces Amazon SES, whose production access
> request was never approved (the account stayed in sandbox). No application code
> changed — the mailer is provider-agnostic SMTP — only env values and DNS records
> did. See "Legacy SES records" below.

### Domain identity and DNS records

Resend verifies the `hanuja.com.tr` domain identity (region `eu-west-1`) using a
**DKIM TXT record** plus a **return-path subdomain** (`send.hanuja.com.tr`) so
bounce/complaint traffic does not collide with the corporate inbox:

| Record type | Host | Points to / value | Purpose |
|---|---|---|---|
| TXT | `resend._domainkey.hanuja.com.tr` | DKIM public key shown in the Resend dashboard | DKIM signing |
| MX | `send.hanuja.com.tr` | Resend feedback endpoint shown in the dashboard (priority 10) | Return-path subdomain — bounce/complaint delivery |
| TXT | `send.hanuja.com.tr` | SPF value shown in the dashboard (`v=spf1 include:…`) | SPF for the return-path subdomain |

Record values are the exact ones shown in the Resend dashboard for the `hanuja.com.tr`
domain; they are not fixed strings and must be copied from Resend at setup time.

### Coexistence with Promail (root domain mail) — do not touch root records

`hanuja.com.tr`'s root **MX and SPF** records belong to Promail and route the corporate
inbox (`admin@hanuja.com.tr`). Resend is added entirely on the `send.hanuja.com.tr`
subdomain and via the `resend._domainkey` DKIM TXT — **root MX and root SPF are never
modified** for Resend. This is intentional and required: changing the root MX would
break inbound corporate mail, and changing the root SPF would risk breaking Promail's
outbound authentication.

DMARC (`p=none`, pre-existing on the domain) passes for Resend-sent mail via **DKIM
alignment** (the DKIM `d=` domain matches `hanuja.com.tr`), independent of the SPF
record used for the return-path subdomain. Do not raise DMARC enforcement
(`p=quarantine` / `p=reject`) without re-verifying both Promail and Resend alignment
first.

### SMTP endpoint and credentials

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` (implicit TLS; `587` STARTTLS also supported) |
| `SMTP_USER` | `resend` (literal string) |
| `SMTP_PASS` | Resend API key (Sending access) |

These four variables are set identically across all four Coolify services (`web`,
`seller-panel`, `admin-panel`, `worker`) — see `docs/06-engineering/coolify-setup.md`.

### Sender categories and Reply-To

`api/lib/mailer.ts` resolves the `From` address per `EmailFromCategory`, falling back to
`SMTP_FROM` and then a hardcoded default if the category-specific variable is unset:

| Category | Env var | Used for | Reply-To |
|---|---|---|---|
| `noreply` | `EMAIL_FROM_NOREPLY` | Default — password reset, order/shipment/delivery, return/dispute, payout/penalty notices | none |
| `fatura` | `EMAIL_FROM_FATURA` | `invoice_uploaded` (seller invoice notice to customer) | `admin@hanuja.com.tr` |
| `kampanya` | `EMAIL_FROM_KAMPANYA` | `product_discount_in_cart`, `product_price_drop` (phase 6; `store_discount_followed_seller` and `product_discount_favorited` are closed) | none |

Every `EMAIL_FROM_*` address must be at the Resend-verified domain (verifying the
`hanuja.com.tr` domain covers all addresses at that domain — no separate per-address
verification is needed as long as the domain status is `Verified`).

### Plan and quota limits

Resend has no sandbox / recipient-allowlist concept: once the domain is `Verified`,
mail can be delivered to any recipient. Sending volume is limited by the Resend plan
instead:

- Free tier: 100 emails/day, 3,000 emails/month — enough for smoke tests and low
  transactional volume, **not** enough for campaign fan-out.
- Before enabling broad campaign sends (`campaign-discount` fan-out), upgrade to a
  paid plan sized for the expected daily volume.
- API/SMTP rate limits also apply (default ~2 requests/second); the notification
  dispatch queue's retry/backoff absorbs transient throttling.

### Legacy SES records — kept as a warm fallback (business decision, 2026-07-18)

The previous provider's DNS records (3 Easy DKIM CNAMEs pointing at
`*.dkim.amazonses.com` and the `ses.hanuja.com.tr` MX/TXT MAIL FROM subdomain) and the
SES SMTP credential are **intentionally kept active** as a fallback: if AWS ever grants
the pending SES production access, switching back is a pure env swap
(`SMTP_HOST`/`PORT`/`USER`/`PASS` in Coolify) with no code or DNS change. The records
are harmless alongside Resend's. Because the SES credential was handled during
migration ops, rotating it in the AWS console (issue new SMTP credential, delete old)
is recommended at the next convenient opportunity.

### Environment variables

| Variable | Purpose |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` (literal string) |
| `SMTP_PASS` | Resend API key |
| `SMTP_FROM` | Fallback `From` address if a category-specific `EMAIL_FROM_*` is unset |
| `EMAIL_FROM_NOREPLY` | `noreply` category sender override |
| `EMAIL_FROM_FATURA` | `fatura` category sender override |
| `EMAIL_FROM_KAMPANYA` | `kampanya` category sender override |

`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` are `requiredInProd` in
`tools/scripts/check-env.ts`. `EMAIL_FROM_*` are optional (they fall back to `SMTP_FROM`)
but should be set explicitly in production so each category uses a distinct sender
address.

### Failure handling

- If SMTP credentials are missing, `api/lib/mailer.ts` falls back to Nodemailer's
  `jsonTransport` and logs the email to console instead of sending — this is a
  development-only fallback and must never be relied on in production
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are `requiredInProd`).
- Bounces and complaints are collected by Resend via the `send.hanuja.com.tr`
  return-path subdomain and surfaced in the Resend dashboard (Emails log and
  suppression list); they do not land in the Promail corporate inbox. There is no
  app-side bounce/complaint webhook yet — tracked as a deferred open item.
- Provider throttling or a failed send must not block the underlying business action
  (e.g. invoice upload, order confirmation) — email send failures should be logged and
  are not transactional with the state change they describe.

---

## 7. Cloudflare Turnstile — Human Verification

### Purpose

Cloudflare Turnstile protects public-facing and operator-facing form submissions from automated
abuse. In Hanuja it is used on:

- Admin login
- Seller login
- Seller onboarding
- Customer login
- Customer signup
- Storefront checkout

### Environment variables

| Variable | Purpose |
|------------------------------|----------------------------------------------------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-visible site key rendered in the widget     |
| `TURNSTILE_SECRET_KEY`           | Server-side secret used for `siteverify`            |

### Connection method

The shared widget loader lives in `packages/ui/src/components/turnstile-widget.tsx`. Server-side
verification is centralized in `api/lib/turnstile.ts`, which calls Cloudflare's `siteverify`
endpoint and optionally validates the expected action value.

### Hostname policy

The widget's Cloudflare hostname allowlist must include every app surface that renders it:

- `localhost`
- `127.0.0.1`
- `www.hanuja.com.tr`
- `satici.hanuja.com.tr`
- `admin.hanuja.com.tr`

Add staging domains separately before enabling Turnstile there.

### Test keys vs real keys

Cloudflare's official Turnstile test keys show a visible "testing only" warning inside the widget.
Use a real widget/secret pair in normal app environments if you do not want that banner to appear.

### Failure handling

- If `TURNSTILE_SECRET_KEY` is missing in production, verification fails closed.
- If the widget site key is missing in development, the client falls back to the development bypass flow.
- Verification errors should show a user-friendly retry message and must not silently skip server verification.

### Sandbox vs production

Hanuja does not maintain a separate browser-visible test-key setup for normal app use. Local,
staging, and production should all use real widget credentials scoped by Cloudflare hostname
allowlists. Automated tests may still mock the widget for regression coverage, but that does not
count as production-equivalent Turnstile validation.

---

## Cross-references

- `api/lib/meilisearch.ts` — Meilisearch fetch client and index configuration
- `api/lib/redis.ts` — Redis singleton for BullMQ and rate limiting
- `api/services/search.service.ts` — Search query orchestration and reindex logic
- `api/jobs/search-index-sync.job.ts` — BullMQ worker for index sync
- `.env.example` — All environment variable placeholders
- `docs/05-security/secrets-env-policy.md` — Secret handling rules
- `docs/05-security/payment-security.md` — Iyzico security constraints
- `docs/06-engineering/caching-search-plan.md` — Search projection and cache strategy
- `docs/06-engineering/turnstile.md` — Turnstile setup and manual QA
- `docs/06-engineering/queue-jobs-plan.md` — Full queue job inventory
- `docs/07-operations/order-lifecycle.md` — Delivery confirmation logic and payout trigger
