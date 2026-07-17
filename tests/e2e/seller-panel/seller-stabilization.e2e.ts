import { test, expect, type Page } from '@playwright/test'
import { trackHydrationErrors } from '../helpers/hydration'
import { mockTurnstile } from '../helpers/turnstile'

const SELLER_EMAIL = 'satici@atelyenoa.com'
const SELLER_PASSWORD = 'Seller1234!'

async function loginAsSeller(page: Page) {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto('/giris')
  await expect(page.getByLabel(/E-posta/i)).toBeVisible()
  await hydration.expectNone()
  await page.getByLabel(/E-posta/i).fill(SELLER_EMAIL)
  await page.getByLabel(/Sifre|Şifre/i).fill(SELLER_PASSWORD)
  await expect(page.getByRole('button', { name: /Giris Yap|Giriş Yap/i })).toBeEnabled({
    timeout: 5_000,
  })
  await page.getByRole('button', { name: /Giris Yap|Giriş Yap/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
}

test.describe('seller application entry', () => {
  test('anonymous applicant reaches account creation without a login redirect loop', async ({
    page,
  }) => {
    await mockTurnstile(page)
    await page.context().clearCookies()

    await page.goto('/basvuru')

    await expect(page).toHaveURL(/\/basvuru(?:\?|$)/)
    await expect(
      page.getByRole('heading', { name: /Mağaza başvurusunu başlatın/i }),
    ).toBeVisible()
    await expect(page.getByLabel(/Ad Soyad/i)).toBeVisible()
    await expect(page.getByLabel(/^E-posta$/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Giriş yapın/i })).toHaveAttribute(
      'href',
      '/giris?callbackUrl=/basvuru',
    )
  })
})

test.describe('seller panel stabilization', () => {
  test('kargolar renders real content without blocking cold-load spinner', async ({ page }) => {
    await loginAsSeller(page)
    await page.goto('/kargolar')

    await expect(page.getByTestId('seller-shipments-page')).toBeVisible({ timeout: 10_000 })

    const shipmentsTable = page.locator('table')
    const emptyState = page.getByText(/Henuz kargo kaydi yok|Henüz kargo kaydı yok/i)

    await expect
      .poll(
        async () => {
          if (await shipmentsTable.isVisible().catch(() => false)) return 'table'
          if (await emptyState.isVisible().catch(() => false)) return 'empty'
          return 'pending'
        },
        { timeout: 10_000 },
      )
      .not.toBe('pending')

    await expect(page.getByRole('status', { name: /Yukleniyor|Yükleniyor/i })).toHaveCount(0)
  })

  test('urun duzenle navigation stays healthy and avoids legacy image optimizer requests', async ({
    page,
  }) => {
    const directLegacyOptimizerRequests: string[] = []
    const directLegacyOptimizerFailures: string[] = []
    const managedProxyRequests: string[] = []

    function decodeOptimizedSource(requestUrl: string) {
      const parsed = new URL(requestUrl)
      if (!parsed.pathname.includes('/_next/image')) return null

      const encodedSource = parsed.searchParams.get('url')
      return encodedSource ? decodeURIComponent(encodedSource) : null
    }

    page.on('request', (request) => {
      const url = request.url()
      const optimizedSource = decodeOptimizedSource(url)
      if (!optimizedSource) return

      if (
        optimizedSource.startsWith('https://cdn.hanuja.com.tr/') ||
        optimizedSource.startsWith('https://cdn.hanuja.com/')
      ) {
        directLegacyOptimizerRequests.push(url)
      }
    })

    page.on('request', (request) => {
      const url = request.url()
      if (
        url.includes('/api/media/fetch?src=') &&
        (url.includes('cdn.hanuja.com.tr') || url.includes('cdn.hanuja.com'))
      ) {
        managedProxyRequests.push(url)
      }
    })

    page.on('requestfailed', (request) => {
      const url = request.url()
      const optimizedSource = decodeOptimizedSource(url)
      if (
        optimizedSource &&
        (optimizedSource.startsWith('https://cdn.hanuja.com.tr/') ||
          optimizedSource.startsWith('https://cdn.hanuja.com/'))
      ) {
        directLegacyOptimizerFailures.push(
          `${request.failure()?.errorText ?? 'requestfailed'} ${url}`,
        )
      }
    })

    await loginAsSeller(page)
    await page.goto('/urunler')

    const editLink = page.getByRole('link', { name: /Duzenle|Düzenle/i }).first()
    await expect(editLink).toBeVisible({ timeout: 15_000 })
    await editLink.click()

    await expect(page).toHaveURL(/\/urunler\/[^/]+$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Urun Duzenle|Ürün Düzenle/i })).toBeVisible()
    await expect(page.getByLabel(/Urun Adi|Ürün Adı/i)).toBeVisible()
    await expect(page.getByLabel(/Kategori/i)).toBeVisible()

    expect(directLegacyOptimizerRequests).toEqual([])
    expect(directLegacyOptimizerFailures).toEqual([])
    expect(managedProxyRequests.length).toBeGreaterThan(0)
    await expect(page.locator('img[src*="/api/media/fetch"]').first()).toBeVisible()
  })
})
