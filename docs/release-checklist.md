# Hanuja — Release Checklist

This checklist governs every production release and new client deployment.
All items must be verified before traffic goes live.

---

## A. New Client Brand Swap

Use this section when deploying a new client marketplace from the Hanuja template.

### A1. Brand Config
- [ ] Run `pnpm new-client --name="..." --primary="#..." --accent="#..."` to generate brand file
- [ ] Open `packages/config/brand/{slug}.brand.ts` — verify all colors, fonts, and radius values
- [ ] Run `pnpm validate-brand --brand={slug}` — must exit 0
- [ ] Run `pnpm brand-swap --brand={slug} --dry-run` — review output
- [ ] Run `pnpm brand-swap --brand={slug}` — applies CSS to all 3 apps
- [ ] Replace `apps/web/public/logo.*` and `favicon.ico` with client logo
- [ ] Update `apps/*/src/app/layout.tsx` font imports if fonts changed from default
- [ ] Run `pnpm dev` — visually verify brand across storefront, seller panel, admin panel

### A2. Content and Seed
- [ ] Review `db/seeds/seed.ts` — replace Hanuja-specific placeholder data with client content
- [ ] Verify category structure matches client's product taxonomy
- [ ] Verify seed admin email / credentials match client's initial admin setup

---

## B. Environment Configuration

### B1. Variables
- [ ] Copy `.env.example` → `.env` (production values)
- [ ] Set all variables — especially those marked sensitive in `.env.example`
- [ ] Run `pnpm check-env --env=prod` — must exit 0 with no missing vars
- [ ] Confirm `IYZICO_BASE_URL` is the **live** URL, not sandbox
- [ ] Confirm `BETTER_AUTH_SECRET` is at least 32 characters and randomly generated
- [ ] Confirm `MEILISEARCH_ADMIN_KEY` and `MEILISEARCH_SEARCH_KEY` are set

### B2. Domain and URL
- [ ] `NEXT_PUBLIC_APP_URL` matches the production web domain
- [ ] `SELLER_PANEL_URL` matches the production seller panel domain
- [ ] `ADMIN_PANEL_URL` matches the production admin panel domain
- [ ] `R2_PUBLIC_URL` matches the CDN URL for the production bucket
- [ ] `SMTP_FROM` uses the client's verified sending domain

---

## C. Database and Migrations

- [ ] Production database is provisioned and accessible
- [ ] Verify `20260513150200_fulfillment_extension_request` is applied before storefront smoke tests
- [ ] Run `pnpm db:migrate:deploy` — verify all migrations apply cleanly
- [ ] Check for any pending migration warnings in output
- [ ] Run `pnpm db:seed` — verify seed completes without errors
- [ ] Spot-check seed data via `pnpm db:studio` or direct SQL

---

## D. Build and Typecheck

- [ ] Run `pnpm typecheck` — 0 errors across all workspaces
- [ ] Run `pnpm lint` — 0 lint errors
- [ ] Run `pnpm build` — all 3 apps build successfully
- [ ] Note any build warnings and assess whether they need fixing

---

## E. Test Gate

- [ ] Run `pnpm test` — all unit and integration tests pass (393+ tests)
- [ ] Finance-critical tests pass: `payout-calculator`, `penalty-calculator`, `order-state-machine`
- [ ] Security-critical tests pass: `seller-isolation`, `auth-boundaries`
- [ ] If new business logic was added in this release, new tests exist for it

---

## F. Infrastructure

### F1. Coolify / Deployment
- [ ] Coolify project is configured for all 3 apps
- [ ] Docker / build config points to correct Dockerfiles
- [ ] Health checks are configured for each app
- [ ] Environment variables are set in Coolify (not only local .env)

### F2. Redis
- [ ] Redis instance is running and reachable from API/jobs
- [ ] BullMQ queues initialize without errors (check startup logs)

### F3. Meilisearch
- [ ] Meilisearch instance is running
- [ ] Product index is configured (`pnpm --filter web exec tsx api/lib/meilisearch.ts` or seed)
- [ ] Search returns results for known product names

### F4. Cloudflare R2
- [ ] Bucket exists with correct name (`R2_BUCKET_NAME`)
- [ ] CORS policy allows presigned PUT uploads from the web and seller panel origins
- [ ] Public CDN URL resolves to bucket content

### F5. Iyzico
- [ ] API keys are live (not sandbox)
- [ ] Webhook endpoint is registered in Iyzico dashboard: `https://{domain}/api/webhooks/iyzico`
- [ ] `IYZICO_WEBHOOK_SECRET` matches the secret configured in Iyzico dashboard

---

## G. Security Checks

- [ ] Admin panel is NOT indexed (`robots: { index: false }` in layout.tsx)
- [ ] Seller panel is NOT indexed
- [ ] Admin panel middleware blocks non-admin roles
- [ ] Seller panel middleware blocks non-seller roles
- [ ] No real secrets are committed to the repository (run `git log --diff-filter=A -- .env`)
- [ ] HTTPS is enforced — HTTP redirects to HTTPS in Coolify/reverse proxy
- [ ] `CSRF_COOKIE_NAME` cookie is set with `Secure` and `HttpOnly` flags in production
- [ ] `X-Frame-Options: DENY` header is present on admin panel responses

---

## H. SEO Checks (Storefront only)

- [ ] `https://{domain}/robots.txt` is accessible and blocks private routes
- [ ] `https://{domain}/sitemap.xml` is accessible and contains expected URLs
- [ ] A product page has correct `<title>`, canonical `<link>`, and JSON-LD `Product` schema
- [ ] A category page has `<title>`, canonical, and `BreadcrumbList` JSON-LD
- [ ] `metadataBase` in `apps/web/src/app/layout.tsx` points to the correct production URL

---

## I. Smoke Tests (Post-Deploy)

Perform these manually after each production deployment.

### Storefront
- [ ] Homepage loads without errors
- [ ] A category page loads and shows products
- [ ] A product detail page loads
- [ ] Search returns results
- [ ] Login / registration flow works
- [ ] Customer order detail opens without schema-out-of-sync or generic error screen

### Seller Panel
- [ ] Seller can log in
- [ ] Order queue is visible (requires at least one paid test order)
- [ ] Product list loads

### Admin Panel
- [ ] Admin can log in
- [ ] Dashboard summary loads
- [ ] Pending EFT list renders (even if empty)
- [ ] Audit log table renders

---

## J. Rollback Plan

Document the rollback plan for this release before deploying.

- **Database rollback:** Is there a down migration? If schema is destructive, is a backup taken?
- **Code rollback:** Previous Docker image tag noted?
- **Queue jobs:** If job logic changed, are existing queued jobs safe to process with the new code?
- **SEO rollback:** If routes changed, are redirects in place?

---

## K. Sign-Off

| Role | Name | Date |
|---|---|---|
| Developer | | |
| Reviewer | | |
| Deployer | | |

Release approved: `[ ]`

---

_This checklist is governed by `.claude/rules/11-testing-release-rules.md`._
_Update this file when release procedures or infrastructure changes._
