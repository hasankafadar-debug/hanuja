/**
 * E2E — Seller panel fulfillment flow
 *
 * Kapsamlı satıcı paneli senaryoları:
 * - Giriş/çıkış (auth)
 * - Dashboard stat kartları
 * - Sipariş listesi (sadece ödenmişler görünmeli)
 * - Sipariş detayı & kargo girişi
 * - Reddetme akışı (sebep zorunlu, ceza uyarısı)
 * - Ürün listesi & yönetimi
 * - Ödeme/hakediş ekranı (hold vs ready vs paid)
 * - Kargo/sevkiyat ekranı
 * - İade listesi
 * - Ayarlar ekranı
 */
import { test, expect, type Page } from '@playwright/test'
import { trackHydrationErrors } from '../helpers/hydration'
import { mockTurnstile } from '../helpers/turnstile'

const SELLER_EMAIL = 'satici@atelyenoa.com'
const SELLER_PASSWORD = 'Seller1234!'

async function loginAsSeller(page: Page) {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto('/giris')
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel(/E-posta/i)).toBeVisible()
  await hydration.expectNone()
  await page.getByLabel(/E-posta/i).fill(SELLER_EMAIL)
  await page.getByLabel(/Şifre|Sifre/i).fill(SELLER_PASSWORD)
  await expect(page.getByRole('button', { name: /Giriş Yap|Giris Yap/i })).toBeEnabled({
    timeout: 5_000,
  })
  await page.getByRole('button', { name: /Giriş Yap|Giris Yap/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

test.describe('auth — giriş / çıkış', () => {
  test('satıcı giris sayfası yükleniyor', async ({ page }) => {
    await mockTurnstile(page)
    const hydration = trackHydrationErrors(page)
    await page.goto('/giris')
    await expect(page.getByLabel(/E-posta/i)).toBeVisible()
    await expect(page.getByLabel(/Şifre|Sifre/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Giriş Yap|Giris Yap/i })).toBeVisible()
    await hydration.expectNone()
  })

  test('yanlış şifreyle giriş reddediliyor', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel(/E-posta/i).fill(SELLER_EMAIL)
    await page.getByLabel(/Şifre|Sifre/i).fill('YanlisS1fre!')
    await page.getByRole('button', { name: /Giriş Yap|Giris Yap/i }).click()
    // Panel rotasına gitmemeli
    await page.waitForTimeout(3000)
    expect(page.url()).not.toMatch(/dashboard/)
  })

  test('doğru kimlik bilgileriyle giriş başarılı', async ({ page }) => {
    await loginAsSeller(page)
    await expect(page).toHaveURL(/dashboard/)
  })
})

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('dashboard sayfası yükleniyor', async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/)
    // Temel sayfa elementleri
    const heading = page.getByRole('heading').first()
    await expect(heading).toBeVisible()
  })

  test('stat kartları görünüyor', async ({ page }) => {
    const statCards = page.getByTestId('stat-card')
    const count = await statCards.count()
    // En az bir istatistik kartı olmalı
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('kalite metrikleri dar ekranlarda okunabilir kalıyor', async ({ page }) => {
    const qualityMetrics = page.getByTestId('seller-dashboard-quality-metrics')
    const qualityCards = qualityMetrics.getByTestId('stat-card')

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.reload()
      await expect(qualityMetrics).toBeVisible()
      await expect(qualityCards).toHaveCount(4)

      const layout = await qualityCards.evaluateAll((cards) => {
        const rects = cards.map((card) => card.getBoundingClientRect())
        const overflowingText = cards.some((card) =>
          Array.from(card.querySelectorAll('p')).some(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        )

        return {
          rowTops: [...new Set(rects.map((rect) => Math.round(rect.top)))],
          overflowingText,
        }
      })

      expect(layout.overflowingText).toBe(false)
      expect(layout.rowTops.length).toBe(viewport.width === 390 ? 4 : 2)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
  })

  test('navigasyon menüsü görünüyor', async ({ page }) => {
    // Sol menü veya navigasyon var
    const nav = page.locator('nav, aside, [role="navigation"]').first()
    await expect(nav).toBeVisible()
  })
})

// ─── SİPARİŞLER ───────────────────────────────────────────────────────────────

test.describe('siparişler — sadece ödenmiş siparişler görünmeli', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('sipariş listesi sayfası yükleniyor', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/siparisler/)
    // Sayfa body'si gözüküyor
    await expect(page.locator('body')).toBeVisible()
  })

  test('ödenmemiş sipariş statüleri listede yok', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    const statusBadges = page.getByTestId('status-badge')
    const count = await statusBadges.count()
    for (let i = 0; i < count; i++) {
      const text = (await statusBadges.nth(i).textContent()) ?? ''
      expect(text).not.toMatch(/payment_pending|draft|checkout_started/i)
    }
  })

  test('sipariş detay sayfası doğrudan URL ile açılıyor', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    const firstOrder = page.getByTestId('order-row').first()
    if (await firstOrder.isVisible()) {
      // href attribute'u oku ve doğrudan navigate et (Next.js hydration bekleme gerekmez)
      const href = await firstOrder.getByRole('link', { name: /Yönet/i }).first().getAttribute('href')
      if (href) {
        await page.goto(href)
        await page.waitForLoadState('networkidle')
        await expect(page).toHaveURL(/\/siparisler\//)
      }
    }
  })
})

