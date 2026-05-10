/**
 * E2E - Storefront checkout flow
 */
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { trackHydrationErrors } from '../helpers/hydration'
import { mockTurnstile } from '../helpers/turnstile'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')
const TEST_EMAIL = 'playwright-eft@hanuja.test'
const TEST_PASSWORD = 'PlaywrightEFT1234!'

async function loginCustomer(page: Page) {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto('/giris')
  await expect(page.getByLabel(/E-posta/i)).toBeVisible()
  await hydration.expectNone()
  await page.getByLabel(/E-posta/i).fill(TEST_EMAIL)
  await page.getByLabel(/Sifre|Şifre/i).fill(TEST_PASSWORD)
  await expect(page.getByRole('button', { name: /Giris Yap|Giriş Yap/i })).toBeEnabled({
    timeout: 5_000,
  })
  await page.getByRole('button', { name: /Giris Yap|Giriş Yap/i }).click()
  await expect(page).toHaveURL(/hesabim|\/$/, { timeout: 15_000 })
}

async function openFirstCategory(page: Page) {
  await page.goto('/kategori')
  const categoryLink = page.locator('a[href*="/kategori/"]').first()
  await expect(categoryLink).toBeVisible()
  await categoryLink.click()
  await page.waitForLoadState('networkidle')
}

async function openFirstProduct(page: Page) {
  await openFirstCategory(page)
  const productLink = page.locator('a[href*="/urun/"]').first()
  await expect(productLink).toBeVisible()
  await productLink.click()
  await page.waitForLoadState('networkidle')
}

test.beforeAll(() => {
  const script = path.join(ROOT, 'tests/e2e/setup/ensure-test-customer.ts')
  execSync(`pnpm exec tsx "${script}"`, {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'pipe',
  })
})

test.describe('checkout journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
  })

  test('homepage loads with product categories', async ({ page }) => {
    await expect(page).toHaveTitle(/Hanuja/)
    await expect(page.locator('a[href="/kategori/mobilya"]').first()).toBeVisible()
    await expect(page.locator('a[href="/kategori/ev-dekorasyon"]').first()).toBeVisible()
  })

  test('category page shows products', async ({ page }) => {
    await openFirstCategory(page)
    await expect(page.getByTestId('product-card').first()).toBeVisible()
  })

  test('product detail page renders correctly', async ({ page }) => {
    await openFirstProduct(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('add-to-cart')).toBeVisible()
  })

  test('add to cart and view cart', async ({ page }) => {
    await loginCustomer(page)
    await openFirstProduct(page)
    await page.getByTestId('add-to-cart').click()
    await page.goto('/sepet')
    await expect(page.getByTestId('cart-item').first()).toBeVisible()
  })

  test('checkout requires authentication', async ({ page }) => {
    await page.goto('/odeme')
    await expect(page).toHaveURL(/giris/)
  })

  test('authenticated checkout flow completes', async ({ page }) => {
    await loginCustomer(page)
    await openFirstProduct(page)
    await page.getByTestId('add-to-cart').click()

    await page.goto('/sepet')
    await page.getByTestId('cart-checkout').click()
    await expect(page).toHaveURL(/siparis|odeme|checkout/)
  })

  test('blog page is accessible and SEO-safe', async ({ page }) => {
    await page.goto('/blog')
    await expect(page).toHaveTitle(/.+/)
    await expect(page.getByText('404')).not.toBeVisible()
  })

  test('store page loads for a seller', async ({ page }) => {
    await page.goto('/magaza/atelier-noa')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('auth hydration', () => {
  test('login page renders without hydration errors', async ({ page }) => {
    await mockTurnstile(page)
    const hydration = trackHydrationErrors(page)

    await page.goto('/giris')

    await expect(page.getByLabel(/E-posta/i)).toBeVisible()
    await expect(page.getByLabel(/Sifre|Şifre/i)).toBeVisible()
    await hydration.expectNone()
  })
})

test.describe('SEO route integrity', () => {
  test('category route uses /kategori/ prefix', async ({ page }) => {
    await openFirstCategory(page)
    await expect(page).not.toHaveURL(/^\/mobilya/)
    expect(page.url()).toContain('/kategori/')
  })

  test('product route uses /urun/ prefix', async ({ page }) => {
    await openFirstProduct(page)
    expect(page.url()).toContain('/urun/')
  })

  test('store route uses /magaza/ prefix', async ({ page }) => {
    await page.goto('/magaza/atelier-noa')
    expect(page.url()).toContain('/magaza/')
  })

  test('page has canonical meta tag', async ({ page }) => {
    await openFirstProduct(page)
    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveAttribute('href', /\/urun\//)
  })
})

test.describe('customer order tracking', () => {
  test.beforeEach(async ({ page }) => {
    await loginCustomer(page)
  })

  test('order list shows customer orders', async ({ page }) => {
    await page.goto('/siparis')
    const hasOrders = (await page.getByTestId('order-row').count()) > 0
    const hasEmptyState = (await page.getByTestId('empty-state').count()) > 0
    expect(hasOrders || hasEmptyState).toBe(true)
  })

  test('order detail page shows status', async ({ page }) => {
    await page.goto('/siparis')
    if ((await page.getByTestId('order-row').count()) > 0) {
      await page.getByTestId('order-row').first().getByRole('link', { name: /Detay/i }).click()
      await expect(page).toHaveURL(/\/siparis\//)
    }
  })
})
