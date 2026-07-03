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

async function openFirstHref(page: Page, selector: string) {
  const href = await page.locator(selector).evaluateAll((links) => {
    for (const link of links) {
      const href = link.getAttribute('href')
      if (href?.startsWith('/')) return href
    }
    return null
  })

  expect(href).toBeTruthy()
  await safeGoto(page, href!)
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
  await expect(page.locator('a[href*="/kategori/"]').first()).toBeVisible()
  await openFirstHref(page, 'a[href*="/kategori/"]')
  await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 15_000 })
}

async function openFirstProduct(page: Page) {
  await openFirstCategory(page)
  await expect(page.locator('[data-testid="product-card"] a[href*="/urun/"]').first()).toBeVisible()
  await openFirstHref(page, '[data-testid="product-card"] a[href*="/urun/"]')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('add-to-cart')).toBeVisible({ timeout: 15_000 })
}

async function addFirstAvailableProductToCart(page: Page) {
  await page.goto('/kategori')
  await expect(page.locator('a[href*="/kategori/"]').first()).toBeVisible()

  const categoryHrefs = await page.locator('a[href*="/kategori/"]').evaluateAll((links) =>
    Array.from(
      new Set(
        links
          .map((link) => link.getAttribute('href'))
          .filter((href): href is string => Boolean(href && href.startsWith('/'))),
      ),
    ).slice(0, 5),
  )

  for (const categoryHref of categoryHrefs) {
    await page.goto(categoryHref)
    await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 15_000 })

    const productHrefs = await page.locator('[data-testid="product-card"] a[href*="/urun/"]').evaluateAll((links) =>
      Array.from(
        new Set(
          links
            .map((link) => link.getAttribute('href'))
            .filter((href): href is string => Boolean(href && href.startsWith('/'))),
        ),
      ).slice(0, 12),
    )

    for (const productHref of productHrefs) {
      await page.goto(productHref)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })

      const addToCartButton = page.getByTestId('add-to-cart')
      if ((await addToCartButton.count()) === 0) continue
      if (await addToCartButton.isDisabled()) continue

      await expect(addToCartButton).toBeVisible({ timeout: 15_000 })
      await addToCartButton.click()
      return
    }
  }

  throw new Error('Sepete eklenebilir stokta urun bulunamadi.')
}

test.beforeAll(() => {
  const scripts = [
    path.join(ROOT, 'tests/e2e/setup/ensure-test-customer.ts'),
    path.join(ROOT, 'tests/e2e/setup/ensure-customer-fixtures.ts'),
  ]

  for (const script of scripts) {
    execSync(`pnpm exec tsx "${script}"`, {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'pipe',
    })
  }
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
    await addFirstAvailableProductToCart(page)
    await safeGoto(page, '/sepet')
    await expect(page.getByTestId('cart-item').first()).toBeVisible()
  })

  test('checkout requires authentication', async ({ page }) => {
    await page.goto('/odeme')
    await expect(page).toHaveURL(/giris/, { timeout: 20_000 })
  })

  test('authenticated checkout flow completes', async ({ page }) => {
    await loginCustomer(page)
    await addFirstAvailableProductToCart(page)

    await safeGoto(page, '/sepet')
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
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await loginCustomer(page)
  })

  test('order list shows customer orders', async ({ page }) => {
    await safeGoto(page, '/siparis')
    const hasOrders = (await page.getByTestId('order-row').count()) > 0
    const hasEmptyState = (await page.getByTestId('empty-state').count()) > 0
    expect(hasOrders || hasEmptyState).toBe(true)
  })

  test('order detail page shows status', async ({ page }) => {
    await safeGoto(page, '/siparis')
    if ((await page.getByTestId('order-row').count()) > 0) {
      const detailLink = page.getByTestId('order-row').first().getByRole('link', { name: /Detay/i })
      await expect(detailLink).toBeVisible()
      const detailHref = await detailLink.getAttribute('href')
      expect(detailHref).toBeTruthy()
      await safeGoto(page, detailHref!)
      await expect(page).toHaveURL(/\/siparis\//)
      await expect(page.getByText('Bir sorun oluştu')).not.toBeVisible()
      await expect(page.getByText('Sayfa Bulunamadı')).not.toBeVisible()
      await expect(page.getByRole('heading', { name: /Sipari/i })).toBeVisible()
      await expect(page.getByTestId('status-badge')).toBeVisible()
    }
  })
})
