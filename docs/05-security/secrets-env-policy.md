# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Secrets and Environment Variable Policy

## Purpose

This document defines how environment variables and secrets are managed across
the Hanuja marketplace. It covers which variables exist, what service they belong to,
which environments they apply to, commit rules, rotation procedures, and
how the check-env validation tool is used.

The canonical list of required variable names is `.env.example` at the repository root.

---

## Never-Commit Rule

The following must never be committed to git:

- `.env` — any `.env` file with real values
- `.env.local`, `.env.production`, `.env.staging`, or any real environment file
- Any file containing a real API key, secret key, database password, or IBAN
- `CLAUDE.local.md` — machine-specific overrides (gitignored by convention)

`.env.example` is the only exception. It must contain placeholder values only,
never real credentials. Any example value that looks like a real secret is a violation.

If a real secret is committed accidentally:

1. Revoke the secret immediately at the provider level.
2. Generate a new secret and deploy it to all affected environments.
3. Remove the secret from git history using `git filter-repo` or equivalent.
4. Notify relevant team members.

Do not assume that deleting the file in a new commit is sufficient.
Git history retains the value until history is rewritten.

---

## Environment Variable Reference

All variables below are documented in `.env.example`. This section maps each
variable to its service, required environments, and sensitivity level.

### Database

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `DATABASE_URL` | PostgreSQL | All environments | Critical |

Format: `postgresql://USER:PASSWORD@HOST:PORT/DB_NAME`

- Local dev: use a local or Docker PostgreSQL instance, never the production database.
- Staging and production use separate databases with separate credentials.
- The production database password must never appear in any dev or staging config.

### Redis

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `REDIS_URL` | Redis (BullMQ queues, rate limiting) | All environments | High |

Format: `redis://HOST:PORT` or `redis://:PASSWORD@HOST:PORT` for authenticated instances.

- Local dev: use a local or Docker Redis instance.
- Production should use an authenticated Redis instance with TLS where available.

### Better Auth

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `BETTER_AUTH_SECRET` | Better Auth session signing | All environments | Critical |
| `BETTER_AUTH_URL` | Better Auth base URL (per app) | All environments | Low |
| `NEXT_PUBLIC_APP_URL` | Public URL for apps/web | All environments | Low |
| `SELLER_PANEL_URL` | Seller panel URL (CORS trusted origin) | All environments | Low |
| `ADMIN_PANEL_URL` | Admin panel URL (CORS trusted origin) | All environments | Low |
| `NEXT_PUBLIC_WEB_URL` | Public web URL for cross-app reference | All environments | Low |
| `NEXT_PUBLIC_SELLER_PANEL_URL` | SSR fallback for seller panel URL | All environments | Low |
| `NEXT_PUBLIC_ADMIN_PANEL_URL` | SSR fallback for admin panel URL | All environments | Low |

`BETTER_AUTH_SECRET` must be a cryptographically random string of at least 32 bytes.

Generate with: `openssl rand -base64 32`

Changing this value in production invalidates all existing sessions immediately.
Plan session invalidation before rotating this secret.

### Iyzico Payment

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `IYZICO_API_KEY` | Iyzico payment provider | All environments | Critical |
| `IYZICO_SECRET_KEY` | Iyzico HMAC signing | All environments | Critical |
| `IYZICO_BASE_URL` | Iyzico API endpoint | All environments | Low |
| `IYZICO_WEBHOOK_SECRET` | Webhook signature verification | Staging, Production | Critical |

- Local and CI environments must use Iyzico sandbox credentials only.
- `IYZICO_BASE_URL` for sandbox: `https://sandbox-api.iyzipay.com`
- `IYZICO_BASE_URL` for production: `https://api.iyzipay.com`
- `IYZICO_WEBHOOK_SECRET` is used by `verifyIyzicoWebhook()` in
  `packages/security/src/webhook-verifier.ts`. It must match the value configured
  in the Iyzico dashboard.
- Never use production Iyzico credentials in local or staging environments.
  Accidental real transactions are not reversible without manual intervention.

### Cloudflare R2 (Object Storage)

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare R2 | Staging, Production | High |
| `R2_ACCESS_KEY_ID` | R2 access credential | Staging, Production | Critical |
| `R2_SECRET_ACCESS_KEY` | R2 secret credential | Staging, Production | Critical |
| `R2_BUCKET_NAME` | R2 bucket name | Staging, Production | Low |
| `R2_PUBLIC_URL` | Public CDN URL for media | All environments | Low |
| `R2_PUBLIC_HOSTNAME` | Hostname for Next.js Image allowlist | All environments | Low |

- Local development may use a mock or skip R2 upload entirely for non-media tasks.
- Staging and production must use separate R2 buckets with separate API keys.
- Do not share R2 credentials between environments.
- `R2_SECRET_ACCESS_KEY` must never appear in logs or responses.

### Meilisearch

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `MEILISEARCH_URL` | Meilisearch search engine | All environments | Low |
| `MEILISEARCH_ADMIN_KEY` | Meilisearch admin operations (indexing) | All environments | High |
| `MEILISEARCH_SEARCH_KEY` | Meilisearch search-only key (frontend) | All environments | Medium |

- `MEILISEARCH_ADMIN_KEY` has write access. It must not be exposed in client bundles
  or API responses. It is used only in server-side indexing operations.
- `MEILISEARCH_SEARCH_KEY` is a read-only key and may be passed to the browser,
  but still must not be committed as a real value.
- Local dev: run Meilisearch via Docker. Generate keys from a running instance
  using the instructions in `.env.example`.
