# Cloudflare Turnstile

## Purpose

Hanuja uses a single Cloudflare Turnstile widget across admin login, seller login, seller onboarding,
customer login, customer signup, and storefront checkout.

The widget must use a real Cloudflare site key and secret key in all normal app environments.
Using Cloudflare's official test keys causes the widget to display a visible red "testing only"
warning inside the iframe.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-visible Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Server-side secret used for `siteverify` |

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

The code already supports real Turnstile credentials. If credentials are missing in development,
the widget falls back to the development bypass path. That bypass exists only as a fail-safe and
should not be treated as the normal app configuration.

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
