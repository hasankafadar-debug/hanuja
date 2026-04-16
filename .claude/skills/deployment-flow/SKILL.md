---
name: deployment-flow
description: Use when deploying Hanuja to Coolify, configuring environment variables, running database migrations, or planning a rollback. Covers env checklist, migration safety, and release gates.
user-invocable: true
paths:
  - "apps/**/*"
  - "api/**/*"
  - "db/**/*"
model: sonnet
effort: medium
---

This skill defines Hanuja deployment discipline.

Main principle:
Deployment is a controlled release process, not a file copy operation. Environment separation must always be respected.

Environment separation:
- local: developer machine, sandbox credentials, local DB/Redis
- staging: mirrors production structure, sandbox payment credentials, test data
- production: live credentials, live data, real payment processing

Coolify deployment rules:
1. Three separate Coolify services: web, seller-panel, admin-panel
2. Shared backend API service (or embedded in each app via Next.js API routes)
3. Separate Redis and PostgreSQL services
4. Environment variables configured per service in Coolify — never in repo
5. Docker-based deployment with health checks

Pre-deployment checklist:
- [ ] All required env vars present (DATABASE_URL, REDIS_URL, NEXTAUTH_SECRET, IYZICO_*, R2_*, MEILISEARCH_*)
- [ ] Database migration applied (pnpm db:migrate:deploy)
- [ ] Meilisearch indexes created/updated
- [ ] Build passes (pnpm build)
- [ ] Type check passes (pnpm typecheck)
- [ ] No known finance/lifecycle regression
- [ ] Relevant docs updated if behavior changed
- [ ] Rollback plan identified for risky changes

Migration deployment rules:
1. Always use `prisma migrate deploy` (not `prisma migrate dev`) in production
2. Run migration BEFORE deploying new app code
3. Verify migration completed successfully before traffic shift
4. Keep migration files in source control — never edit applied migrations
5. For risky schema changes: use multi-step deploy (add column → deploy → remove old column)

Required environment variables by category:
Database: DATABASE_URL
Redis: REDIS_URL
Auth: BETTER_AUTH_SECRET, BETTER_AUTH_URL
Payment: IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL
Storage: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
Search: MEILISEARCH_URL, MEILISEARCH_MASTER_KEY
Email: EMAIL_PROVIDER_API_KEY, EMAIL_FROM
App URLs: NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SELLER_PANEL_URL, NEXT_PUBLIC_ADMIN_PANEL_URL

Rollback strategy:
1. Code rollback: Coolify previous deployment restore
2. Migration rollback: only if migration has a safe `down` — test this beforehand
3. Data rollback: restore from backup (last clean backup point)
4. Emergency: put maintenance mode page, investigate, restore

Never do in production:
- Run `prisma migrate reset` (destroys all data)
- Run `prisma migrate dev` (marks migrations as not applied)
- Deploy without running migrations first
- Use production Iyzico credentials in local/staging
- Deploy directly from local machine without CI review

Post-deployment verification:
- Health check endpoints respond (all 3 apps)
- Login flow works
- Product listing loads
- Admin panel accessible
- Payment flow uses correct environment (sandbox vs live)
- No 500 errors in logs

When running deployment:
1. Confirm environment (staging vs production)
2. Run pre-deployment checklist
3. Apply migrations
4. Deploy app build
5. Run post-deployment verification
6. Monitor error logs for 15 minutes after deploy