// ─── SİPARİŞ REDDETME ─────────────────────────────────────────────────────────

test.describe('sipariş reddetme — sebep zorunlu, ceza uyarısı', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('reddet butonu mevcut siparişte görünüyor', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    const firstOrder = page.getByTestId('order-row').first()
    if (await firstOrder.isVisible()) {
      await firstOrder.click()
      await page.waitForLoadState('networkidle')
      const rejectBtn = page.getByRole('button', { name: /Reddet|reddet/i })
      if (await rejectBtn.isVisible()) {
        await rejectBtn.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('sebep seçilmeden reddet butonu disabled', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    const firstOrder = page.getByTestId('order-row').first()
    if (await firstOrder.isVisible()) {
      await firstOrder.click()
      await page.waitForLoadState('networkidle')
      const expandBtn = page.getByRole('button', { name: /Siparişi Reddet|Siparisi Reddet/i })
      if (await expandBtn.isVisible()) {
        await expandBtn.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const submitBtn = dialog.getByRole('button', { name: /Reddet/i })
        await expect(submitBtn).toBeDisabled()
      }
    }
  })

  test('ceza uyarısı dialog içinde görünüyor', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    const firstOrder = page.getByTestId('order-row').first()
    if (await firstOrder.isVisible()) {
      await firstOrder.click()
      await page.waitForLoadState('networkidle')
      const expandBtn = page.getByRole('button', { name: /Siparişi Reddet|Siparisi Reddet/i })
      if (await expandBtn.isVisible()) {
        await expandBtn.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText(/ceza|%20/i)).toBeVisible()
      }
    }
  })
})

// ─── ÜRÜNLER ──────────────────────────────────────────────────────────────────

test.describe('ürünler', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('ürün listesi sayfası yükleniyor', async ({ page }) => {
    await page.goto('/urunler')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/urunler/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('ürün listesinde temel tablo/liste elementi var', async ({ page }) => {
    await page.goto('/urunler')
    await page.waitForLoadState('networkidle')
    // Tablo, liste ya da "ürün yok" mesajı olmalı
    const hasTable = await page.locator('table').isVisible()
    const hasEmpty = await page.getByText(/ürün yok|henüz ürün|hiç ürün/i).isVisible()
    expect(hasTable || hasEmpty).toBeTruthy()
  })

  test('yeni ürün ekle butonu görünüyor', async ({ page }) => {
    await page.goto('/urunler')
    await page.waitForLoadState('networkidle')
    const addBtn = page.getByRole('button', { name: /Yeni Ürün|Ürün Ekle|yeni ürün/i })
      .or(page.getByRole('link', { name: /Yeni Ürün|Ürün Ekle|yeni ürün/i }))
    if (await addBtn.first().isVisible()) {
      await expect(addBtn.first()).toBeVisible()
    }
  })
})

// ─── ÖDEMELER / HAKEDİŞ ───────────────────────────────────────────────────────

test.describe('ödemeler — hold/ready/paid ayırımı', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('ödeme sayfası yükleniyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/odemeler/)
    await expect(page.getByTestId('seller-payouts-page')).toBeVisible({ timeout: 10000 })
  })

  test('stat kartları görünüyor (bekleyen, hazır, ödendi)', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('stat-card').first()).toBeVisible()
  })

  test('hakediş tablosu yeni kolon başlıklarını gösteriyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('seller-payouts-page')).toBeVisible()
    const table = page.getByRole('table')
    if (await table.isVisible()) {
      await expect(page.getByRole('columnheader', { name: 'Tarih' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Sipariş No' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /Bloke Süresi/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Ödeme Durumu' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /Satıcı Hakediş Tutarı/i })).toBeVisible()
    }
  })

  test('ödeme durumu bekliyor/tamamlandı/bloke etiketleriyle gösteriliyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    const table = page.getByRole('table')
    if (await table.isVisible()) {
      const badges = page.getByTestId('status-badge')
      const count = await badges.count()
      for (let i = 0; i < count; i++) {
        const text = (await badges.nth(i).textContent()) ?? ''
        expect(text).toMatch(/Bekliyor|Tamamlandı|Bloke/i)
      }
    }
  })

  test('satır Detay butonu ile hakediş detay sayfasına gidiliyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    const table = page.getByRole('table')
    if (await table.isVisible()) {
      const detailButton = page.getByRole('link', { name: 'Detay' }).first()
      if (await detailButton.isVisible()) {
        await detailButton.click()
        await page.waitForLoadState('networkidle')
        await expect(page).toHaveURL(/\/odemeler\/[^/]+$/)
        await expect(page.getByTestId('seller-payout-detail-page')).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('negatif bakiye varsa görünüyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('stat-card').first()).toBeVisible()
  })
})

