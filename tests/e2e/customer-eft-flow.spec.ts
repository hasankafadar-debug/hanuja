/**
 * Müşteri E2E Testi — Havale/EFT Akışı
 *
 * Kapsam:
 *  1. Statik yasal sayfalar (6 sayfa)
 *  2. Kayıt formu görünür ve gönderilebilir
 *  3. Giriş (seeded test müşteri)
 *  4. Anasayfa → kategori → ürün detayı
 *  5. Sepet: ürün ekle, adet değiştir
 *  6. Ödeme (EFT): adres seç → sözleşmeleri onayla → sipariş ver
 *  7. Sipariş onay sayfası: durum + sözleşme linkleri
 *  8. Sipariş listesi: sipariş görünür
 *
 * Önkoşullar (altyapı setup adımlarında tamamlandı):
 *  - Docker: postgres :5432, redis :6379, meilisearch :7700
 *  - pnpm dev: web :3000, seller-panel :3001, admin-panel :3002
 *  - pnpm worker:dev çalışıyor
 *  - .env: TURNSTILE test anahtarları ve PLATFORM_BANK_* ayarlı
 */

import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { trackHydrationErrors } from './helpers/hydration'
import { mockTurnstile } from './helpers/turnstile'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../..')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const TEST_EMAIL = 'playwright-eft@hanuja.test'
const TEST_PASSWORD = 'PlaywrightEFT1234!'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

