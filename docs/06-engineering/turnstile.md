# Cloudflare Turnstile

## Purpose

Hanuja uses a single Cloudflare Turnstile widget across admin login, seller login, seller onboarding,
customer login, customer signup, and storefront checkout.

The widget must use a real Cloudflare site key and secret key in all normal app environments.
Using Cloudflare's official test keys causes the widget to display a visible red "testing only"
warning inside the iframe.

## Environment variables

| Variable                         | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-visible Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY`           | Server-side secret used for `siteverify`      |

Both variables are loaded from the repo root `.env` in local development and from deployment
secrets in staging/production.

## Required hostnames

The Cloudflare Turnstile widget must allow all app entrypoints that render the widget:

- `localhost`
- `127.0.0.1`
- `www.hanuja.com.tr`
- `satici.hanuja.com.tr`
- `admin.hanuja.com.tr`

If staging uses separate domains, add those too before enabling the widget there.

## Current repo behavior

- UI widget loader: `packages/ui/src/components/turnstile-widget.tsx`
- Server verification: `api/lib/turnstile.ts`
- Surfaces: admin login, seller login, seller onboarding, customer login, customer signup, checkout
- Email sign-in/sign-up protection is applied to the actual Better Auth request. The browser sends
  the token in `x-captcha-response`; there is no separate pre-verification endpoint.
- Checkout and seller onboarding send the token in the protected business request body.
- Verification uses a four-second timeout and at most three attempts. Retries use the same
  `idempotency_key` and occur only for network/timeout errors, HTTP 429/5xx, or Cloudflare
  `internal-error` results.
- A persistent provider failure is fail-closed. It never bypasses CAPTCHA and it never reports a
  database-specific error.

The code already supports real Turnstile credentials. If credentials are missing in development,
the widget falls back to the development bypass path. That bypass exists only as a fail-safe and
should not be treated as the normal app configuration.

## Public error contract

| Code                      | HTTP status | Meaning                                                               |
| ------------------------- | ----------: | --------------------------------------------------------------------- |
| `TURNSTILE_REQUIRED`      |         400 | Token is missing                                                      |
| `TURNSTILE_INVALID`       |         403 | Token is invalid, expired/used, or has the wrong action               |
| `TURNSTILE_UNAVAILABLE`   |         503 | Cloudflare or the outbound network remained unavailable after retries |
| `TURNSTILE_MISCONFIGURED` |         503 | Server secret is missing or unsafe for production                     |

Only the explicit `DATABASE_UNAVAILABLE` code may be presented as a database outage in login UI.
After a failed protected submission, clients remount the widget to obtain a fresh single-use token
while retaining the form fields.

## Egress diagnostics

The worker image includes a probe that uses only Cloudflare's public test secret and dummy token.
It never reads or sends the production Turnstile secret:

```bash
pnpm check-turnstile-egress
pnpm check-turnstile-egress -- --detailed
```

The normal command performs DNS checks followed by up to three HTTPS Siteverify attempts, exiting
0 on success and 1 after three failures. Detailed mode tests IPv4 and IPv6 sequentially and reports
each path separately. Logs contain attempt number, duration, HTTP status, `cf-ray`, TLS state and IP
family, but never a token, secret, email, password or client IP.

In Coolify, run the normal command from the worker as a Scheduled Task every five minutes. Keep
results in Coolify task history/logs; no external notification is required. Turnstile is deliberately
not part of `/api/health`, because a provider outage must not trigger an application restart loop.

## Manual QA checklist

After setting real credentials and updating the Cloudflare hostname allowlist:

1. Open `http://localhost:3002/giris` and confirm the red test banner is gone.
2. Open `http://localhost:3001/giris` and confirm the widget loads normally.
3. Open `http://localhost:3000/giris` and confirm login renders without the test banner.
4. Open `http://localhost:3000/kayit` and confirm signup renders without the test banner.
5. Open `http://localhost:3000/odeme` as an authenticated customer and confirm checkout renders without the test banner.
6. Submit one login/signup/checkout flow and confirm backend verification succeeds.

## E2E policy

Playwright helpers may mock Turnstile for non-critical regression coverage, but those tests do not
prove real Cloudflare widget behavior. Real Turnstile validation is covered by manual QA because
Cloudflare can treat automated browsers as bot traffic.
