# Controlled catalog import CLI

This is an operation-only CLI. It does not add a UI, API route, background service, or database migration. Source workbooks are read-only; all reports, normalized JSON, manifests, and image cache files belong under `.tmp/`.

```powershell
pnpm catalog-import discover --input H:\Scarping\outputs\hipicon_mosaiss\hipicon_mosaiss_urunler_updated.xlsx --profile tools\catalog-import\profiles\hipicon.json --output .tmp\catalog-import\mosaiss-mapping.json
pnpm catalog-import normalize --input H:\Scarping\outputs\hipicon_mosaiss\hipicon_mosaiss_urunler_updated.xlsx --profile tools\catalog-import\profiles\hipicon.json --output .tmp\catalog-import\mosaiss.normalized.json
pnpm catalog-import dry-run --input .tmp\catalog-import\mosaiss.normalized.json --store mosaiss --display-name Mosaiss
pnpm catalog-import apply --manifest .tmp\catalog-import\audits\manifest-<timestamp>.json --confirm-store mosaiss
pnpm catalog-import verify --manifest .tmp\catalog-import\audits\manifest-<timestamp>.json
```

`discover` and `normalize` use only the local workbook. `normalize` also writes a `*.mapping-report.json` and returns non-zero on blocking mapping errors. `dry-run`, `apply`, and `verify` require the repository's production-like `DATABASE_URL` and R2 environment. Dry-run never mutates DB/R2. Apply accepts only an unexpired manifest with the same normalized data hash and an exact `--confirm-store` value. Verify checks DB/R2 and at most three CDN `HEAD` samples; it never mass-redownloads images. Standard output stays compact; full detail is written to the referenced JSON audit/manifest.

The Hipicon profile maps the approved Mosaiss six category paths and intentionally treats every row as a single, variantless product. Images are fetched only from public HTTP(S), revalidated after redirects/DNS resolution, signature-checked as JPEG/PNG/WebP, capped at 10 MB, cached by SHA-256, then uploaded to R2 during apply.
