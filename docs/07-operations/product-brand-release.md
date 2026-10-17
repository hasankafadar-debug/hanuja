# Product brand and merchant schema release

Product brand is independent of designer identity. Single-product and Excel creation require an explicit brand. The shared formatter prefixes names exactly once. Existing slugs and historical order snapshots stay unchanged; internal barcodes are not GTIN.

## Expand release

1. Complete tests, lint, typecheck and application builds. Commit only task files and push the current release branch.
2. Deploy worker first: migration 20261017180000_add_product_brand adds a nullable column without a default. Verify migration completion before deploying admin, seller and web in order.
3. In the new worker run pnpm exec tsx tools/scripts/backfill-product-brand.ts, inspect its counts/audit, then run it with --apply. It targets only the active mosaiss designer, uses compare-and-set updates, preserves slugs/prices/stocks, and queues all its products for search sync. A repeat --apply repairs an interrupted indexing pass.
4. Verify expected product counts, zero missing/blank brands and current app deployments. Unexpected designers require explicit brand data.

## Contract release

After all writers enforce brand and backfill verification succeeds, migration 20261017190000_require_product_brand makes the column required and rejects whitespace-only values; Prisma Product.brand is required. Deploy worker/migration before the remaining apps. Before an old-code rollback, make the column nullable if that code creates brandless products.

## Live verification

Check titles/unchanged URLs; JSON-LD real public images, brand, Hanuja seller and current TR/TRY shipping; return policy Organization link; and Excel brand validation. Google Rich Results Test must show no critical merchant image error. Unreviewed products can retain optional review/rating warnings. Search Console validation requires the verified property; recrawl/report processing is asynchronous.

## Verified production backfill (2026-10-17)

- 92 Mosaiss products updated; repeat apply changed 0, missing brands 0.
- Slug, price, comparison price, stock and status hash remained identical.
- All 9 historical order lines and 9 legal document snapshots retained their hashes.
- Audit files were preserved outside the worker and in the ignored local release folder.
- All 79 public products matched the rebuilt search index and passed live image/brand/shipping JSON-LD checks; the return policy link passed.
- Actual shipping settings at verification: free from TRY 1500, otherwise TRY 150.
- The public test requested sign-in; the owner supplied an authenticated Chrome Search Console session for Google verification.

## Merchant warning follow-up (2026-10-18)

- Product offers reference the published organization return policy by its existing @id, as supported by Google's merchant listing guide; the legal policy and its exceptions remain authoritative.
- The owner confirmed a domestic transit estimate of 2–5 business days after dispatch. Product pages show the same estimate used in shippingDetails.deliveryTime.
- handlingTime is 0 through the product's existing fulfillmentDays; transitTime is separately 2 through 5. Business days are Monday through Friday; the schema does not predict an exact delivery date.
- This follow-up affects the storefront only: verify relevant tests/lint/typecheck and web build, commit/push task files, deploy hanuja-web through Coolify, then verify live JSON-LD and Google Rich Results Test.
- Google's pre-deploy code test accepted the policy @id reference and delivery ranges with no merchant-listing warnings (result wfkoz20XMJilfwvTSoMCuw); rating/review warnings remain outside this two-warning follow-up.
