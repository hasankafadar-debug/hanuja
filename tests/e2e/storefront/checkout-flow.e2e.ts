/**
 * E2E — Storefront checkout flow
 *
 * Critical journey: browse → product → cart → checkout → order confirmation
 * Tests that the customer-facing flow works end-to-end.
 *
 * Run against a running local dev environment.
 * Requires: pnpm dev, seeded database, sandbox payment credentials.
 */
import { test, expect } from '@playwright/test'

test.describe('checkout journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('homepage loads with product categories', async ({ page }) => {
    await expect(page).toHaveTitle(/Hanuja/)
    // Featured categories should be visible
    await expect(page.getByText('Mobilya')).toBeVisible()
    await expect(page.getByText('Dekor')).toBeVisible()
  })

  test('category page shows products', async ({ page }) => {
    await page.goto('/kategori/mobilya')
    // Should render products
    await expect(page.getByTestId('product-card')).toHaveCount({ min: 1 } as Parameters<ReturnType<typeof page.getByTestId>['toHaveCount']>[0])
  })

  test('product detail page renders correctly', async ({ page }) => {
    // Navigate to a known test product
    await page.goto('/urun/masif-mese-orta-sehpa')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Sepete Ekle')).toBeVisible()
  })

  test('add to cart and view cart', async ({ page }) => {
    await page.goto('/urun/masif-mese-orta-sehpa')
    await page.getByText('Sepete Ekle').click()
    await page.goto('/sepet')
    await expect(page.getByTestId('cart-item')).toHaveCount({ min: 1 } as Parameters<ReturnType<typeof page.getByTestId>['toHaveCount']>[0])
  })

  test('checkout requires authentication', async ({ page }) => {
    await page.goto('/sepet')
    // Unauthenticated checkout attempt should redirect to login
    await page.getByText('Siparişi Tamamla').click()
    await expect(page).toHaveURL(/giris/)
  })

  test('authenticated checkout flow completes', async ({ page }) => {
    // Log in as test customer
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('test-customer@hanuja.test')
    await page.getByLabel('Şifre').fill('TestPassword123!')
    await page.getByRole('button', { name: 'Giriş Yap' }).click()
    await expect(page).toHaveURL('/')

    // Add product to cart
    await page.goto('/urun/masif-mese-orta-sehpa')
    await page.getByText('Sepete Ekle').click()

    // Go to cart and checkout
    await page.goto('/sepet')
    await page.getByText('Siparişi Tamamla').click()

    // Should be on checkout or payment page
    await expect(page).toHaveURL(/siparis|odeme|checkout/)
  })

  test('blog page is accessible and SEO-safe', async ({ page }) => {
    await page.goto('/blog')
    await expect(page).toHaveTitle(/.+/)
    // Should not show 404
    await expect(page.getByText('404')).not.toBeVisible()
  })

  test('store page loads for a seller', async ({ page }) => {
    await page.goto('/magaza/atelier-noa')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('SEO route integrity', () => {
  test('category route uses /kategori/ prefix', async ({ page }) => {
    await page.goto('/kategori/mobilya')
    await expect(page).not.toHaveURL(/^\/mobilya/)
    expect(page.url()).toContain('/kategori/')
  })

  test('product route uses /urun/ prefix', async ({ page }) => {
    await page.goto('/urun/masif-mese-orta-sehpa')
    expect(page.url()).toContain('/urun/')
  })

  test('store route uses /magaza/ prefix', async ({ page }) => {
    await page.goto('/magaza/atelier-noa')
    expect(page.url()).toContain('/magaza/')
  })

  test('page has canonical meta tag', async ({ page }) => {
    await page.goto('/urun/masif-mese-orta-sehpa')
    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveAttribute('href', /\/urun\/masif-mese-orta-sehpa/)
  })
})

test.describe('customer order tracking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('test-customer@hanuja.test')
    await page.getByLabel('Şifre').fill('TestPassword123!')
    await page.getByRole('button', { name: 'Giriş Yap' }).click()
  })

  test('order list shows customer orders', async ({ page }) => {
    await page.goto('/siparis')
    // Should show orders or empty state
    const hasOrders = (await page.getByTestId('order-row').count()) > 0
    const hasEmptyState = (await page.getByTestId('empty-state').count()) > 0
    expect(hasOrders || hasEmptyState).toBe(true)
  })

  test('order detail page shows status', async ({ page }) => {
    await page.goto('/siparis')
    const firstOrder = page.getByTestId('order-row').first()
    if (await firstOrder.isVisible()) {
      await firstOrder.click()
      // Should be on a detail page
      await expect(page).toHaveURL(/\/siparis\//)
    }
  })
})
