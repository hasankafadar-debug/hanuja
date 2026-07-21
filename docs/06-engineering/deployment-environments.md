# Deployment Environments

## Overview

Hanuja runs across three environments. Each maps to a separate set of infrastructure, secrets, and provider credentials.

| Environment | Purpose | Deployment target |
|---|---|---|
| local | Developer workstation | Docker Compose |
| staging | Pre-release validation | Coolify (separate project) |
| production | Live marketplace | Coolify |

---

## Local Environment

### Infrastructure
Run all backing services with:
```bash
docker compose up -d
```

Services started:
- PostgreSQL 16 on port `5432`
- Redis 7 on port `6379`
- Meilisearch latest on port `7700`

### Apps (run separately via Turborepo)
```bash
pnpm dev                        # all three apps in parallel
pnpm --filter web dev           # :3000
pnpm --filter seller-panel dev  # :3001
pnpm --filter admin-panel dev   # :3002
```

### Database
```bash
pnpm --filter @hanuja/db run migrate   # run migrations
pnpm --filter @hanuja/db run seed      # seed test data
```

### Secrets
Copy `.env.example` to `.env` at repo root and fill in local values. Never commit `.env`.

---

## Production / Staging (Coolify)

### Architecture

Four deployment units, each with its own Coolify service:

| Service | Dockerfile | Port | Description |
|---|---|---|---|
| web | `Dockerfile.web` | 3000 | Customer storefront |
| seller-panel | `Dockerfile.seller-panel` | 3001 | Seller dashboard |
| admin-panel | `Dockerfile.admin-panel` | 3002 | Admin operations |
| worker | `Dockerfile.worker` | — | BullMQ background jobs |

All four share the same PostgreSQL, Redis, and Meilisearch instances.

### Coolify Service Configuration

For each Next.js service in Coolify:
- **Build pack**: Dockerfile
- **Dockerfile path**: e.g. `Dockerfile.web` (relative to repo root)
- **Build context**: `.` (repo root)
- **Port**: per table above

For the worker service:
- No exposed port
- Restart policy: `unless-stopped`

### Migration Strategy

Migrations must finish **before** new application processes start using the new
schema. The production worker image contains the repository, pnpm, Prisma CLI,
schema, and migration files; its startup command runs `pnpm db:migrate:deploy`
before starting BullMQ. A failed migration exits the container non-zero, so the
remaining services must not be deployed.

Do not configure this as a `web` pre-deploy command. Coolify runs pre-deploy
commands in the existing container, while the standalone `Dockerfile.web`
runner intentionally contains neither pnpm nor Prisma migration files.

### Deploy Order
1. Deploy worker; its startup gate runs `migrate:deploy`, then starts updated job logic
2. Confirm the migration output and worker/scheduler startup logs
3. Deploy admin-panel
4. Deploy seller-panel
5. Deploy web (highest traffic — deploy last)

---

## Environment Variables

See `docs/06-engineering/coolify-setup.md` for the full Coolify variable mapping.

Key variables that differ between environments:

| Variable | Local | Production |
|---|---|---|
| `DATABASE_URL` | `postgresql://hanuja:hanuja_dev_password@localhost:5432/hanuja_dev` | Production PostgreSQL URL |
| `REDIS_URL` | `redis://localhost:6379` | Production Redis URL |
| `BETTER_AUTH_URL` | `http://localhost:3000` | `https://www.hanuja.com.tr` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://www.hanuja.com.tr` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Real widget site key with `localhost` and `127.0.0.1` allowed | Real widget site key |
| `TURNSTILE_SECRET_KEY` | Matching real secret key | Matching real secret key |
| `IYZICO_BASE_URL` | `https://sandbox-api.iyzipay.com` | `https://api.iyzipay.com` |
| `NODE_ENV` | `development` | `production` |

R2 checklist:
- `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` must
  point to the same environment-specific bucket.
- `R2_PUBLIC_URL` and `R2_PUBLIC_HOSTNAME` affect media delivery only; upload `PUT`
  requests still target `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.
- In production, set them to `https://media.hanuja.tr` and `media.hanuja.tr`. Runtime support
  for `media.hanuja.com.tr` keeps existing database URLs working, so no DB backfill is needed.
- Local and staging should use a separate bucket from production.

Turnstile note:
- Do not use Cloudflare's official test keys in normal app environments if you want to avoid the red test banner in the widget.
- The widget hostname allowlist must include `localhost`, `127.0.0.1`, and every public app domain that renders the widget.

---

## Prisma Client Generation

The Prisma client is generated inside each Docker build:
```dockerfile
RUN pnpm --filter @hanuja/db run generate
```

The generated client is output to `node_modules/.prisma/client` as configured in `db/schema/schema.prisma`.

---

## Health Checks

For Coolify health check configuration on Next.js services:
- **Path**: `/api/health`
- **Interval**: 30s
- **Timeout**: 5s

For the worker, health is monitored via Redis/BullMQ queue state — no HTTP endpoint needed.

---

## Rollback

1. In Coolify, roll back to the previous successful deployment via the deployments list.
2. If a migration was destructive, restore from PostgreSQL backup before rolling back the app.
3. For additive-only migrations, app rollback is sufficient without DB restore.

**Rule**: Never run destructive migrations (column drops, type changes) without a backup and a confirmed rollback path.
