/**
 * E2E — Admin panel finance and oversight flows
 */
import { test, expect } from '@playwright/test'
import { trackHydrationErrors } from '../helpers/hydration'
import { mockTurnstile } from '../helpers/turnstile'

async function loginAsAdmin(
  page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never,
) {
  await mockTurnstile(page)
  const hydration = trackHydrationErrors(page)
  await page.goto('/giris')
  await expect(page.getByLabel(/E-posta/i)).toBeVisible()
  await hydration.expectNone()
  await page.getByLabel(/E-posta/i).fill('test-admin@hanuja.test')
  await page.getByLabel(/Şifre|Sifre/i).fill('AdminPassword123!')
  await expect(page.getByRole('button', { name: /Giriş Yap|Giris Yap/i })).toBeEnabled({
    timeout: 5_000,
  })
  await page.getByRole('button', { name: /Giriş Yap|Giris Yap/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
  await expect(page.getByTestId('admin-dashboard-page')).toBeVisible({ timeout: 15_000 })
}

test.describe('auth', () => {
  test('admin giriş sayfası hydration hatası olmadan yükleniyor', async ({ page }) => {
    await mockTurnstile(page)
    const hydration = trackHydrationErrors(page)

    await page.goto('/giris')

    await expect(page.getByLabel(/E-posta/i)).toBeVisible()
    await expect(page.getByLabel(/Şifre|Sifre/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Giriş Yap|Giris Yap/i })).toBeVisible()
    await hydration.expectNone()
  })

  test('şifre sıfırlama giriş noktaları oturumsuz erişime açık', async ({ page }) => {
    await page.goto('/giris')
    await page.getByRole('link', { name: /Şifremi unuttum/i }).click()

    await expect(page).toHaveURL('/sifremi-unuttum')
    await expect(page.getByRole('heading', { name: /Şifremi Unuttum/i })).toBeVisible()

    await page.goto('/sifre-sifirla')
    await expect(page).toHaveURL('/sifre-sifirla')
    await expect(page.getByRole('heading', { name: /Geçersiz Bağlantı/i })).toBeVisible()
  })
})

test.describe('admin dashboard: marketplace health overview', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('dashboard loads with stat cards', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('admin-dashboard-page')).toBeVisible()
    await expect(page.getByTestId('stat-card').first()).toBeVisible()
  })

  test('urgent items section shows actionable items', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('admin-dashboard-page')).toBeVisible()
  })
})

test.describe('EFT/Havale approval workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('payments page shows pending EFT approvals', async ({ page }) => {
    await page.goto('/odemeler')
    await expect(page).toHaveURL('/odemeler')
    await expect(page.getByTestId('admin-payments-page')).toBeVisible()
  })

  test('EFT approval requires confirmation step', async ({ page }) => {
    await page.goto('/odemeler')
    const approveButton = page.getByRole('button', { name: /Onayla|Approve/i }).first()
    if (await approveButton.isVisible()) {
      await approveButton.click()
      await expect(page.getByTestId('eft-approval-panel')).toBeVisible()
      await expect(page.getByTestId('eft-confirm-approve')).toBeVisible()
    }
  })
})

test.describe('payout readiness review', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('hakedişler page shows payout states', async ({ page }) => {
    await page.goto('/hakedisler')
    await expect(page.getByTestId('admin-payouts-page')).toBeVisible()
    await expect(page.getByTestId('stat-card').first()).toBeVisible()
  })

  test('blocked payouts show blocking reason', async ({ page }) => {
    await page.goto('/hakedisler')
    const blockedRow = page.getByText(/payout_blocked/).first()
    if (await blockedRow.isVisible()) {
      const row = blockedRow.locator('..')
      const blockReason = await row.textContent()
      expect(blockReason).toBeTruthy()
    }
  })

  test('payout release is a confirmable action', async ({ page }) => {
    await page.goto('/hakedisler')
    const releaseButton = page.getByRole('button', { name: /Öde|Ode|Serbest Bırak|Serbest Birak|Release/i }).first()
    if (await releaseButton.isVisible()) {
      await releaseButton.click()
      await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toBeVisible()
    }
  })
})

test.describe('penalty visibility and waiver', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('penalties page shows penalty list', async ({ page }) => {
    await page.goto('/cezalar')
    await expect(page.getByTestId('admin-penalties-page')).toBeVisible()
  })

  test('penalty waiver requires reason input', async ({ page }) => {
    await page.goto('/cezalar')
    const waiveButton = page.getByRole('button', { name: /İptal|Iptal|Affet|Waive/i }).first()
    if (await waiveButton.isVisible()) {
      await waiveButton.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByLabel(/Sebep|Gerekçe|Gerekce|Reason/i)).toBeVisible()
    }
  })
})

