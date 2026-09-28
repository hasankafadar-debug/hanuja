/**
 * Cookie / storage / network audit for the storefront.
 *
 * Opens the site in a clean Chromium profile, visits public pages and compares what the
 * browser really stores and contacts with the inventory in api/lib/cookie-policy.ts.
 * The /cerez-politikasi table must never list a guessed name — this is how names are verified.
 *
 * Usage:
 *   pnpm cookie:audit                                      # http://localhost:3000
 *   pnpm cookie:audit --base-url=https://www.hanuja.com.tr # production, public pages only
 *   pnpm cookie:audit --login                              # localhost only: also sign in
 *                                                          # (COOKIE_AUDIT_EMAIL / COOKIE_AUDIT_PASSWORD)
 *   pnpm cookie:audit --google                             # also click "Google ile giriş yap";
 *                                                          # the redirect to Google is blocked
 *
 * Exits 1 when a first-party cookie or storage key is not in the inventory, or the browser
 * contacts a host that is not in EXPECTED_EXTERNAL_HOSTS. The full report is written to
 * outputs/cookie-audit-<host>-<timestamp>.json. docs/08-legal/cookie-policy-notes.md
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Cookie, type Page } from '@playwright/test'
import {
  COOKIE_POLICY_VERSION,
  getBaseCookieInventory,
  isExpectedExternalHost,
} from '../../api/lib/cookie-policy'

const DEFAULT_PAGES = ['/', '/urunler', '/giris', '/kayit', '/sepet', '/cerez-politikasi', '/kvkk']
/** Next.js dev-server only; never present in a production build. */
const DEV_ONLY_COOKIES = new Set(['__next_hmr_refresh_hash__'])

function parseArgs(): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=')
    if (key) args[key] = value ?? true
  }
  return args
}

function inventoryKeyFor(name: string): string | null {
  return getBaseCookieInventory().find((entry) => new RegExp(entry.namePattern).test(name))?.key ?? null
}

