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
  { key: 'BETTER_AUTH_URL', required: true, description: 'Auth base URL (web app URL)', apps: ['web'] },
  { key: 'NEXT_PUBLIC_APP_URL', required: true, description: 'Public web app URL', apps: ['web'] },
  { key: 'SELLER_PANEL_URL', required: true, description: 'Seller panel base URL', apps: ['all'] },
  { key: 'ADMIN_PANEL_URL', required: true, description: 'Admin panel base URL', apps: ['all'] },

  // Payment
  { key: 'IYZICO_API_KEY', required: true, sensitiveInProd: true, description: 'Iyzico API key', apps: ['api'] },
  { key: 'IYZICO_SECRET_KEY', required: true, sensitiveInProd: true, description: 'Iyzico secret key', apps: ['api'] },
  { key: 'IYZICO_BASE_URL', required: true, description: 'Iyzico base URL (sandbox or live)', apps: ['api'] },
  { key: 'IYZICO_WEBHOOK_SECRET', required: true, sensitiveInProd: true, description: 'Iyzico webhook HMAC secret', apps: ['api'] },

  // Storage
  { key: 'R2_ACCOUNT_ID', required: true, description: 'Cloudflare R2 account ID', apps: ['api'] },
  { key: 'R2_ACCESS_KEY_ID', required: true, sensitiveInProd: true, description: 'R2 access key', apps: ['api'] },
  { key: 'R2_SECRET_ACCESS_KEY', required: true, sensitiveInProd: true, description: 'R2 secret access key', apps: ['api'] },
  { key: 'R2_BUCKET_NAME', required: true, description: 'R2 bucket name', apps: ['api'] },
  { key: 'R2_PUBLIC_URL', required: true, description: 'R2 public CDN URL', apps: ['api'] },

  // Search
  { key: 'MEILISEARCH_URL', required: true, description: 'Meilisearch server URL', apps: ['all'] },
  { key: 'MEILISEARCH_ADMIN_KEY', required: true, sensitiveInProd: true, description: 'Meilisearch admin API key', apps: ['api'] },
  { key: 'MEILISEARCH_SEARCH_KEY', required: true, description: 'Meilisearch public search key', apps: ['web'] },

  // Email
  { key: 'SMTP_HOST', required: false, description: 'SMTP server hostname', apps: ['api'] },
  { key: 'SMTP_PORT', required: false, description: 'SMTP port (587 recommended)', apps: ['api'] },
  { key: 'SMTP_USER', required: false, description: 'SMTP authentication user', apps: ['api'] },
  { key: 'SMTP_PASS', required: false, sensitiveInProd: true, description: 'SMTP password', apps: ['api'] },
  { key: 'SMTP_FROM', required: false, description: 'From address for outgoing emails', apps: ['api'] },

  // App metadata
  { key: 'NEXT_PUBLIC_SITE_NAME', required: false, description: 'Site display name', apps: ['web'] },
  { key: 'NEXT_PUBLIC_SITE_URL', required: false, description: 'Canonical site URL', apps: ['web'] },
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
]

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value))
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

    if (!value || value.trim() === '') {
      if (envVar.required) {
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

    // Auth secret length check
    if (envVar.key === 'BETTER_AUTH_SECRET' && value.length < 32) {
      warnings.push(`BETTER_AUTH_SECRET is too short (${value.length} chars). Use at least 32.`)
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
