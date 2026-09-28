/**
 * E2E — storefront cookie notice and consent (docs/08-legal/cookie-policy-notes.md).
 *
 * Production has only strictly necessary cookies, so the site runs in info mode. Consent
 * mode is exercised with the E2E fixture, which adds fake analytics/marketing entries and
 * scripts. The fixture scripts are served by `page.route`, never from `public/`.
 *
 * Run against a local dev server (the storefront project has no webServer):
 *   info mode:     pnpm --filter web dev
 *                  pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=storefront cookie-consent
 *   consent mode:  set NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE=1 for BOTH the dev server and the test run.
 */
import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test'
import { trackHydrationErrors } from '../helpers/hydration'

const CONSENT_MODE = process.env['NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE'] === '1'
const DEV_ONLY_COOKIES = new Set(['__next_hmr_refresh_hash__'])
const FIXTURE_PATH = '/__cookie-consent-fixture/'
const NOTICE_KEY = 'hanuja-cookie-notice'
const CONSENT_KEY = 'hanuja-cookie-consent'

/**
 * Mirror of EXPECTED_EXTERNAL_HOSTS in api/lib/cookie-policy.ts (Playwright cannot load
 * that CommonJS TS module next to Node 22's own TS loader). tests/unit/cookie-policy.test.ts
 * keeps the two lists identical.
 */
const EXPECTED_EXTERNAL_HOSTS = [
  'challenges.cloudflare.com',
  '*.challenges.cloudflare.com',
  'media.hanuja.tr',
  'accounts.google.com',
  '*.r2.cloudflarestorage.com',
]

function isExpectedExternalHost(host: string): boolean {
  return EXPECTED_EXTERNAL_HOSTS.some((expected) =>
    expected.startsWith('*.') ? host.endsWith(expected.slice(1)) : host === expected,
  )
}

interface PublishedPolicy {
  version: string
  names: Set<string>
}

/** The names and version actually published on /cerez-politikasi — what visitors are told. */
async function readPublishedPolicy(page: Page): Promise<PublishedPolicy> {
  await page.goto('/cerez-politikasi', { waitUntil: 'domcontentloaded' })
  const names = await page.locator('main table tbody tr td:first-child code').allInnerTexts()
  const versionText = await page.getByText(/^Metin sürümü:/).innerText()
  return { version: versionText.replace('Metin sürümü:', '').trim(), names: new Set(names.map((name) => name.trim())) }
}

/** `__Secure-better-auth.session_data.1` is published as `better-auth.session_data`. */
function publishedNameFor(name: string): string {
  return name.replace(/^__Secure-/, '').replace(/\.\d+$/, '')
}

async function cookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).map((cookie) => cookie.name).filter((name) => !DEV_ONLY_COOKIES.has(name))
}

async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
    session: Object.keys(sessionStorage),
  }))
}

function recordRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => requests.push(request))
  return requests
}

async function gotoHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

let published: PublishedPolicy

// Read from a separate context so every test below still starts as a clean first visit.
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  published = await readPublishedPolicy(await context.newPage())
  await context.close()
  expect(published.names.size).toBeGreaterThan(0)
})

