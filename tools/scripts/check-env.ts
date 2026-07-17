#!/usr/bin/env tsx
/**
 * Pre-deploy Environment Variable Checker
 *
 * Verifies all required environment variables are present before deployment.
 * Run this as part of the CI/CD pipeline or before `pnpm db:migrate:deploy`.
 *
 * Usage:
 *   pnpm check-env               # checks all apps
 *   pnpm check-env --app=web     # checks web app only
 *   pnpm check-env --env=prod    # checks with production-required rules
 *
 * Exit codes:
 *   0 — all required vars present
 *   1 — missing required vars
 */

import { config as loadDotEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../')

// Load .env from repo root if it exists
loadDotEnv({ path: path.join(repoRoot, '.env') })

// ── Env var definitions ───────────────────────────────────────────────────────

interface EnvVar {
  key: string
  required: boolean
  requiredInProd?: boolean
  requiredWhen?: 'card-payments' | 'invoice-aliasing'
  description: string
  /** If true, must be a real non-placeholder value in production */
  sensitiveInProd?: boolean
  /** Applies to which apps */
  apps: ('web' | 'seller-panel' | 'admin-panel' | 'api' | 'all')[]
}

const ENV_VARS: EnvVar[] = [
  // Database
  { key: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string', apps: ['all'] },

  // Redis
  { key: 'REDIS_URL', required: true, description: 'Redis connection URL for BullMQ', apps: ['all'] },

  // Auth
  { key: 'BETTER_AUTH_SECRET', required: true, sensitiveInProd: true, description: 'Better Auth signing secret (min 32 chars)', apps: ['all'] },
  { key: 'BETTER_AUTH_URL', required: true, description: 'Auth base URL', apps: ['web', 'seller-panel', 'admin-panel'] },
  { key: 'NEXT_PUBLIC_APP_URL', required: true, description: 'Public app URL', apps: ['web', 'seller-panel', 'admin-panel'] },
  { key: 'NEXT_PUBLIC_WEB_URL', required: false, requiredInProd: true, description: 'Storefront URL', apps: ['all'] },
  { key: 'NEXT_PUBLIC_SELLER_PANEL_URL', required: false, requiredInProd: true, description: 'Public seller panel URL', apps: ['all'] },
  { key: 'NEXT_PUBLIC_ADMIN_PANEL_URL', required: false, requiredInProd: true, description: 'Public admin panel URL', apps: ['all'] },
  { key: 'SELLER_PANEL_URL', required: true, description: 'Seller panel base URL', apps: ['all'] },
  { key: 'ADMIN_PANEL_URL', required: true, description: 'Admin panel base URL', apps: ['all'] },

  // Payment
  { key: 'CARD_PAYMENTS_ENABLED', required: false, requiredInProd: true, description: 'Card payment feature flag (true/false)', apps: ['all'] },
  { key: 'IYZICO_API_KEY', required: false, requiredWhen: 'card-payments', sensitiveInProd: true, description: 'Iyzico API key', apps: ['api'] },
  { key: 'IYZICO_SECRET_KEY', required: false, requiredWhen: 'card-payments', sensitiveInProd: true, description: 'Iyzico secret key', apps: ['api'] },
  { key: 'IYZICO_BASE_URL', required: false, requiredWhen: 'card-payments', description: 'Iyzico base URL (sandbox or live)', apps: ['api'] },
  { key: 'IYZICO_WEBHOOK_SECRET', required: false, requiredWhen: 'card-payments', sensitiveInProd: true, description: 'Iyzico webhook HMAC secret', apps: ['api'] },

  // Turnstile
  { key: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', required: false, requiredInProd: true, sensitiveInProd: true, description: 'Cloudflare Turnstile site key', apps: ['web', 'seller-panel', 'admin-panel'] },
  { key: 'TURNSTILE_SECRET_KEY', required: false, requiredInProd: true, sensitiveInProd: true, description: 'Cloudflare Turnstile secret key', apps: ['api', 'web', 'seller-panel', 'admin-panel'] },

  // Storage
  { key: 'R2_ACCOUNT_ID', required: true, description: 'Cloudflare R2 account ID', apps: ['api'] },
  { key: 'R2_ACCESS_KEY_ID', required: true, sensitiveInProd: true, description: 'R2 access key', apps: ['api'] },
  { key: 'R2_SECRET_ACCESS_KEY', required: true, sensitiveInProd: true, description: 'R2 secret access key', apps: ['api'] },
  { key: 'R2_BUCKET_NAME', required: true, description: 'R2 bucket name', apps: ['api'] },
  { key: 'R2_PUBLIC_URL', required: true, description: 'R2 public CDN URL', apps: ['api'] },
  { key: 'R2_CDN_URL', required: false, description: 'R2 public CDN URL override', apps: ['api'] },

  // Search
  { key: 'MEILISEARCH_URL', required: true, description: 'Meilisearch server URL', apps: ['all'] },
  { key: 'MEILISEARCH_ADMIN_KEY', required: true, sensitiveInProd: true, description: 'Meilisearch admin API key', apps: ['api'] },
  { key: 'MEILISEARCH_SEARCH_KEY', required: true, description: 'Meilisearch public search key', apps: ['web'] },

  // Email
  { key: 'SMTP_HOST', required: false, requiredInProd: true, description: 'SMTP server hostname', apps: ['api'] },
  { key: 'SMTP_PORT', required: false, requiredInProd: true, description: 'SMTP port (587 recommended)', apps: ['api'] },
  { key: 'SMTP_USER', required: false, requiredInProd: true, description: 'SMTP authentication user', apps: ['api'] },
  { key: 'SMTP_PASS', required: false, requiredInProd: true, sensitiveInProd: true, description: 'SMTP password', apps: ['api'] },
  { key: 'SMTP_FROM', required: false, requiredInProd: true, description: 'From address for outgoing emails', apps: ['api'] },
  { key: 'EMAIL_FROM_NOREPLY', required: false, description: 'From address for transactional mail; falls back to SMTP_FROM. Must be an SES-verified identity.', apps: ['api'] },
  { key: 'EMAIL_FROM_FATURA', required: false, description: 'From address for invoice mail; falls back to SMTP_FROM. Must be an SES-verified identity.', apps: ['api'] },
  { key: 'EMAIL_FROM_KAMPANYA', required: false, description: 'From address for campaign mail; falls back to SMTP_FROM. Must be an SES-verified identity.', apps: ['api'] },
  { key: 'INVOICE_ALIASING_ENABLED', required: false, requiredInProd: true, description: 'Invoice aliasing feature flag (true/false)', apps: ['all'] },
  { key: 'INBOUND_EMAIL_DOMAIN', required: false, requiredWhen: 'invoice-aliasing', description: 'Inbound invoice email domain, e.g. fatura.hanuja.com.tr', apps: ['api', 'web'] },
  { key: 'POSTMARK_INBOUND_WEBHOOK_USER', required: false, requiredWhen: 'invoice-aliasing', sensitiveInProd: true, description: 'Postmark inbound webhook basic auth user', apps: ['web'] },
  { key: 'POSTMARK_INBOUND_WEBHOOK_PASS', required: false, requiredWhen: 'invoice-aliasing', sensitiveInProd: true, description: 'Postmark inbound webhook basic auth password', apps: ['web'] },

  // App metadata
  { key: 'NEXT_PUBLIC_SITE_NAME', required: false, description: 'Site display name', apps: ['web'] },
  { key: 'NEXT_PUBLIC_SITE_URL', required: false, description: 'Canonical site URL', apps: ['web'] },
  { key: 'PREVIEW_DEPLOYMENT', required: false, requiredInProd: true, description: 'Preview deployment flag (must be false in production)', apps: ['web'] },
  { key: 'AUTO_APPROVE_CLEAN_PRODUCTS', required: false, description: 'Auto-publish clean products flag', apps: ['all'] },
]

const PLACEHOLDER_PATTERNS = [
  /replace-with/i,
  /your-/i,
  /example\.com/i,
  /changeme/i,
  /todo/i,
  /^""$/,
  /^''$/,
  /sandbox.*api.*key/i,
  /dev-turnstile-bypass/i,
]

const TURNSTILE_TEST_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
])

const TURNSTILE_TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

const PRODUCTION_URL_KEYS = new Set([
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_WEB_URL',
  'NEXT_PUBLIC_SELLER_PANEL_URL',
  'NEXT_PUBLIC_ADMIN_PANEL_URL',
  'NEXT_PUBLIC_SITE_URL',
  'SELLER_PANEL_URL',
  'ADMIN_PANEL_URL',
  'R2_PUBLIC_URL',
  'R2_CDN_URL',
])

function isForbiddenProductionUrl(key: string, value: string): boolean {
  if (!PRODUCTION_URL_KEYS.has(key)) return false

  try {
    const hostname = new URL(value).hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.sslip.io')) {
      return true
    }
    return (key === 'R2_PUBLIC_URL' || key === 'R2_CDN_URL') && hostname.endsWith('.r2.dev')
  } catch {
    return true
  }
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value))
}