- Staging and production use separate Meilisearch instances or separate index namespaces
  with separate key pairs.

### SMTP (Email)

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `SMTP_HOST` | Email delivery | Staging, Production | Low |
| `SMTP_PORT` | SMTP port | Staging, Production | Low |
| `SMTP_USER` | SMTP authentication username | Staging, Production | Medium |
| `SMTP_PASS` | SMTP authentication password | Staging, Production | High |
| `SMTP_FROM` | Sender address | Staging, Production | Low |

- Local development may suppress email delivery or redirect to a local mail catcher
  (e.g., Mailpit or Mailhog).
- Do not use production SMTP credentials in local dev.
- `SMTP_PASS` must not appear in logs.

### App Metadata

| Variable | Service | Required In | Sensitivity |
|----------|---------|-------------|-------------|
| `NEXT_PUBLIC_SITE_NAME` | Storefront display name | All environments | None |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL | All environments | None |

These are public-facing non-sensitive values. They must still match the actual
deployment URL to avoid canonical and SEO inconsistencies.

---

## Environment Separation Rules

The platform has three target environments:

| Environment | Purpose | Payment Provider | Database |
|-------------|---------|------------------|----------|
| Local (dev) | Developer machines | Iyzico sandbox only | Local PostgreSQL |
| Staging | Integration testing, QA, demo | Iyzico sandbox only | Separate staging DB |
| Production | Live marketplace | Iyzico production | Production DB |

Rules:

1. Production secrets must never be used in local or staging environments.
2. Staging secrets must not be reused in production.
3. Each environment must have its own `BETTER_AUTH_SECRET`, database, Redis,
   and Meilisearch instance or namespace.
4. Payment providers must use sandbox mode in all non-production environments.
5. Environment-specific `.env` files must exist only on the deployment target,
   never in the repository.

For Coolify-based deployment, environment variables are injected via the Coolify
interface per application, per environment. They are not stored in the repository.

---

## CLAUDE.local.md for Local Developer Overrides

`CLAUDE.local.md.example` is committed as a template. Developers copy it to
`CLAUDE.local.md` (which is gitignored) for machine-specific notes such as:

- Local port overrides if defaults are in use
- Note about which sandbox credentials are loaded
- Reminder about local Docker setup

`CLAUDE.local.md` must never contain real secrets. It is a notes file, not a
credentials file.

---

## check-env Validation Tool

The repository includes `tools/scripts/` for operational validation. When an
env checker tool is present (check-env validator), it must be run:

- Before starting any app to verify required variables are present.
- As part of the CI pipeline to catch missing env vars before test runs.
- Before production deployments as a release gate check.

Required variables for each app are:

**apps/web**: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL`, `MEILISEARCH_URL`,
`MEILISEARCH_SEARCH_KEY`, `NEXT_PUBLIC_SITE_URL`

**apps/seller-panel**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`

**apps/admin-panel**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`

**api / background jobs**: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`,
`IYZICO_SECRET_KEY`, `IYZICO_WEBHOOK_SECRET`, `MEILISEARCH_URL`,
`MEILISEARCH_ADMIN_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `SMTP_HOST`, `SMTP_PASS`

A missing required variable must cause an explicit startup failure with a clear
error message, not a silent undefined reference that appears only at runtime.

---

## Secret Rotation Procedure

Rotate a secret when:

- Accidental exposure is suspected or confirmed (e.g., appeared in logs, committed to git).
- A team member with access departs.
- Provider-recommended rotation cadence is reached.
- A security incident is under investigation.

### Rotation Steps

1. Generate the new secret at the provider (Iyzico dashboard, Cloudflare, SMTP provider)
   or with `openssl rand -base64 32` for auth secrets.
2. Update the value in the target environment's secret store (Coolify env panel
   for staging and production).
3. Restart affected services.
4. Verify that the service starts correctly with the new value.
5. Revoke or deactivate the old secret at the provider level if the provider supports it.
6. Log the rotation event in the team's internal change log (date, variable name,
   reason, actor). Do not log the secret value itself.

For `BETTER_AUTH_SECRET` rotation: all active user sessions will be invalidated.
Schedule this during a low-traffic window and communicate to affected users if needed.

For `IYZICO_SECRET_KEY` rotation: coordinate with Iyzico support and verify that
webhook signatures are verified correctly after rotation.

---

## Logging and Masking Rules

The `maskSensitiveObject()` function in `packages/security/src/data-masker.ts`
automatically masks the following keys when objects are logged:

`iban`, `accountNumber`, `cardNumber`, `password`, `token`, `secret`,
`apiKey`, `privateKey`, `cvv`, `pin`

Any object passed to a logger that may contain these keys must be passed through
`maskSensitiveObject()` first.

Application logs must never contain:

- Raw database passwords
- Raw API keys or secret keys
- Raw IBAN values
- Raw card numbers
- Raw auth tokens or session tokens
- SMTP passwords

If a log line contains any of the above, it is a security incident and must be
treated as an exposure event.

---

## Cross-References

- `.env.example` — canonical list of all environment variable names and placeholder values
- `packages/security/src/data-masker.ts` — `maskSensitiveObject()` for log safety
- `packages/security/src/webhook-verifier.ts` — uses `IYZICO_WEBHOOK_SECRET`
- `tools/scripts/` — check-env validation tooling
- `CLAUDE.local.md.example` — local developer override template
- `.claude/rules/05-security-rules.md` — Secret and Credential Rules section
- `docs/06-engineering/deployment-environments.md`