test.describe('cookie notice — info mode (production today)', () => {
  test.skip(CONSENT_MODE, 'runs without the consent fixture')

  test('A/B/K: first visit shows the notice and sets only inventoried storage', async ({ page, context }) => {
    const hydration = trackHydrationErrors(page)
    await gotoHome(page)

    const notice = page.getByRole('region', { name: 'Çerez bildirimi' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Yalnızca zorunlu çerezler')
    await expect(notice.getByRole('link', { name: /Çerez Aydınlatma Metni/ })).toHaveAttribute('href', '/cerez-politikasi')

    for (const name of await cookieNames(context)) expect(published.names.has(publishedNameFor(name)), name).toBe(true)
    expect(await storageSnapshot(page)).toEqual({ local: {}, session: [] })
    await hydration.expectNone()
  })

  test('B: "Anladım" is not consent — it only stores the notice version, locally', async ({ page }) => {
    const requests = recordRequests(page)
    await gotoHome(page)
    await page.getByRole('button', { name: 'Anladım' }).click()

    await expect(page.getByRole('region', { name: 'Çerez bildirimi' })).toHaveCount(0)
    expect(published.names.has(NOTICE_KEY)).toBe(true)
    expect((await storageSnapshot(page)).local).toEqual({ [NOTICE_KEY]: published.version })
    expect(requests.filter((request) => request.url().includes('/api/cookie-consent'))).toEqual([])

    await page.reload()
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await expect(page.getByRole('region', { name: 'Çerez bildirimi' })).toHaveCount(0)
  })

  test('G/J: footer "Çerez Tercihleri" opens the panel by keyboard and returns focus', async ({ page }) => {
    await gotoHome(page)
    const footerButton = page.locator('footer').getByRole('button', { name: 'Çerez Tercihleri' })
    await footerButton.focus()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Çerezler Hakkında' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Her Zaman Etkin')
    const switches = dialog.getByRole('switch')
    await expect(switches).toHaveCount(3)
    for (const toggle of await switches.all()) {
      await expect(toggle).toBeDisabled()
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(footerButton).toBeFocused()
  })

  test('M: the home page contacts no unexpected external host and loads no optional script', async ({ page }) => {
    const requests = recordRequests(page)
    await gotoHome(page)
    const unexpected = requests
      .map((request) => new URL(request.url()))
      .filter((url) => url.protocol.startsWith('http') && url.hostname !== 'localhost')
      .filter((url) => !isExpectedExternalHost(url.hostname))
      .map((url) => url.hostname)
    expect(unexpected).toEqual([])
    expect(requests.filter((request) => request.url().includes(FIXTURE_PATH))).toEqual([])
  })
})

test.describe('cookie notice — info mode on a phone', () => {
  test.skip(CONSENT_MODE, 'runs without the consent fixture')
  test.use({ viewport: { width: 375, height: 812 } })

  test('I: the notice fits the screen without horizontal scroll', async ({ page }) => {
    await gotoHome(page)
    const box = await page.getByRole('region', { name: 'Çerez bildirimi' }).locator('> div').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

async function serveFixtureScripts(page: Page) {
  const loads = { analytics: 0, marketing: 0 }
  await page.route(`**${FIXTURE_PATH}*.js`, async (route) => {
    const category = route.request().url().includes('analytics') ? 'analytics' : 'marketing'
    loads[category] += 1
    const body =
      category === 'analytics'
        ? "document.cookie='hanuja_e2e_analytics=1; path=/'; localStorage.setItem('hanuja_e2e_analytics','1'); window.__e2eAnalytics=true;"
        : "document.cookie='hanuja_e2e_marketing=1; path=/'; window.__e2eMarketing=true;"
    await route.fulfill({ status: 200, contentType: 'application/javascript', body })
  })
  return loads
}

async function banner(page: Page) {
  const region = page.getByRole('region', { name: 'Çerez tercihleriniz' })
  await expect(region).toBeVisible()
  return region
}

test.describe('cookie consent — consent mode (E2E fixture)', () => {
  test.skip(!CONSENT_MODE, 'needs NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE=1 on the server and the test run')

  test('M/L/K: nothing optional before a choice; the three choices look identical', async ({ page }) => {
    const loads = await serveFixtureScripts(page)
    await gotoHome(page)
    const region = await banner(page)
    expect(loads).toEqual({ analytics: 0, marketing: 0 })

    const buttons = [
      region.getByRole('button', { name: 'Tümünü kabul et' }),
      region.getByRole('button', { name: 'Tümünü reddet' }),
      region.getByRole('button', { name: 'Tercihleri yönet' }),
    ]
    const styles = await Promise.all(
      buttons.map((button) =>
        button.evaluate((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return [
            style.backgroundColor,
            style.color,
            style.fontSize,
            style.fontWeight,
            style.borderTopColor,
            style.borderTopWidth,
            Math.round(rect.width),
            Math.round(rect.height),
          ].join('|')
        }),
      ),
    )
    expect(new Set(styles).size).toBe(1)
  })

  test('C: "Tümünü reddet" loads no optional script and is recorded', async ({ page }) => {
    const loads = await serveFixtureScripts(page)
    await gotoHome(page)
    const region = await banner(page)
    const recorded = page.waitForResponse((response) => response.url().includes('/api/cookie-consent'))
    await region.getByRole('button', { name: 'Tümünü reddet' }).click()
    const response = await recorded
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ action: 'reject_all', analytics: false, marketing: false })

    await page.reload()
    await page.waitForLoadState('networkidle').catch(() => undefined)
    expect(loads).toEqual({ analytics: 0, marketing: 0 })
    await expect(page.getByRole('region', { name: 'Çerez tercihleriniz' })).toHaveCount(0)
  })

  test('D/E/F/G/H: analytics only, persisted, then withdrawn from the footer', async ({ page, context }) => {
    const loads = await serveFixtureScripts(page)
    await gotoHome(page)
    const region = await banner(page)
    await region.getByRole('button', { name: 'Tercihleri yönet' }).click()

    const dialog = page.getByRole('dialog', { name: 'Çerez Tercihleriniz' })
    await expect(dialog.getByRole('switch', { name: 'İşlevsel Çerezler' })).toBeDisabled()
    await dialog.getByRole('switch', { name: 'Analitik ve Performans Çerezleri' }).click()
    await dialog.getByRole('button', { name: 'Seçimlerimi Kaydet' }).click()
    await expect(dialog).toHaveCount(0)

    // D + E: analytics runs, marketing does not.
    await expect.poll(() => page.evaluate(() => (window as { __e2eAnalytics?: boolean }).__e2eAnalytics)).toBe(true)
    expect(loads.marketing).toBe(0)
    const stored = JSON.parse((await storageSnapshot(page)).local[CONSENT_KEY] ?? 'null')
    expect(stored).toMatchObject({ policyVersion: published.version, analytics: true, marketing: false })

    // F: survives a reload.
    await page.reload()
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await expect(page.getByRole('region', { name: 'Çerez tercihleriniz' })).toHaveCount(0)
    await expect.poll(() => loads.analytics).toBe(2)
    expect(loads.marketing).toBe(0)

    // G + H: withdraw from the footer; the page reloads and the script no longer runs.
    await page.locator('footer').getByRole('button', { name: 'Çerez Tercihleri' }).click()
    const reopened = page.getByRole('dialog', { name: 'Çerez Tercihleriniz' })
    const analyticsSwitch = reopened.getByRole('switch', { name: 'Analitik ve Performans Çerezleri' })
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')
    await analyticsSwitch.click()
    // Withdrawal reloads the page right after the response, so capture the body in flight.
    let withdrawal: unknown = null
    await page.route('**/api/cookie-consent', async (route) => {
      const response = await route.fetch()
      withdrawal = await response.json()
      await route.fulfill({ response })
    })
    const reloaded = page.waitForEvent('load')
    await reopened.getByRole('button', { name: 'Seçimlerimi Kaydet' }).click()
    await reloaded
    expect(withdrawal).toMatchObject({ action: 'withdraw', analytics: false })

    const loadsBefore = loads.analytics
    await page.goto('/cerez-politikasi')
    await page.waitForLoadState('networkidle').catch(() => undefined)
    expect(loads.analytics).toBe(loadsBefore)
    expect((await context.cookies()).some((cookie) => cookie.name === 'hanuja_e2e_analytics')).toBe(false)
    expect((await storageSnapshot(page)).local['hanuja_e2e_analytics']).toBeUndefined()
  })

  test('J: the choices are reachable and usable by keyboard', async ({ page }) => {
    await serveFixtureScripts(page)
    await gotoHome(page)
    const region = await banner(page)
    const accept = region.getByRole('button', { name: 'Tümünü kabul et' })
    await accept.focus()
    await page.keyboard.press('Tab')
    await expect(region.getByRole('button', { name: 'Tümünü reddet' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(region.getByRole('button', { name: 'Tercihleri yönet' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Çerez Tercihleriniz' })).toBeVisible()
  })
})

test.describe('cookie consent — consent mode on a phone', () => {
  test.skip(!CONSENT_MODE, 'needs NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE=1 on the server and the test run')
  test.use({ viewport: { width: 375, height: 812 } })

  test('I: the consent box fits the screen without horizontal scroll', async ({ page }) => {
    await serveFixtureScripts(page)
    await gotoHome(page)
    const box = await (await banner(page)).locator('> div').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})
