# Coolify Setup Guide

This document covers how to configure each Hanuja service in Coolify for staging and production deployment.

---

## Prerequisites

Before configuring apps, ensure the following backing services are running in Coolify (or externally managed):

- **PostgreSQL 16** — primary database
- **Redis 7** — queue and session store
- **Meilisearch** — search index

---

## Repository Connection

1. In Coolify, go to **Sources** → connect your Git repository (GitHub/GitLab/Gitea)
2. Grant access to the `hanuja` repository
3. Set the default branch to `main`

---

## Service 1: web (Customer Storefront)

**Type**: Application  
**Build pack**: Dockerfile  
**Dockerfile**: `Dockerfile.web`  
**Build context**: `.` (repo root)  
**Port**: `3000`  
**Public URL**: `https://www.hanuja.com.tr`

### Environment Variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://USER:PASS@HOST:5432/hanuja_prod` |
| `REDIS_URL` | `redis://HOST:6379` |
| `BETTER_AUTH_SECRET` | *(generate: `openssl rand -base64 32`)* |
| `BETTER_AUTH_URL` | `https://www.hanuja.com.tr` |
| `NEXT_PUBLIC_APP_URL` | `https://www.hanuja.com.tr` |
| `NEXT_PUBLIC_WEB_URL` | `https://www.hanuja.com.tr` |
| `SELLER_PANEL_URL` | `https://satici.hanuja.com.tr` |
| `ADMIN_PANEL_URL` | `https://admin.hanuja.com.tr` |
| `IYZICO_API_KEY` | *(live key from Iyzico dashboard)* |
| `IYZICO_SECRET_KEY` | *(live secret from Iyzico dashboard)* |
| `IYZICO_BASE_URL` | `https://api.iyzipay.com` |
| `IYZICO_WEBHOOK_SECRET` | *(from Iyzico webhook settings)* |
| `R2_ACCOUNT_ID` | *(Cloudflare account ID)* |
| `R2_ACCESS_KEY_ID` | *(R2 API token access key)* |
| `R2_SECRET_ACCESS_KEY` | *(R2 API token secret)* |
| `R2_BUCKET_NAME` | `hanuja-media` |
| `R2_PUBLIC_URL` | `https://media.hanuja.com.tr` |
| `R2_PUBLIC_HOSTNAME` | `media.hanuja.com.tr` |
| `MEILISEARCH_URL` | `http://meilisearch:7700` (or external URL) |
| `MEILISEARCH_ADMIN_KEY` | *(Meilisearch master key)* |
| `MEILISEARCH_SEARCH_KEY` | *(Meilisearch search-only key)* |
| `SMTP_HOST` | `smtp.resend.com` (Resend) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` *(literal string)* |
| `SMTP_PASS` | *(Resend API key)* |
| `SMTP_FROM` | `Hanuja <noreply@hanuja.com.tr>` |
| `EMAIL_FROM_NOREPLY` | `Hanuja <noreply@hanuja.com.tr>` — falls back to `SMTP_FROM` if unset |
| `EMAIL_FROM_FATURA` | `Hanuja Fatura <fatura@hanuja.com.tr>` — falls back to `SMTP_FROM` if unset |
| `EMAIL_FROM_KAMPANYA` | `Hanuja <kampanya@hanuja.com.tr>` — falls back to `SMTP_FROM` if unset |
| `NEXT_PUBLIC_SITE_NAME` | `Hanuja` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.hanuja.com.tr` |

Resend setup detail (domain verification, DKIM, return-path subdomain, plan/quota
limits) lives in `docs/06-engineering/integrations.md` §6 — do not duplicate it here.
All `EMAIL_FROM_*` addresses must be at the Resend-verified `hanuja.com.tr` domain.

### Migration command

Do not set a migration pre-deploy command on `web`. Its standalone production
image does not contain pnpm, Prisma CLI, or the migration files. Migrations are
applied by the worker startup gate described under Service 4.

---

## Service 2: seller-panel

**Type**: Application  
**Build pack**: Dockerfile  
**Dockerfile**: `Dockerfile.seller-panel`  
**Build context**: `.`  
**Port**: `3001`  
**Public URL**: `https://satici.hanuja.com.tr`

### Environment Variables

Same as `web` except:

| Variable | Value |
|---|---|
| `BETTER_AUTH_URL` | `https://satici.hanuja.com.tr` |
| `NEXT_PUBLIC_APP_URL` | `https://satici.hanuja.com.tr` |