function isEnabledFlag(key: 'CARD_PAYMENTS_ENABLED' | 'INVOICE_ALIASING_ENABLED'): boolean {
  return process.env[key]?.trim().toLowerCase() === 'true'
}

function isConditionalRequirementActive(requiredWhen: EnvVar['requiredWhen']): boolean {
  if (requiredWhen === 'card-payments') return isEnabledFlag('CARD_PAYMENTS_ENABLED')
  if (requiredWhen === 'invoice-aliasing') return isEnabledFlag('INVOICE_ALIASING_ENABLED')
  return false
}

// ── Checking ──────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/)
    if (m) args[m[1] ?? ''] = m[2] ?? 'true'
  }
  return args
}

function check(vars: EnvVar[], isProd: boolean): { missing: string[]; warnings: string[] } {
  const missing: string[] = []
  const warnings: string[] = []

  for (const envVar of vars) {
    const value = process.env[envVar.key]
    const conditionalRequired = isConditionalRequirementActive(envVar.requiredWhen)

    if (envVar.requiredWhen && !conditionalRequired) {
      continue
    }

    if (!value || value.trim() === '') {
      if (envVar.required || conditionalRequired || (isProd && envVar.requiredInProd)) {
        missing.push(`${envVar.key}  (${envVar.description})`)
      } else {
        warnings.push(`${envVar.key}  (optional — ${envVar.description})`)
      }
      continue
    }

    if (isProd && envVar.sensitiveInProd && isPlaceholder(value)) {
      missing.push(
        `${envVar.key}  looks like a placeholder in production: "${value.slice(0, 30)}..."`,
      )
    }

    if (
      (envVar.key === 'CARD_PAYMENTS_ENABLED' ||
        envVar.key === 'INVOICE_ALIASING_ENABLED' ||
        envVar.key === 'PREVIEW_DEPLOYMENT') &&
      !/^(true|false)$/i.test(value.trim())
    ) {
      missing.push(`${envVar.key} must be exactly true or false.`)
    }

    if (isProd && isForbiddenProductionUrl(envVar.key, value.trim())) {
      missing.push(`${envVar.key} must use a valid production domain (sslip.io, localhost and r2.dev are not allowed).`)
    }

    if (
      isProd &&
      envVar.key === 'NEXT_PUBLIC_TURNSTILE_SITE_KEY' &&
      TURNSTILE_TEST_SITE_KEYS.has(value.trim())
    ) {
      missing.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY must not use a Cloudflare test key in production.')
    }

    if (
      isProd &&
      envVar.key === 'TURNSTILE_SECRET_KEY' &&
      TURNSTILE_TEST_SECRET_KEYS.has(value.trim())
    ) {
      missing.push('TURNSTILE_SECRET_KEY must not use a Cloudflare test key in production.')
    }

    if (isProd && envVar.key === 'PREVIEW_DEPLOYMENT' && value.trim().toLowerCase() !== 'false') {
      missing.push('PREVIEW_DEPLOYMENT must be false in production.')
    }

    // Auth secret length check
    if (envVar.key === 'BETTER_AUTH_SECRET' && value.length < 32) {
      warnings.push(`BETTER_AUTH_SECRET is too short (${value.length} chars). Use at least 32.`)
    }

    if (isProd && envVar.key === 'TURNSTILE_SECRET_KEY' && value === 'dev-turnstile-bypass') {
      missing.push('TURNSTILE_SECRET_KEY must not use the development bypass token in production.')
    }
  }

  return { missing, warnings }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs()
  const isProd = args['env'] === 'prod' || args['env'] === 'production'
  const appFilter = args['app']

  const filtered = appFilter
    ? ENV_VARS.filter((v) => v.apps.includes('all') || v.apps.includes(appFilter as 'web'))
    : ENV_VARS

  const env = isProd ? 'production' : 'development'
  const scope = appFilter ? `app=${appFilter}` : 'all apps'

  console.log(`\nHanuja Environment Checker`)
  console.log(`${'─'.repeat(40)}`)
  console.log(`Mode : ${env}`)
  console.log(`Scope: ${scope}`)
  console.log(`Vars : ${filtered.length} checked\n`)

  const { missing, warnings } = check(filtered, isProd)

  if (warnings.length > 0) {
    console.log(`WARN  ${warnings.length} warning(s):`)
    for (const w of warnings) console.log(`  ~  ${w}`)
    console.log()
  }

  if (missing.length > 0) {
    console.error(`FAIL  ${missing.length} required variable(s) missing or invalid:\n`)
    for (const m of missing) console.error(`  !  ${m}`)
    console.error(`\nSet the missing variables in .env and re-run.\n`)
    process.exit(1)
  }

  console.log(`OK  All required environment variables are present.`)
  if (isProd) console.log(`    Production mode: placeholder checks passed.`)
  console.log()
  process.exit(0)
}

main()