function isLocalhost(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost')
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

async function readStorage(page: Page) {
  return page.evaluate(async () => {
    const databases =
      typeof indexedDB !== 'undefined' && 'databases' in indexedDB
        ? (await indexedDB.databases()).map((db) => db.name ?? '')
        : []
    return {
      origin: location.origin,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      indexedDB: databases,
    }
  })
}

async function main() {
  const args = parseArgs()
  const baseUrl = new URL(typeof args['base-url'] === 'string' ? args['base-url'] : 'http://localhost:3000')
  // Pages may be given without the leading "/" (Git Bash rewrites "/x" into a Windows path).
  const pages =
    typeof args['pages'] === 'string'
      ? args['pages'].split(',').map((page) => (page.startsWith('/') ? page : `/${page}`))
      : DEFAULT_PAGES
  const local = isLocalhost(baseUrl)

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const hosts = new Map<string, number>()
  const setCookieHeaders: { url: string; names: string[] }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.protocol.startsWith('http')) return
    hosts.set(url.hostname, (hosts.get(url.hostname) ?? 0) + 1)
  })
  page.on('response', async (response) => {
    const headers = await response.headersArray().catch(() => [])
    const names = headers
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .flatMap((header) => header.value.split('\n'))
      .map((value) => value.split('=')[0]?.trim() ?? '')
      .filter(Boolean)
    if (names.length > 0) setCookieHeaders.push({ url: response.url(), names })
  })

  const storage: Awaited<ReturnType<typeof readStorage>>[] = []
  const visited: string[] = []
  const notes: string[] = []

  for (const pathname of pages) {
    const url = new URL(pathname, baseUrl).toString()
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((error: Error) => {
      notes.push(`${pathname}: ${error.message}`)
      return null
    })
    await settle(page)
    visited.push(`${pathname} → ${response?.status() ?? 'failed'}`)
    storage.push(await readStorage(page))
  }

  // One product detail page, discovered from the listing rather than guessed.
  await page.goto(new URL('/urunler', baseUrl).toString(), { waitUntil: 'domcontentloaded' })
  await settle(page)
  const productHref = await page
    .locator('a[href^="/urun/"]')
    .first()
    .getAttribute('href')
    .catch(() => null)
  if (productHref) {
    await page.goto(new URL(productHref, baseUrl).toString(), { waitUntil: 'domcontentloaded' })
    await settle(page)
    visited.push(`${productHref} → visited`)
    storage.push(await readStorage(page))
  }

  if (args['login']) {
    const email = process.env['COOKIE_AUDIT_EMAIL']
    const password = process.env['COOKIE_AUDIT_PASSWORD']
    if (!local) notes.push('login skipped: only allowed against localhost')
    else if (!email || !password) notes.push('login skipped: COOKIE_AUDIT_EMAIL / COOKIE_AUDIT_PASSWORD not set')
    else {
      const result = await page.request.post(new URL('/api/auth/sign-in/email', baseUrl).toString(), {
        data: { email, password },
        // Local dev only: api/lib/turnstile.ts accepts this token when no secret key is set.
        headers: { origin: baseUrl.origin, 'x-captcha-response': 'dev-turnstile-bypass' },
      })
      notes.push(`login: HTTP ${result.status()}${result.ok() ? '' : ` ${(await result.text()).slice(0, 200)}`}`)
      await page.goto(new URL('/hesabim', baseUrl).toString(), { waitUntil: 'domcontentloaded' })
      await settle(page)
      storage.push(await readStorage(page))
    }
  }

  if (args['google']) {
    await context.route('https://accounts.google.com/**', (route) => route.abort())
    await page.goto(new URL('/giris', baseUrl).toString(), { waitUntil: 'domcontentloaded' })
    await settle(page)
    const googleButton = page.getByRole('button', { name: /Google ile giriş/i })
    if ((await googleButton.count()) === 0) notes.push('google: button not shown (GOOGLE_CLIENT_ID/SECRET not set)')
    else {
      await googleButton.click()
      await page.waitForTimeout(3_000)
      notes.push('google: clicked; redirect to accounts.google.com blocked')
    }
  }

  const cookies: Cookie[] = (await context.cookies()).filter((cookie) => !(local && DEV_ONLY_COOKIES.has(cookie.name)))
  await browser.close()

  const siteHost = baseUrl.hostname
  const cookieRows = cookies.map((cookie) => {
    const domain = cookie.domain.replace(/^\./, '')
    const firstParty = siteHost === domain || siteHost.endsWith(`.${domain}`)
    return {
      name: cookie.name,
      domain: cookie.domain,
      party: firstParty ? 'first' : 'third',
      expiresInDays: cookie.expires > 0 ? Math.round((cookie.expires * 1000 - Date.now()) / 86_400_000) : 'session',
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      inventoryKey: inventoryKeyFor(cookie.name),
    }
  })
  const storageKeys = [...new Set(storage.flatMap((snapshot) => [...snapshot.local, ...snapshot.session]))]
  const storageRows = storageKeys.map((key) => ({ key, inventoryKey: inventoryKeyFor(key) }))
  const indexedDbNames = [...new Set(storage.flatMap((snapshot) => snapshot.indexedDB))]
  const hostRows = [...hosts.entries()]
    .filter(([host]) => host !== siteHost)
    .map(([host, count]) => ({ host, count, expected: isExpectedExternalHost(host) }))

  const failures = [
    ...cookieRows.filter((row) => row.party === 'first' && !row.inventoryKey).map((row) => `unknown cookie ${row.name}`),
    ...cookieRows.filter((row) => row.party === 'third').map((row) => `third-party cookie ${row.name} (${row.domain})`),
    ...storageRows.filter((row) => !row.inventoryKey).map((row) => `unknown storage key ${row.key}`),
    ...indexedDbNames.map((name) => `IndexedDB database ${name}`),
    ...hostRows.filter((row) => !row.expected).map((row) => `unexpected external host ${row.host}`),
  ]

  const report = {
    baseUrl: baseUrl.origin,
    policyVersion: COOKIE_POLICY_VERSION,
    auditedAt: new Date().toISOString(),
    visited,
    notes,
    cookies: cookieRows,
    storage: storageRows,
    indexedDB: indexedDbNames,
    externalHosts: hostRows,
    setCookieHeaders,
    failures,
  }

  const outDir = path.resolve(__dirname, '../../outputs')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `cookie-audit-${siteHost}-${Date.now()}.json`)
  writeFileSync(outFile, JSON.stringify(report, null, 2))

  console.log(`\nCookie audit — ${baseUrl.origin} (policy ${COOKIE_POLICY_VERSION})`)
  console.log('Visited:', visited.join(', '))
  if (notes.length > 0) console.log('Notes:', notes.join(' | '))
  console.table(cookieRows)
  console.table(storageRows)
  console.table(hostRows)
  console.log(`Report: ${outFile}`)
  if (failures.length > 0) {
    console.error('\nNot in the inventory / unexpected:\n  ' + failures.join('\n  '))
    process.exit(1)
  }
  console.log('\nEverything the browser stored or contacted is in the inventory.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