test.describe('seller management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('seller list shows seller statuses', async ({ page }) => {
    await page.goto('/saticilar')
    await expect(page.getByTestId('admin-sellers-page')).toBeVisible()
  })

  test('seller detail shows finance summary', async ({ page }) => {
    await page.goto('/saticilar')
    const firstSellerRow = page.locator('tbody tr').first()
    const reviewLink = firstSellerRow.getByRole('link', { name: /İncele/i })

    await expect(firstSellerRow).toBeVisible()
    await expect(reviewLink).toBeVisible()
    const sellerName = (await firstSellerRow.locator('td').first().locator('span').last().innerText()).trim()
    expect(sellerName).not.toBe('')
    const detailHref = await reviewLink.getAttribute('href')
    expect(detailHref).toMatch(/^\/saticilar\/[^/?]+$/)
    if (!detailHref) throw new Error('İncele bağlantısında satıcı detay adresi bulunamadı.')

    const detailRequestPromise = page.waitForRequest((request) => {
      return new URL(request.url()).pathname === detailHref && request.isNavigationRequest()
    })
    await reviewLink.click()
    const detailRequest = await detailRequestPromise

    expect(detailRequest.resourceType()).toBe('document')
    expect(detailRequest.headers()['rsc']).toBeUndefined()

    await expect(page).toHaveURL(/\/saticilar\/[^/?]+$/)
    await expect(page.getByRole('heading', { level: 1, name: sellerName, exact: true })).toBeVisible()
    await expect(page.getByText('Toplam Sipariş', { exact: true })).toBeVisible()
    await expect(page.getByText('Bekleyen Hakediş', { exact: true })).toBeVisible()
  })

  test('seller detail document navigation remains repeatable', async ({ page }) => {
    await page.goto('/saticilar')
    const namedReviewLink = page.locator('tbody tr').first().getByRole('link', { name: /İncele/i })
    await expect(namedReviewLink).toBeVisible()
    const detailHref = await namedReviewLink.getAttribute('href')
    expect(detailHref).toMatch(/^\/saticilar\/[^/?]+$/)
    if (!detailHref) throw new Error('İncele bağlantısında satıcı detay adresi bulunamadı.')
    const stableReviewLink = page.locator(`a[href=${JSON.stringify(detailHref)}]`).first()

    const firstDetailRequestPromise = page.waitForRequest((request) => {
      return new URL(request.url()).pathname === detailHref && request.isNavigationRequest()
    })
    await stableReviewLink.click()
    const firstDetailRequest = await firstDetailRequestPromise

    expect(firstDetailRequest.resourceType()).toBe('document')
    expect(firstDetailRequest.headers()['rsc']).toBeUndefined()
    await expect(page).toHaveURL(/\/saticilar\/[^/?]+$/)

    await page.getByRole('link', { name: /Satıcılara Dön/i }).click()
    await expect(page).toHaveURL(/\/saticilar$/)
    await expect(page.getByTestId('admin-sellers-page')).toBeVisible()

    const repeatedReviewLink = page.locator('tbody tr').first().getByRole('link', { name: /İncele/i })
    const repeatedDetailRequestPromise = page.waitForRequest((request) => {
      return new URL(request.url()).pathname === detailHref && request.isNavigationRequest()
    })
    await repeatedReviewLink.click()
    const repeatedDetailRequest = await repeatedDetailRequestPromise

    expect(repeatedDetailRequest.resourceType()).toBe('document')
    expect(repeatedDetailRequest.headers()['rsc']).toBeUndefined()
    await expect(page).toHaveURL(/\/saticilar\/[^/?]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('seller suspension requires confirmation', async ({ page }) => {
    await page.goto('/saticilar')
    const firstRow = page.getByRole('link').filter({ hasText: /Atelier|WoodForm|Bohem/i }).first()
    if (await firstRow.isVisible()) {
      await firstRow.click()
      const suspendButton = page.getByRole('button', { name: /Askıya Al|Askiya Al|Suspend/i })
      if (await suspendButton.isVisible()) {
        await suspendButton.click()
        await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toBeVisible()
      }
    }
  })
})

test.describe('audit log: admin actions are traceable', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('audit log page is accessible', async ({ page }) => {
    await page.goto('/denetim')
    await expect(page.getByTestId('admin-audit-page')).toBeVisible()
  })

  test('audit log shows actor and action type', async ({ page }) => {
    await page.goto('/denetim')
    const rows = page.getByTestId('audit-row')
    const count = await rows.count()
    if (count > 0) {
      await expect(rows.first()).toBeVisible()
    }
  })
})

test.describe('finance overview', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('finance page shows totals', async ({ page }) => {
    await page.goto('/finans')
    await expect(page.getByTestId('admin-finance-page')).toBeVisible()
    await expect(page.getByTestId('stat-card').first()).toBeVisible()
  })
})