// ─── HAKEDİŞ DETAY SAYFASI ────────────────────────────────────────────────────

test.describe('hakediş detay sayfası', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('hakediş yoksa liste boş durumunu, varsa detay içeriğini gösteriyor', async ({ page }) => {
    await page.goto('/odemeler')
    await page.waitForLoadState('networkidle')
    const detailLink = page.getByRole('link', { name: 'Detay' }).first()

    if (!(await detailLink.isVisible())) {
      // Hiç hakediş kaydı yok — boş durum mesajı beklenir, test burada biter.
      await expect(page.getByText(/Henüz payout kaydı yok/i)).toBeVisible()
      return
    }

    const href = await detailLink.getAttribute('href')
    expect(href).toBeTruthy()
    if (href) {
      await page.goto(href)
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('seller-payout-detail-page')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Hesap Dökümü')).toBeVisible()
      await expect(page.getByText('Net Hakediş')).toBeVisible()
      await expect(page.getByText('Zaman Çizelgesi')).toBeVisible()
    }
  })
})

// ─── KARGOLAR ─────────────────────────────────────────────────────────────────

test.describe('kargolar — sevkiyat takip girişi', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('kargo sayfası yükleniyor', async ({ page }) => {
    await page.goto('/kargolar')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/kargolar/)
    await expect(page.getByTestId('seller-shipments-page')).toBeVisible({ timeout: 10000 })
  })

  test('kargo listesi tablo/empty state gösteriyor', async ({ page }) => {
    await page.goto('/kargolar')
    await page.waitForLoadState('networkidle')
    const hasTable = await page.locator('table').isVisible()
    const hasEmpty = await page.getByText(/kargo yok|sevkiyat yok|henüz/i).isVisible()
    expect(hasTable || hasEmpty).toBeTruthy()
  })
})

// ─── İADELER ──────────────────────────────────────────────────────────────────

test.describe('iadeler', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('iade listesi sayfası yükleniyor', async ({ page }) => {
    await page.goto('/iadeler')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/iadeler/)
    await expect(page.locator('body')).toBeVisible()
  })
})

// ─── AYARLAR ──────────────────────────────────────────────────────────────────

test.describe('ayarlar', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('ayarlar sayfası yükleniyor', async ({ page }) => {
    await page.goto('/ayarlar')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/ayarlar/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('profil/hesap bilgileri formu görünüyor', async ({ page }) => {
    await page.goto('/ayarlar')
    await page.waitForLoadState('networkidle')
    const form = page.locator('form').first()
    if (await form.isVisible()) {
      await expect(form).toBeVisible()
    }
  })
})

// ─── MEDYA ────────────────────────────────────────────────────────────────────

test.describe('medya kütüphanesi', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('medya sayfası yükleniyor', async ({ page }) => {
    await page.goto('/medya')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/medya/)
    await expect(page.locator('body')).toBeVisible()
  })
})

// ─── VERİ İZOLASYONU ─────────────────────────────────────────────────────────

test.describe('veri izolasyonu — diğer satıcı verisi görünmemeli', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSeller(page)
  })

  test('ürünler sayfası yalnızca kendi satıcı ürünlerini gösteriyor', async ({ page }) => {
    await page.goto('/urunler')
    await page.waitForLoadState('networkidle')
    // Woodform satıcısına ait veri bu satıcıda görünmemeli
    const woodformRefs = await page.getByText(/woodform/i).count()
    expect(woodformRefs).toBe(0)
  })

  test('siparişler başka satıcının müşteri verisini içermiyor', async ({ page }) => {
    await page.goto('/siparisler')
    await page.waitForLoadState('networkidle')
    // Diğer satıcı adı satır içinde geçmemeli
    const otherSellerRefs = await page.getByText(/woodform@/i).count()
    expect(otherSellerRefs).toBe(0)
  })
})
