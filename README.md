# Hanuja

Hanuja is a Türkiye-focused multi-vendor marketplace for home, office, decor, furniture, and lifestyle products.

## Getting Started (Local Development)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 20+](https://nodejs.org/)
- [pnpm 10](https://pnpm.io/installation) — `npm install -g pnpm@10`

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432` (user: `hanuja`, password: `hanuja_dev_password`, db: `hanuja_dev`)
- **Redis 7** on `localhost:6379`
- **Meilisearch** on `localhost:7700` (master key: `hanuja_meili_dev_key`)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and update:
- `DATABASE_URL` → `postgresql://hanuja:hanuja_dev_password@localhost:5432/hanuja_dev`
- `REDIS_URL` → `redis://localhost:6379`
- `MEILISEARCH_URL` → `http://localhost:7700`
- `MEILISEARCH_ADMIN_KEY` → `hanuja_meili_dev_key`
- `BETTER_AUTH_SECRET` → generate with `openssl rand -base64 32`
- Iyzico, R2, SMTP fields → use sandbox/test values locally

### 3. Install dependencies

```bash
pnpm install
```

### 4. Run database migrations and seed

```bash
pnpm db:migrate    # runs Prisma migrations
pnpm db:seed       # seeds initial data
```

### 5. Start all apps

```bash
pnpm dev
```

Apps run at:
- **Storefront**: http://localhost:3000
- **Seller panel**: http://localhost:3001
- **Admin panel**: http://localhost:3002

---

## Goals
- SEO-safe storefront architecture
- seller and admin panel separation
- centralized payment collection model
- payout hold, penalty, refund, and reconciliation workflows
- shared documentation-first development flow

## Core apps
- `apps/web`: customer storefront
- `apps/seller-panel`: seller dashboard
- `apps/admin-panel`: admin dashboard

## Shared packages
- `packages/ui`
- `packages/config`
- `packages/types`
- `packages/seo`
- `packages/security`

## Key docs
- `CLAUDE.md`
- `.claude/rules/`
- `docs/04-seo/seo-url-slug-rules.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/08-legal/payment-regulation-notes.md`

## First implementation targets
1. finalize shared rules and docs
2. build route and slug architecture
3. define auth roles and permission matrix
4. define order state machine
5. define payout and penalty domain model
6. scaffold Next.js apps and shared packages

## Working principle
Business and operational rules are documented before critical implementation.
