# Product brand and merchant schema release

Product brand is independent of designer identity. Single-product and Excel creation require an explicit brand. The shared formatter prefixes names exactly once. Existing slugs and historical order snapshots stay unchanged; internal barcodes are not GTIN.

## Expand release

1. Complete tests, lint, typecheck and application builds. Commit only task files and push the current release branch.
2. Deploy worker first: migration 20261017180000_add_product_brand adds a nullable column without a default. Verify migration completion before deploying admin, seller and web in order.
3. In the new worker run pnpm exec tsx tools/scripts/backfill-product-brand.ts, inspect its counts/audit, then run it with --apply. It targets only the active mosaiss designer, uses compare-and-set updates, preserves slugs/prices/stocks, and queues all its products for search sync. A repeat --apply repairs an interrupted indexing pass.
4. Verify expected product counts, zero missing/blank brands and current app deployments. Unexpected designers require explicit brand data.

## Contract release

After all writers enforce brand and backfill verification succeeds, add the required-column/check migration and make Prisma Product.brand required. Deploy worker/migration before the remaining apps. Before an old-code rollback, make the column nullable if that code creates brandless products.

## Live verification

Check titles/unchanged URLs; JSON-LD real public images, brand, Hanuja seller and current TR/TRY shipping; return policy Organization link; and Excel brand validation. Google Rich Results Test must show no critical merchant image error. Unreviewed products can retain optional review/rating warnings. Search Console validation requires the verified property; recrawl/report processing is asynchronous.
