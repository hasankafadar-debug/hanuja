/**
 * The API origin guard rejects mutations that carry no browser Origin.
 * Endpoints that a third party calls from its own servers (payment provider,
 * mail provider webhooks, inbound mail, RFC 8058 one-click unsubscribe) never
 * send one, so each must be an explicit, exact exemption. This test derives
 * those endpoints from the filesystem and the unsubscribe URL contract so a
 * new webhook or a moved unsubscribe path cannot silently start returning 403.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { isApiMutationOriginAllowed } from '../../packages/security/src/request-origin'
import { isValidMarketingUnsubscribeUrl } from '../../api/lib/email-templates/marketing-footer'

const ROOT = resolve(__dirname, '../..')
const CANONICAL = 'https://www.hanuja.com.tr'

function routeFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === 'route.ts' ? [path] : []
  })
}

function exportsPost(file: string): boolean {
  return /export\s+(async\s+)?(function|const)\s+POST\b/.test(readFileSync(file, 'utf8'))
}

function apiPath(appDir: string, file: string): string {
  const rel = relative(join(appDir, 'src', 'app'), file).split(sep).join('/')
  return `/${rel.replace(/\/route\.ts$/, '')}`
}

function providerPost(path: string): Request {
  // Server-to-server: no Origin, no Sec-Fetch-Site, no cookies.
  return new Request(`${CANONICAL}${path}`, { method: 'POST', body: 'x' })
}

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', CANONICAL))
afterEach(() => vi.unstubAllEnvs())

describe('web endpoints called by third-party servers', () => {
  const webDir = join(ROOT, 'apps', 'web')
  const providerRoutes = [
    ...routeFiles(join(webDir, 'src', 'app', 'api', 'webhooks')),
    ...routeFiles(join(webDir, 'src', 'app', 'api', 'inbound')),
    join(webDir, 'src', 'app', 'api', 'payment', 'callback', 'route.ts'),
  ].filter(exportsPost).map((file) => apiPath(webDir, file))

  it('finds the provider routes this guard is meant to cover', () => {
    expect(providerRoutes).toEqual(expect.arrayContaining([
      '/api/webhooks/iyzico',
      '/api/webhooks/resend',
      '/api/inbound/postmark',
      '/api/payment/callback',
    ]))
  })

  it.each(providerRoutes)('lets %s reach its own signature check', (path) => {
    expect(isApiMutationOriginAllowed(providerPost(path), CANONICAL, 'web')).toBe(true)
  })

  it('lets the List-Unsubscribe-Post target accepted by the mailer reach its token check', () => {
    const unsubscribeUrl = `${CANONICAL}/api/marketing/unsubscribe?token=opt-out-token`
    expect(isValidMarketingUnsubscribeUrl(unsubscribeUrl)).toBe(true)
    const { pathname, search } = new URL(unsubscribeUrl)
    expect(isApiMutationOriginAllowed(providerPost(`${pathname}${search}`), CANONICAL, 'web')).toBe(true)
  })

  it('does not treat ordinary browser mutations as provider endpoints', () => {
    for (const path of ['/api/payment/start', '/api/user/marketing-consent', '/api/cart/items']) {
      expect(isApiMutationOriginAllowed(providerPost(path), CANONICAL, 'web')).toBe(false)
    }
  })
})

describe.each(['seller-panel', 'admin-panel'])('%s has no third-party POST endpoints', (app) => {
  // The panel surface has no exemptions. Adding a webhook/inbound/callback
  // route here needs an explicit decision in request-origin.ts first.
  it('has no webhook, inbound or callback route directories', () => {
    const apiDir = join(ROOT, 'apps', app, 'src', 'app', 'api')
    const offending = routeFiles(apiDir)
      .map((file) => relative(apiDir, file).split(sep).join('/'))
      .filter((path) => /(^|\/)(webhooks?|inbound|callback)(\/|$)/.test(path))
    expect(offending).toEqual([])
  })
})
