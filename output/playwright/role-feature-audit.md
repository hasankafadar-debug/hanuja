# Role Feature Audit

Date: 2026-04-27

Scope: browser smoke/regression pass across customer storefront, customer account, seller panel, admin panel, role boundaries, and critical security/service tests.

## Customer Public

- PASS: Home, register, forgot password, category, product detail, store, search page, blog, contact, and legal pages loaded.
- PASS: Search page `/arama?q=sehpa` loaded after restarting web with higher Node heap.
- FAIL/GAP: Default web dev server crashed with JavaScript heap out of memory while compiling `/arama`.
- FAIL/GAP: Product/blog/list images repeatedly returned `_next/image` 500 because `cdn.hanuja.com.tr` did not resolve locally.
- FAIL/GAP: `/api/search` returned `{ success, data: { hits... } }`, while the A4 contract says response should be root-level `hits, totalHits, page, limit, totalPages...`.

## Customer Account

- PASS: Customer login worked with `playwright-eft@hanuja.test`.
- PASS: `/hesabim`, `/hesabim/adresler`, `/siparis`, `/siparis/[id]`, `/faturalarim` loaded.
- PASS: Faturalarim page loaded without exposing customer email/phone in visible body.
- PASS: Product add-to-cart posted successfully and `/sepet` loaded.
- GAP: Full checkout/order creation was not completed in this pass. The cart page loaded, but the payment transition was not fully asserted end-to-end.

## Seller Panel

- PASS: Seller login worked with `satici@woodform.com`.
- PASS: Dashboard, orders, order detail, shipments, payments, accounting statement, products, new product, edit product, bulk upload, bulk update, legacy import, discounts, new discount, returns, support, media, and settings pages loaded.
- PASS: Seller order detail showed invoice alias `pf721a6be58f@fatura.hanuja.tr`.
- PASS: Seller order detail did not expose customer email/phone.
- FAIL/GAP: Seller reject button did not expose the expected dialog in the browser check. Needs UI follow-up for reject reason/penalty warning flow.
- GAP: Return/dispute/support detail messaging could not be deeply exercised because local seed DB has no return request, dispute, or support ticket records.
- GAP: Product create/update submit and manual invoice upload were not fully submitted because they require realistic file/media inputs.

## Admin Panel

- PASS: Admin login worked with `admin@hanuja.com.tr`.
- PASS: Dashboard, orders, order detail, sellers, seller detail, bank changes, products moderation, product moderation detail, penalties, disputes, returns, payments, payouts, finance, audit, support, home CMS, media, and settings pages loaded.
- PASS: Manual penalty modal opened from order detail.
- PASS: Product moderation reject UI opened from product detail.
- PASS: Admin login redirect bug was fixed earlier: default callback now goes to `/dashboard`, not `/panel`.

## Security / Role Boundaries

- PASS: Seller could not enter admin dashboard in browser check.
- PASS: Inbound Postmark webhook returned `403` for unknown alias.
- PASS: Targeted tests passed: contact-sharing guard, content scanner, invoice aliasing, seller cannot see customer email, search service, and search index sync.

## Typecheck / Tests

- PASS: `pnpm --filter web typecheck`
- PASS: `pnpm --filter seller-panel typecheck`
- PASS: `pnpm --filter admin-panel typecheck`
- PASS: `pnpm --filter @hanuja/tests test -- unit/services/contact-sharing-guard.service.test.ts unit/services/order-document-alias.service.test.ts security/seller-cannot-see-customer-email.test.ts unit/services/content-scanner.service.test.ts unit/jobs/search-index-sync.job.test.ts unit/services/search.service.test.ts`

## Priority Fix List

1. Fix web dev/build memory pressure around `/arama`; default `next dev` OOM is a real productivity/CI risk.
2. Align `/api/search` response with the A4 public contract or formally update the contract to allow `{ success, data }`.
3. Provide a local image fallback or fixture CDN configuration; current `cdn.hanuja.com.tr` DNS failure causes many `_next/image` 500s.
4. Fix/verify seller reject modal flow; reason and penalty warning should be visible before submit.
5. Add seed fixtures for return, dispute, and support ticket detail flows so messaging/contact guard can be browser-tested.
6. Add an end-to-end checkout happy path and invoice upload/Postmark ingest fixture path.