// ─── Yardımcı: Giriş yap ────────────────────────────────────────────────────
async function loginCustomer(page: Page) {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto(`${BASE_URL}/giris`)
  await expect(page.locator('#email')).toBeVisible({ timeout: 5000 })
  await hydration.expectNone()
  await page.fill('#email', TEST_EMAIL)
  await page.fill('#password', TEST_PASSWORD)
  // Turnstile mock 60ms'de token'ı set eder; buton aktif olur
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5000 })
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/hesabim**`, { timeout: 15000 })
}

async function addFirstAvailableProductToCart(page: Page) {
  await page.goto(`${BASE_URL}/kategori`)
  await page.waitForLoadState('networkidle')

  const categoryUrls = (
    await page.locator('a[href*="/kategori/"]').evaluateAll((links) =>
      Array.from(
        new Set(
          links
            .map((link) => link.getAttribute('href'))
            .filter((href): href is string => Boolean(href)),
        ),
      ).slice(0, 5),
    )
  ).map((href) => (href.startsWith('http') ? href : `${BASE_URL}${href}`))

  for (const categoryUrl of categoryUrls) {
    await page.goto(categoryUrl)
    await page.waitForLoadState('networkidle')

    const productUrls = await page.locator('a[href*="/urun/"]').evaluateAll((links) =>
      Array.from(
        new Set(
          links
            .map((link) => link.getAttribute('href'))
            .filter((href): href is string => Boolean(href)),
        ),
      ).slice(0, 12),
    )

    for (const productHref of productUrls) {
      const productUrl = productHref.startsWith('http') ? productHref : `${BASE_URL}${productHref}`
      await page.goto(productUrl)
      await page.waitForLoadState('networkidle')

      const addToCartButton = page.getByTestId('add-to-cart')
      if ((await addToCartButton.count()) === 0) continue
      if (await addToCartButton.isDisabled()) continue

      await expect(addToCartButton).toBeVisible({ timeout: 5000 })
      await addToCartButton.click()
      await page.waitForTimeout(600)
      return
    }
  }

  throw new Error('Sepete eklenebilir stokta ürün bulunamadı.')
}

// ─── Setup: Test müşterisini DB'de hazırla ───────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Statik yasal sayfalar
// ═══════════════════════════════════════════════════════════════════
test('statik yasal sayfaların tümü 200 döndürür ve başlık içerir', async ({ page }) => {
  const legalPaths = [
    '/kullanim-kosullari',
    '/gizlilik-politikasi',
    '/kvkk',
    '/mesafeli-satis',
    '/on-bilgilendirme',
    '/iade-iptal',
  ]

  for (const p of legalPaths) {
    const res = await page.goto(`${BASE_URL}${p}`)
    expect(res?.status(), `${p} 200 dönmeli`).toBe(200)
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  }
})

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Kayıt formu
// ═══════════════════════════════════════════════════════════════════
test('kayıt formu hydration hatası olmadan yüklenir ve Turnstile ile gönderime hazır olur', async ({
  page,
}) => {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto(`${BASE_URL}/kayit`)
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  await hydration.expectNone()

  // Formu doldur
  await page.fill('#name', 'Yeni Üye Test')
  await page.fill('#email', `yeni-uye-${Date.now()}@hanuja.test`)
  await page.fill('#password', 'Yeni1234!')
  await page.fill('#passwordConfirm', 'Yeni1234!')

  // Turnstile mock token'ı geldikten sonra form gönderime hazır olmalı.
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5000 })
  await expect(page.locator('button[type="submit"]')).toHaveText(/Üye Ol|Uye Ol/i)
})

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Giriş
// ═══════════════════════════════════════════════════════════════════
test('test müşterisi başarıyla giriş yapar ve hesabım sayfasına yönlenir', async ({ page }) => {
  await loginCustomer(page)
  await expect(page).toHaveURL(/hesabim/)
})

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Anasayfa → kategori → ürün
// ═══════════════════════════════════════════════════════════════════
test('anasayfa yüklenir; kategoriden ürün detayına gidilebilir', async ({ page }) => {
  const res = await page.goto(BASE_URL)
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })

  // Kategori listesine git
  await page.goto(`${BASE_URL}/kategori`)
  const catLink = page.locator('a[href*="/kategori/"]').first()
  await expect(catLink).toBeVisible({ timeout: 5000 })
  await catLink.click()
  await page.waitForLoadState('networkidle')

  // Ürün linki görünmeli
  const productLink = page.locator('a[href*="/urun/"]').first()
  await expect(productLink).toBeVisible({ timeout: 8000 })

  // Ürün detayına gir
  await productLink.click()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Sepet
// ═══════════════════════════════════════════════════════════════════
test('ürün sepete eklenir; sepet sayfası yüklenir', async ({ page }) => {
  await loginCustomer(page)
  await addFirstAvailableProductToCart(page)

  // Sepet sayfasını kontrol et
  await page.goto(`${BASE_URL}/sepet`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════
// TEST 6: EFT / Havale ile sipariş — ANA TEST
// ═══════════════════════════════════════════════════════════════════
test('havale/EFT ile sipariş tamamlanır; sözleşmeler kaydedilir; onay sayfası doğrulanır', async ({
  page,
}) => {
  // Giriş (mockTurnstile zaten içinde)
  await loginCustomer(page)

  // ── Ürün bul ve sepete ekle ─────────────────────────────────────
  await addFirstAvailableProductToCart(page)

  // ── Ödeme sayfasına git ──────────────────────────────────────────
  const hydration = trackHydrationErrors(page)
  await page.goto(`${BASE_URL}/odeme`)
  await page.waitForLoadState('networkidle')

  // ── Teslimat adresi seç ──────────────────────────────────────────
  const addressRadio = page.locator('input[name="address"]').first()
  await expect(addressRadio).toBeVisible({ timeout: 8000 })
  await hydration.expectNone()
  if (!(await addressRadio.isChecked())) {
    await addressRadio.check()
  }

  // ── Ödeme yöntemi: Havale/EFT ────────────────────────────────────
  const eftRadio = page.locator('input[name="payment"][value="eft"]')
  await expect(eftRadio).toBeVisible({ timeout: 5000 })
  await eftRadio.check()

  // ── Sözleşmelerin hazır olmasını bekle (checkbox'lar enabled olur) ─
  const checkboxes = page.locator('input[type="checkbox"]')
  await expect(checkboxes.first()).toBeEnabled({ timeout: 15000 })
  await expect(checkboxes).toHaveCount(2)

  // ── İki sözleşmeyi onayla ────────────────────────────────────────
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()

  // Sözleşmelerin işaretlendiğini doğrula
  await expect(checkboxes.nth(0)).toBeChecked()
  await expect(checkboxes.nth(1)).toBeChecked()

  // ── Turnstile mock token bekle (60ms'de geliyor) ─────────────────
  await page.waitForTimeout(200)

  // ── Sipariş onayla butonu aktif ve tıklanabilir ──────────────────
  const submitBtn = page.getByTestId('checkout-submit')
  await expect(submitBtn).toBeEnabled({ timeout: 5000 })
  await submitBtn.click()

  // ── Sipariş onay sayfasına yönlenme ─────────────────────────────
  await page.waitForURL(/\/siparis\//, { timeout: 20000 })
  const orderUrl = page.url()
  expect(orderUrl).toMatch(/\/siparis\/[a-z0-9]+/)

  // ── Sipariş onay sayfası doğrulamaları ───────────────────────────

  // 1. Sayfa yüklendi
  await page.waitForLoadState('networkidle')

  // 2. Sipariş numarası / başlık
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })

  // 3. Durum rozeti: havale bekleniyor
  await expect(
    page
      .locator(
        '[class*="badge"], [class*="status"], [class*="Badge"], [class*="Status"], span, div',
      )
      .filter({ hasText: /Havale|EFT|Bekleniyor|bank_transfer/i })
      .first(),
  ).toBeVisible({ timeout: 8000 })

  // 4. Mesafeli Satış ve Ön Bilgilendirme sözleşme butonları görünmeli
  const mesafeliBtn = page.locator('button').filter({ hasText: /Mesafeli/i })
  const onBilBtn = page.locator('button').filter({ hasText: /Bilgilendirme/i })
  await expect(mesafeliBtn.first()).toBeVisible({ timeout: 5000 })
  await expect(onBilBtn.first()).toBeVisible({ timeout: 5000 })

  // 5. Ürün kalemi görünmeli
  await expect(page.locator('img, [class*="product"], [class*="item"]').first()).toBeVisible({
    timeout: 5000,
  })
})

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Hesabım profil & adres sayfaları
// ═══════════════════════════════════════════════════════════════════
test('hesabım profil ve adres sayfaları yüklenir', async ({ page }) => {
  await loginCustomer(page)

  // Profil — sayfanın yüklenip içerik göstermesini bekle
  await expect(page).toHaveURL(/hesabim/)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1, h2, [class*="heading"], nav a').first()).toBeVisible({ timeout: 10000 })

  // Adres sayfası
  await page.goto(`${BASE_URL}/hesabim/adresler`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  // Test müşterisinin adresi gösterilmeli
  await expect(page.getByText(/Playwright Mahallesi/i)).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('05001234567')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Sipariş listesi
// ═══════════════════════════════════════════════════════════════════
test('sipariş listesinde en az bir sipariş ve detay linki görünür', async ({ page }) => {
  await loginCustomer(page)

  await page.goto(`${BASE_URL}/siparis`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })

  // Test 6'da sipariş verildi; en az bir sipariş linki olmalı
  const orderLinks = page.locator('a[href*="/siparis/"]')
  await expect(orderLinks.first()).toBeVisible({ timeout: 8000 })
})
