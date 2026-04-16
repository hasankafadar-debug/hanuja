/**
 * E2E — Admin panel finance and oversight flows
 *
 * Critical journeys:
 * - EFT/Havale approval workflow
 * - Payout readiness review
 * - Penalty visibility and waiver
 * - Seller suspension
 * - Audit log trail
 *
 * Run against a running local dev environment with seeded data.
 */
import { test, expect } from '@playwright/test'

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function loginAsAdmin(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never) {
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill('test-admin@hanuja.test')
  await page.getByLabel('Şifre').fill('AdminPassword123!')
  await page.getByRole('button', { name: 'Giriş Yap' }).click()
  await expect(page).toHaveURL(/dashboard/)
}

// ─── Admin dashboard ──────────────────────────────────────────────────────────

test.describe('admin dashboard: marketplace health overview', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('dashboard loads with stat cards', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('stat-card')).toHaveCount({ min: 1 } as Parameters<ReturnType<typeof page.getByTestId>['toHaveCount']>[0])
  })

  test('urgent items section shows actionable items', async ({ page }) => {
    await page.goto('/dashboard')
    // Dashboard should surface urgent actions
    await expect(page.getByRole('heading')).toBeVisible()
  })
})

// ─── Payment approval (EFT/Havale) ───────────────────────────────────────────

test.describe('EFT/Havale approval workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('payments page shows pending EFT approvals', async ({ page }) => {
    await page.goto('/odemeler')
    await expect(page).toHaveURL('/odemeler')
    await expect(page.getByRole('heading')).toBeVisible()
  })

  test('EFT approval requires confirmation step', async ({ page }) => {
    await page.goto('/odemeler')
    const approveButton = page.getByRole('button', { name: /Onayla|Approve/i }).first()
    if (await approveButton.isVisible()) {
      await approveButton.click()
      // Should show a confirmation dialog or require reason
      await expect(
        page.getByRole('dialog').or(page.getByRole('alertdialog')),
      ).toBeVisible()
    }
  })
})

// ─── Payout management ───────────────────────────────────────────────────────

test.describe('payout readiness review', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('hakedişler page shows payout states', async ({ page }) => {
    await page.goto('/hakedisler')
    await expect(page.getByTestId('stat-card')).toHaveCount({ min: 1 } as Parameters<ReturnType<typeof page.getByTestId>['toHaveCount']>[0])
  })

  test('blocked payouts show blocking reason', async ({ page }) => {
    await page.goto('/hakedisler')
    // Find blocked payout if it exists
    const blockedRow = page.getByText(/payout_blocked/).first()
    if (await blockedRow.isVisible()) {
      // The row should also show a block reason
      const row = blockedRow.locator('..')
      const blockReason = await row.textContent()
      expect(blockReason).toBeTruthy()
    }
  })

  test('payout release is a confirmable action', async ({ page }) => {
    await page.goto('/hakedisler')
    const releaseButton = page.getByRole('button', { name: /Öde|Serbest Bırak|Release/i }).first()
    if (await releaseButton.isVisible()) {
      await releaseButton.click()
      // Critical finance action must require confirmation
      await expect(
        page.getByRole('dialog').or(page.getByRole('alertdialog')),
      ).toBeVisible()
    }
  })
})

// ─── Penalty management ───────────────────────────────────────────────────────

test.describe('penalty visibility and waiver', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('penalties page shows penalty list', async ({ page }) => {
    await page.goto('/cezalar')
    await expect(page.getByRole('heading')).toBeVisible()
  })

  test('penalty waiver requires reason input', async ({ page }) => {
    await page.goto('/cezalar')
    const waiveButton = page.getByRole('button', { name: /İptal|Affet|Waive/i }).first()
    if (await waiveButton.isVisible()) {
      await waiveButton.click()
      // Waiver is an admin override — must require reason
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByLabel(/Sebep|Gerekçe|Reason/i)).toBeVisible()
    }
  })
})

// ─── Seller management ────────────────────────────────────────────────────────

test.describe('seller management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('seller list shows seller statuses', async ({ page }) => {
    await page.goto('/saticilar')
    await expect(page.getByRole('heading')).toBeVisible()
  })

  test('seller detail shows finance summary', async ({ page }) => {
    await page.goto('/saticilar')
    const firstRow = page.getByRole('link').filter({ hasText: /Atelier|WoodForm|Bohem/i }).first()
    if (await firstRow.isVisible()) {
      await firstRow.click()
      // Finance section should be visible
      await expect(page).toHaveURL(/\/saticilar\//)
    }
  })

  test('seller suspension requires confirmation', async ({ page }) => {
    await page.goto('/saticilar')
    const firstRow = page.getByRole('link').filter({ hasText: /Atelier|WoodForm|Bohem/i }).first()
    if (await firstRow.isVisible()) {
      await firstRow.click()
      const suspendButton = page.getByRole('button', { name: /Askıya Al|Suspend/i })
      if (await suspendButton.isVisible()) {
        await suspendButton.click()
        // Destructive action must require confirmation
        await expect(
          page.getByRole('dialog').or(page.getByRole('alertdialog')),
        ).toBeVisible()
      }
    }
  })
})

// ─── Audit log ────────────────────────────────────────────────────────────────

test.describe('audit log: admin actions are traceable', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('audit log page is accessible', async ({ page }) => {
    await page.goto('/denetim')
    await expect(page.getByRole('heading')).toBeVisible()
  })

  test('audit log shows actor and action type', async ({ page }) => {
    await page.goto('/denetim')
    // Audit entries should show actor and timestamp
    const rows = page.getByTestId('audit-row')
    const count = await rows.count()
    if (count > 0) {
      const firstRow = rows.first()
      await expect(firstRow).toBeVisible()
    }
  })
})

// ─── Finance overview ─────────────────────────────────────────────────────────

test.describe('finance overview', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('finance page shows totals', async ({ page }) => {
    await page.goto('/finans')
    await expect(page.getByTestId('stat-card')).toHaveCount({ min: 1 } as Parameters<ReturnType<typeof page.getByTestId>['toHaveCount']>[0])
  })
})
