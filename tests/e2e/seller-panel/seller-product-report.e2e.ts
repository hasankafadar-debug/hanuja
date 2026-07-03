import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  CUSTOMER_FIXTURE,
  TEST_EMAIL,
  TEST_PASSWORD,
} from '../setup/customer-fixture-data'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')

const WEB_URL = 'http://localhost:3000'
const SELLER_PANEL_URL = 'http://localhost:3001'
const SELLER_EMAIL = 'satici@atelyenoa.com'
const SELLER_PASSWORD = 'Seller1234!'

function utcDateInput(date = new Date()) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function safeGoto(page: Page, href: string) {
  try {
    await page.goto(href, { waitUntil: 'domcontentloaded' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('ERR_ABORTED')) throw error
    await page.goto(href, { waitUntil: 'domcontentloaded' })
  }
}

async function signIn(context: BrowserContext, baseURL: string, email: string, password: string) {
  const response = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
    data: {
      email,
      password,
      callbackURL: '/',
    },
  })

  expect(response.ok()).toBe(true)
  const body = (await response.json()) as { user?: { email?: string }; error?: unknown }
  expect(body.error).toBeFalsy()
  expect(body.user?.email).toBe(email)
}

function runTsxScript(script: string) {
  execSync(`pnpm exec tsx "${path.join(ROOT, script)}"`, {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'pipe',
  })
}

function cleanupReportFixture() {
  runTsxScript('tests/e2e/setup/cleanup-seller-product-report.ts')
}

async function readCount(row: ReturnType<Page['getByTestId']>, testId: string) {
  const text = (await row.getByTestId(testId).textContent())?.trim() ?? ''
  const normalized = text.replace(/[^\d]/g, '')
  return Number(normalized || '0')
}

async function runCustomerProductActions(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await signIn(context, WEB_URL, TEST_EMAIL, TEST_PASSWORD)

    const viewResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/products/${CUSTOMER_FIXTURE.productSlug}/view`) &&
      response.request().method() === 'POST',
    )

    await safeGoto(page, `${WEB_URL}/urun/${CUSTOMER_FIXTURE.productSlug}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })

    const viewResponse = await viewResponsePromise
    expect(viewResponse.status()).toBe(200)

    const favoriteResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/user/favorites') &&
      response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: /Favorilere ekle/i }).click()
    const favoriteResponse = await favoriteResponsePromise
    expect(favoriteResponse.ok()).toBe(true)

    const cartResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/cart') &&
      response.request().method() === 'POST',
    )
    await page.getByTestId('add-to-cart').click()
    const cartResponse = await cartResponsePromise
    expect(cartResponse.ok()).toBe(true)
  } finally {
    await context.close()
  }
}

async function verifySellerReport(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await signIn(context, SELLER_PANEL_URL, SELLER_EMAIL, SELLER_PASSWORD)

    const today = utcDateInput()
    await safeGoto(page, `${SELLER_PANEL_URL}/rapor?from=${today}&to=${today}`)
    await expect(page.getByTestId('seller-report-page')).toBeVisible({ timeout: 15_000 })

    const row = page.getByTestId(`report-row-${CUSTOMER_FIXTURE.productSlug}`)
    await expect(row).toBeVisible({ timeout: 15_000 })

    await expect.poll(() => readCount(row, 'report-viewed')).toBeGreaterThanOrEqual(1)
    await expect.poll(() => readCount(row, 'report-favorited')).toBeGreaterThanOrEqual(1)
    await expect.poll(() => readCount(row, 'report-cart')).toBeGreaterThanOrEqual(1)

    const productLink = row.locator(`a[href$="/urun/${CUSTOMER_FIXTURE.productSlug}"]`).first()
    await expect(productLink).toBeVisible()
    await expect(productLink).toHaveAttribute(
      'href',
      `${WEB_URL}/urun/${CUSTOMER_FIXTURE.productSlug}`,
    )
  } finally {
    await context.close()
  }
}

test.beforeAll(() => {
  const scripts = [
    'tests/e2e/setup/ensure-test-customer.ts',
    'tests/e2e/setup/ensure-customer-fixtures.ts',
    'db/seeds/reset-seller-passwords.ts',
  ]

  for (const script of scripts) {
    runTsxScript(script)
  }
})

test.describe('seller product report analytics', () => {
  test.describe.configure({ timeout: 120_000 })

  test('customer view, favorite and cart actions appear in seller report', async ({ browser }) => {
    cleanupReportFixture()
    await runCustomerProductActions(browser)
    await verifySellerReport(browser)
  })
})
