import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const checkEnvScript = 'tools/scripts/check-env.ts'
const testTurnstileSecret = '1x0000000000000000000000000000000AA'

const workerEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: 'postgresql://worker.example.internal:5432/hanuja_prod',
  REDIS_URL: 'redis://redis.example.internal:6379',
  BETTER_AUTH_SECRET: 'local-check-env-secret-value-1234567890',
  NEXT_PUBLIC_WEB_URL: 'https://www.hanuja.com.tr',
  NEXT_PUBLIC_SELLER_PANEL_URL: 'https://satici.hanuja.com.tr',
  NEXT_PUBLIC_ADMIN_PANEL_URL: 'https://admin.hanuja.com.tr',
  SELLER_PANEL_URL: 'https://satici.hanuja.com.tr',
  ADMIN_PANEL_URL: 'https://admin.hanuja.com.tr',
  CARD_PAYMENTS_ENABLED: 'false',
  INVOICE_ALIASING_ENABLED: 'false',
  INVOICE_MANAGEMENT_ENABLED: 'false',
  PRIVATE_DOCUMENT_ROOT: '/var/lib/hanuja/private-documents',
  R2_ACCOUNT_ID: 'account-id',
  R2_ACCESS_KEY_ID: 'access-key-id',
  R2_SECRET_ACCESS_KEY: 'local-secret-value',
  R2_BUCKET_NAME: 'hanuja-media-test',
  R2_PUBLIC_URL: 'https://media.hanuja.tr',
  MEILISEARCH_URL: 'http://meilisearch.example.internal:7700',
  MEILISEARCH_ADMIN_KEY: 'local-meilisearch-admin-key',
  SMTP_HOST: 'smtp.resend.com',
  SMTP_PORT: '465',
  SMTP_USER: 'resend',
  SMTP_PASS: 'local-resend-key',
  SMTP_FROM: 'Hanuja <noreply@hanuja.com.tr>',
}

function runCheck(app: string, env = workerEnv) {
  const result = spawnSync(process.execPath, [
    resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
    checkEnvScript,
    '--env=prod',
    `--app=${app}`,
  ], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

describe('production environment guard scopes', () => {
  it('accepts the documented worker environment without a browser Turnstile secret', () => {
    const result = runCheck('worker')

    expect(result.status).toBe(0)
    expect(result.output).toContain('OK  All required environment variables are present.')
  })

  it('keeps rejecting shared production URLs that use sslip.io', () => {
    const env = { ...workerEnv, NEXT_PUBLIC_WEB_URL: 'https://web.77-245-158-7.sslip.io' }
    const result = runCheck('worker', env)

    expect(result.status).toBe(1)
    expect(result.output).toContain('NEXT_PUBLIC_WEB_URL must use a valid production domain')
  })

  it('requires an absolute mounted private-document directory for the worker', () => {
    for (const value of ['', 'relative/private-documents']) {
      const result = runCheck('worker', { ...workerEnv, PRIVATE_DOCUMENT_ROOT: value })
      expect(result.status).toBe(1)
      expect(result.output).toContain('PRIVATE_DOCUMENT_ROOT')
    }
  })

  it('rejects invalid invoice-management rollout flags', () => {
    const result = runCheck('worker', { ...workerEnv, INVOICE_MANAGEMENT_ENABLED: 'enabled' })
    expect(result.status).toBe(1)
    expect(result.output).toContain('INVOICE_MANAGEMENT_ENABLED must be exactly true or false.')
  })

  it('still rejects a Cloudflare test secret for the API scope', () => {
    const env = { ...workerEnv, TURNSTILE_SECRET_KEY: testTurnstileSecret }
    const result = runCheck('api', env)

    expect(result.status).toBe(1)
    expect(result.output).toContain('TURNSTILE_SECRET_KEY must not use a Cloudflare test key in production.')
  })

  it('rejects unknown app scopes instead of silently applying the wrong rules', () => {
    const result = runCheck('worker-with-typo')

    expect(result.status).toBe(1)
    expect(result.output).toContain('Unknown app scope: worker-with-typo')
  })

  it('requires the inbound domain on seller/admin only when aliasing is enabled', () => {
    for (const app of ['seller-panel', 'admin-panel']) {
      const env = {
        ...workerEnv, INVOICE_ALIASING_ENABLED: 'true', INBOUND_EMAIL_DOMAIN: '',
        BETTER_AUTH_URL: 'https://www.hanuja.com.tr', NEXT_PUBLIC_APP_URL: 'https://www.hanuja.com.tr',
        TURNSTILE_SECRET_KEY: 'local-valid-secret-value', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'local-valid-site-key',
      }
      const result = runCheck(app, env)
      expect(result.status).toBe(1)
      expect(result.output).toContain('INBOUND_EMAIL_DOMAIN')
      expect(result.output).not.toContain('POSTMARK_INBOUND_WEBHOOK_PASS')
    }
  })

  it('requires Resend receiving secrets on web without requiring legacy Postmark credentials', () => {
    const env = {
      ...workerEnv, INVOICE_ALIASING_ENABLED: 'true', INBOUND_EMAIL_DOMAIN: 'fatura.hanuja.com.tr',
      RESEND_RECEIVING_API_KEY: '', RESEND_INBOUND_WEBHOOK_SECRET: '',
      POSTMARK_INBOUND_WEBHOOK_USER: '', POSTMARK_INBOUND_WEBHOOK_PASS: '',
      BETTER_AUTH_URL: 'https://www.hanuja.com.tr', NEXT_PUBLIC_APP_URL: 'https://www.hanuja.com.tr',
      TURNSTILE_SECRET_KEY: 'local-valid-secret-value', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'local-valid-site-key',
      MEILISEARCH_SEARCH_KEY: 'local-search-key', PREVIEW_DEPLOYMENT: 'false',
    }
    const result = runCheck('web', env)
    expect(result.status).toBe(1)
    expect(result.output).toContain('RESEND_RECEIVING_API_KEY')
    expect(result.output).toContain('RESEND_INBOUND_WEBHOOK_SECRET')
    expect(result.output).not.toMatch(/!\s+POSTMARK_INBOUND_WEBHOOK_PASS/)
  })
})