All other variables (`DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, R2, Iyzico, Meilisearch, SMTP) are identical to the web service — use the same values.

R2 note:
- `seller-panel` and `web` must use the same `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
  `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
- `BETTER_AUTH_URL` may differ per service; R2 variables should not.
- `R2_PUBLIC_URL` may point to a custom media domain, but the signed upload host is still
  expected to be `*.r2.cloudflarestorage.com`.

---

## Service 3: admin-panel

**Type**: Application  
**Build pack**: Dockerfile  
**Dockerfile**: `Dockerfile.admin-panel`  
**Build context**: `.`  
**Port**: `3002`  
**Public URL**: `https://admin.hanuja.com.tr`

### Environment Variables

Same as `web` except:

| Variable | Value |
|---|---|
| `BETTER_AUTH_URL` | `https://admin.hanuja.com.tr` |
| `NEXT_PUBLIC_APP_URL` | `https://admin.hanuja.com.tr` |

---

## Service 4: worker (BullMQ)

### Startup migration gate

`Dockerfile.worker` runs `pnpm db:migrate:deploy` before starting BullMQ. If the
migration command fails, the worker process never starts and the deployment
must stop before admin, seller-panel, or web is redeployed. In the deployment
logs, confirm either the expected migration name was applied or there were no
pending migrations, followed by the worker and repeatable scheduler startup
messages.

**Type**: Application  
**Build pack**: Dockerfile  
**Dockerfile**: `Dockerfile.worker`  
**Build context**: `.`  
**Port**: *(none — no HTTP)*  
**Public URL**: *(none)*

### Environment Variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(same as web)* |
| `REDIS_URL` | *(same as web)* |
| `MEILISEARCH_URL` | *(same as web)* |
| `MEILISEARCH_ADMIN_KEY` | *(same as web)* |
| `R2_ACCOUNT_ID` | *(same as web)* |
| `R2_ACCESS_KEY_ID` | *(same as web)* |
| `R2_SECRET_ACCESS_KEY` | *(same as web)* |
| `R2_BUCKET_NAME` | `hanuja-media` |
| `SMTP_HOST` | *(same as web)* |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | *(same as web)* |
| `SMTP_PASS` | *(same as web)* |
| `SMTP_FROM` | `Hanuja <noreply@hanuja.com.tr>` |
| `EMAIL_FROM_NOREPLY` | *(same as web)* |
| `EMAIL_FROM_FATURA` | *(same as web)* |
| `EMAIL_FROM_KAMPANYA` | *(same as web)* |

The worker sends campaign-discount emails (`api/jobs/campaign-discount.job.ts`), so it
needs the full SMTP/`EMAIL_FROM_*` set even though it has no HTTP surface.

The worker does **not** need Iyzico credentials (payment flows run in the web app's API routes, not in background jobs).

---

## BETTER_AUTH_SECRET

All four services must share the **same** `BETTER_AUTH_SECRET`. Better Auth uses this to sign and verify sessions. If they differ, sessions won't be valid across services.

Generate once:
```bash
openssl rand -base64 32
```

Then set the same value in all four services.

---

## DNS / Domain Setup

| Domain | Service |
|---|---|
| `www.hanuja.com.tr` | web (canonical) |
| `hanuja.com.tr`, `hanuja.tr`, `www.hanuja.tr` | tek adımlı 301 → canonical |
| `satici.hanuja.com.tr` | seller-panel |
| `admin.hanuja.com.tr` | admin-panel |
| `media.hanuja.com.tr` | Cloudflare R2 production bucket custom domain |

Configure HTTPS certificates via Let's Encrypt in Coolify's domain settings for each service.

---

## Sandbox vs Live Iyzico

| Variable | Sandbox | Production |
|---|---|---|
| `IYZICO_BASE_URL` | `https://sandbox-api.iyzipay.com` | `https://api.iyzipay.com` |
| `IYZICO_API_KEY` | sandbox key | live key |
| `IYZICO_SECRET_KEY` | sandbox secret | live secret |

Never use sandbox credentials in production. Never use live credentials locally.

---

## Meilisearch Configuration

After first deploy, initialize the search indices:
```bash
# Run once from a machine with database access
pnpm --filter @hanuja/api run search:init
```

Or trigger via admin panel search settings page.

---

## Checklist Before First Production Deploy

- [ ] All four Coolify services created
- [ ] `BETTER_AUTH_SECRET` is the same value across all services
- [ ] `IYZICO_BASE_URL` points to `https://api.iyzipay.com` (live, not sandbox)
- [ ] `DATABASE_URL` points to production PostgreSQL
- [ ] `REDIS_URL` points to production Redis
- [ ] `R2_PUBLIC_HOSTNAME` set to `media.hanuja.com.tr`
- [ ] `seller-panel` R2 env values exactly match `web`
- [ ] `R2_BUCKET_NAME` exists in the Cloudflare account referenced by `R2_ACCOUNT_ID`
- [ ] The configured R2 access key can read bucket metadata and upload objects
- [ ] Migrations ran successfully (`migrate:deploy`)
- [ ] DNS records point to correct Coolify services
- [ ] HTTPS certificates provisioned
- [ ] Worker service is running (check BullMQ queue health)
