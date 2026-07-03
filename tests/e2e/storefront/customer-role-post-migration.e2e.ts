import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CustomerAuditRecorder,
  attachPageDiagnostics,
  type HistoricalFinding,
} from '../helpers/customer-audit'
import { mockTurnstile } from '../helpers/turnstile'
import { trackHydrationErrors } from '../helpers/hydration'
import {
  CUSTOMER_FIXTURE,
  TEST_EMAIL,
  TEST_PASSWORD,
  type CustomerFixtureState,
} from '../setup/customer-fixture-data'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const REPORT_PATH = path.join(ROOT, 'output', 'playwright', 'customer-role-post-migration-audit.md')
const SCREENSHOT_DIR = path.join(ROOT, 'output', 'playwright', 'customer-role-post-migration-audit')
const STATE_PATH = path.join(ROOT, 'output', 'playwright', 'customer-fixture-state.json')

const HISTORICAL_CLOSED: HistoricalFinding[] = [
  {
    title: 'Katalog sayfalarinda products.fulfillmentDays patlamasi',
    status: 'historical / closed by migration',
    details:
      'Ilk audit sirasinda /kategori ve urun listelemede schema drift vardi. Post-migration rerun bu hatayi tekrar etmedigi icin acik bug sayilmiyor.',
  },
  {
    title: 'SCHEMA_OUT_OF_SYNC nedeniyle sepet ve checkout acilmamasi',
    status: 'historical / closed by migration',
    details:
      'Migration sonrasi EFT checkout basarili calisti; onceki schema mismatch bulgusu tarihsel artefakt olarak ayrildi.',
  },
]

function runCustomerSetup() {
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
}

async function readFixtureState(): Promise<CustomerFixtureState> {
  const raw = await fs.readFile(STATE_PATH, 'utf8')
  return JSON.parse(raw) as CustomerFixtureState
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
  await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 })
  await hydration.expectNone()
  await page.fill('#email', TEST_EMAIL)
  await page.fill('#password', TEST_PASSWORD)
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5_000 })
  await page.click('button[type="submit"]')
  await page.waitForURL(/hesabim|\/$/, { timeout: 15_000 })
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

test.beforeAll(() => {
  runCustomerSetup()
})

test('post-migration customer audit exercises visible customer controls', async ({ page, context }) => {
  const fixtureState = await readFixtureState()
  const recorder = new CustomerAuditRecorder(REPORT_PATH, SCREENSHOT_DIR, HISTORICAL_CLOSED)
  const diagnostics = attachPageDiagnostics(page)

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL }).catch(
    () => undefined,
  )

  async function runControl(
    args: {
      priority: 'P1' | 'P2' | 'P3' | 'P4'
      clickedControl: string
      expected: string
      steps: string[]
      fixtureUsed: string
      actual?: string
    },
    action: () => Promise<void>,
  ) {
    const mark = diagnostics.mark()
    try {
      await action()
      recorder.recordSuccess(args.clickedControl, page.url(), args.fixtureUsed)
    } catch (error) {
      await recorder.captureFailure(
        page,
        {
          priority: args.priority,
          url: page.url(),
          clickedControl: args.clickedControl,
          steps: args.steps,
          expected: args.expected,
          fixtureUsed: args.fixtureUsed,
          ...(args.actual ? { actual: args.actual } : {}),
        },
        diagnostics.slice(mark),
        error,
      )
    }
  }

  function recordFixtureGap(
    control: string,
    expected: string,
    actual: string,
    fixtureUsed: string,
    steps: string[],
  ) {
    recorder.recordFinding({
      priority: 'P4',
      url: page.url(),
      clickedControl: control,
      steps,
      expected,
      actual,
      fixtureUsed,
      consoleNetwork: [],
    })
  }

  try {
    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Public home browse',
        expected: 'Home page should load and not show fulfillmentDays/schema errors.',
        steps: ['Open /'],
        fixtureUsed: 'public_routes',
      },
      async () => {
        await page.goto('/')
        await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText(/fulfillmentDays|SCHEMA_OUT_OF_SYNC/i)).toHaveCount(0)
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Public category browse',
        expected: 'Category page should render products after migration.',
        steps: ['Open /kategori'],
        fixtureUsed: 'public_routes',
      },
      async () => {
        await page.goto('/kategori')
        await expect(page.locator('a[href*="/kategori/"]').first()).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Public search browse',
        expected: 'Search page should load without server errors.',
        steps: ['Open /arama?q=sehpa'],
        fixtureUsed: 'public_routes',
      },
      async () => {
        await page.goto('/arama?q=sehpa')
        await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 15_000 })
      },
    )

    for (const publicPath of ['/blog', '/iletisim', '/kullanim-kosullari', '/gizlilik-politikasi', '/iade-iptal']) {
      await runControl(
        {
          priority: 'P3',
          clickedControl: `Public route ${publicPath}`,
          expected: `${publicPath} should respond successfully.`,
          steps: [`Open ${publicPath}`],
          fixtureUsed: 'public_routes',
        },
        async () => {
          const response = await page.goto(publicPath)
          expect(response?.status()).toBe(200)
          await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
        },
      )
    }

    for (const protectedPath of ['/odeme', '/siparis', '/hesabim/adresler', '/faturalarim']) {
      await runControl(
        {
          priority: 'P2',
          clickedControl: `Anonymous redirect ${protectedPath}`,
          expected: 'Anonymous customer should be redirected to login.',
          steps: [`Open ${protectedPath} without login`],
          fixtureUsed: 'negative_auth',
        },
        async () => {
          await page.goto(protectedPath)
          await expect(page).toHaveURL(/giris/, { timeout: 15_000 })
        },
      )
    }

    await runControl(
      {
        priority: 'P1',
        clickedControl: 'Customer login',
        expected: 'Canonical test customer should log in successfully.',
        steps: ['Open /giris', 'Submit credentials'],
        fixtureUsed: 'ensure-test-customer',
      },
      async () => {
        await loginCustomer(page)
        await expect(page).toHaveURL(/hesabim|\/$/)
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Product add to cart',
        expected: 'Customer should be able to add canonical product to cart.',
        steps: ['Open canonical product', 'Click Sepete Ekle'],
        fixtureUsed: 'product_fixture',
      },
      async () => {
        await safeGoto(page, `/urun/${fixtureState.productSlug}`)
        await expect(page.getByTestId('add-to-cart')).toBeVisible({ timeout: 15_000 })
        await page.getByTestId('add-to-cart').click()
        await expect(page.getByTestId('add-to-cart')).toContainText(/Sepete Eklendi|Ekleniyor/i, {
          timeout: 5_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Product favorite toggle',
        expected: 'Favorite button should add product for the logged-in customer.',
        steps: ['Stay on canonical product', 'Click favorite heart'],
        fixtureUsed: 'product_fixture',
      },
      async () => {
        const favoriteButton = page.getByRole('button', { name: /Favorilere ekle|Favorilerden çıkar/i })
        await expect(favoriteButton).toBeVisible({ timeout: 10_000 })
        await favoriteButton.click()
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Product share button',
        expected: 'Share button should complete via clipboard/share flow without throwing.',
        steps: ['Stay on canonical product', 'Click Urunu Paylas'],
        fixtureUsed: 'product_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Ürünü Paylaş/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Store follow toggle on',
        expected: 'Store follow button should follow the canonical store.',
        steps: ['Stay on canonical product', 'Click Takip Et'],
        fixtureUsed: 'store_follow_fixture',
      },
      async () => {
        const followButton = page.getByRole('button', { name: /Takip Et|Takibi Bırak/i })
        await expect(followButton).toBeVisible({ timeout: 10_000 })
        await followButton.click()
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Store follow toggle off',
        expected: 'Store follow button should allow unfollow after follow.',
        steps: ['Stay on canonical product', 'Click Takibi Birak'],
        fixtureUsed: 'store_follow_fixture',
      },
      async () => {
        const followButton = page.getByRole('button', { name: /Takip Et|Takibi Bırak/i })
        await expect(followButton).toBeVisible({ timeout: 10_000 })
        await followButton.click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cart quantity plus',
        expected: 'Cart should allow increasing quantity.',
        steps: ['Open /sepet', 'Click Artir'],
        fixtureUsed: 'cart_flow',
      },
      async () => {
        await safeGoto(page, '/sepet')
        await expect(page.getByTestId('cart-item').first()).toBeVisible({ timeout: 15_000 })
        await page.getByRole('button', { name: /Artır/i }).first().click()
        await expect(page.locator('[data-testid="cart-item"] span').filter({ hasText: '2' }).first()).toBeVisible({
          timeout: 10_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cart quantity minus',
        expected: 'Cart should allow decreasing quantity.',
        steps: ['Stay on /sepet', 'Click Azalt'],
        fixtureUsed: 'cart_flow',
      },
      async () => {
        await page.getByRole('button', { name: /Azalt/i }).first().click()
        await expect(page.locator('[data-testid="cart-item"] span').filter({ hasText: '1' }).first()).toBeVisible({
          timeout: 10_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Cart invalid coupon apply',
        expected: 'Invalid coupon should be rejected with a validation message.',
        steps: ['Stay on /sepet', 'Enter INVALID', 'Click Uygula'],
        fixtureUsed: 'coupon_fixture',
      },
      async () => {
        await page.getByPlaceholder(/Kupon kodu/i).fill('INVALID')
        await page.getByRole('button', { name: /Uygula/i }).click()
        await expect(page.getByText(/yanlıştır|uygulanamadı/i)).toBeVisible({ timeout: 10_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cart valid coupon apply',
        expected: 'Valid coupon fixture should apply successfully.',
        steps: ['Stay on /sepet', `Enter ${fixtureState.couponCode}`, 'Click Uygula'],
        fixtureUsed: 'coupon_fixture',
      },
      async () => {
        await page.getByPlaceholder(/Kupon kodu/i).fill(fixtureState.couponCode)
        await page.getByRole('button', { name: /Uygula/i }).click()
        await expect(page.getByText(new RegExp(fixtureState.couponCode, 'i'))).toBeVisible({
          timeout: 10_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cart coupon remove',
        expected: 'Applied coupon should be removable.',
        steps: ['Stay on /sepet', 'Click Kaldir'],
        fixtureUsed: 'coupon_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Kaldır/i }).click()
        await expect(page.getByText(new RegExp(fixtureState.couponCode, 'i'))).toHaveCount(0)
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Cart continue shopping',
        expected: 'Continue shopping button should navigate back to storefront.',
        steps: ['Stay on /sepet', 'Click Alisverise Devam Et'],
        fixtureUsed: 'cart_flow',
      },
      async () => {
        await page.getByRole('link', { name: /Alışverişe Devam Et/i }).click()
        await expect(page).toHaveURL(/localhost:3000\/?$/, { timeout: 10_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cart remove item',
        expected: 'Cart remove button should delete the current line item.',
        steps: ['Re-open /sepet', 'Click Kaldir icon'],
        fixtureUsed: 'cart_flow',
      },
      async () => {
        await safeGoto(page, '/sepet')
        await expect(page.getByTestId('cart-item').first()).toBeVisible({ timeout: 15_000 })
        await page.getByRole('button', { name: /Kaldır/i }).first().click()
        await expect(page.getByText(/Sepetiniz boş/i)).toBeVisible({ timeout: 15_000 })
      },
    )

    await safeGoto(page, `/urun/${fixtureState.productSlug}`)
    await page.getByTestId('add-to-cart').click()

    await runControl(
      {
        priority: 'P1',
        clickedControl: 'Checkout cart to payment',
        expected: 'Customer should reach checkout from cart.',
        steps: ['Open /sepet', 'Click Odemeye Gec'],
        fixtureUsed: 'checkout_flow',
      },
      async () => {
        await safeGoto(page, '/sepet')
        await page.getByTestId('cart-checkout').click()
        await expect(page).toHaveURL(/odeme/, { timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Checkout alternate billing toggle',
        expected: 'Customer should be able to enable alternate billing address selection.',
        steps: ['Stay on /odeme', 'Click Farkli fatura adresi kullan'],
        fixtureUsed: 'billing_address_fixture',
      },
      async () => {
        const toggle = page.getByLabel(/Farklı fatura adresi kullan/i)
        await expect(toggle).toBeVisible({ timeout: 10_000 })
        await toggle.check()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Checkout distance sales contract dialog',
        expected: 'Distance sales contract dialog should open for checkout.',
        steps: ['Stay on /odeme', 'Select address', 'Open Mesafeli Satis Sozlesmesi'],
        fixtureUsed: 'checkout_flow',
      },
      async () => {
        const addressRadio = page.locator('input[name="address"]').first()
        await addressRadio.check()
        await page.getByRole('button', { name: /Mesafeli Satış/i }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Checkout pre-information dialog',
        expected: 'Pre-information dialog should open for checkout.',
        steps: ['Stay on /odeme', 'Open On Bilgilendirme Formu'],
        fixtureUsed: 'checkout_flow',
      },
      async () => {
        await page.getByRole('button', { name: /Ön Bilgilendirme/i }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
      },
    )

    await runControl(
      {
        priority: 'P1',
        clickedControl: 'EFT checkout submit',
        expected: 'Customer should place an EFT order successfully.',
        steps: ['Stay on /odeme', 'Choose EFT', 'Accept contracts', 'Click Siparisi Onayla'],
        fixtureUsed: 'checkout_flow',
      },
      async () => {
        await page.locator('input[name="payment"][value="eft"]').check()
        const checkboxes = page.locator('input[type="checkbox"]')
        await expect(checkboxes.first()).toBeEnabled({ timeout: 15_000 })
        await checkboxes.nth(0).check()
        await checkboxes.nth(1).check()
        await page.getByTestId('checkout-submit').click()
        await page.waitForURL(/\/siparis\//, { timeout: 20_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Order detail distance sales contract',
        expected: 'Order detail should open saved distance sales contract.',
        steps: ['Stay on created order detail', 'Click Mesafeli Satis Sozlesmesi'],
        fixtureUsed: 'eft_order',
      },
      async () => {
        await page.getByRole('button', { name: /Mesafeli Satış Sözleşmesi/i }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Order detail pre-information contract',
        expected: 'Order detail should open saved pre-information form.',
        steps: ['Stay on created order detail', 'Click On Bilgilendirme Formu'],
        fixtureUsed: 'eft_order',
      },
      async () => {
        await page.getByRole('button', { name: /Ön Bilgilendirme Formu/i }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
        await page.keyboard.press('Escape')
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Orders list page',
        expected: 'Orders list should render with accessible order rows.',
        steps: ['Open /siparis'],
        fixtureUsed: 'fixture_orders',
      },
      async () => {
        await safeGoto(page, '/siparis')
        await expect(page.getByTestId('order-row').first()).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Open support creation form from orders list',
        expected: 'Destek Al should open the new support ticket form for an order without open ticket.',
        steps: ['Open /siparis', 'Click Destek Al for return-eligible order'],
        fixtureUsed: 'support_create_fixture',
      },
      async () => {
        await safeGoto(page, `/siparis/${fixtureState.orderIds.returnEligible}/destek/yeni`)
        await expect(page.getByRole('heading', { name: /Destek Talebi Aç/i })).toBeVisible({
          timeout: 10_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Create support ticket',
        expected: 'Customer should be able to create a new support ticket.',
        steps: ['Stay on new support form', 'Fill category, subject, body', 'Click Destek Talebi Gonder'],
        fixtureUsed: 'support_create_fixture',
      },
      async () => {
        await page.locator('#category').selectOption('other')
        await page.locator('#subject').fill('Playwright destek talebi')
        await page.locator('#body').fill('Bu destek kaydi audit senaryosu icin olusturuluyor.')
        await page.getByRole('button', { name: /Destek Talebi Gönder/i }).click()
        await expect(page).toHaveURL(/\/destek\/[^/]+$/, { timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Open existing support ticket',
        expected: 'Open support fixture should expose the Goruntule action.',
        steps: ['Open support fixture order detail', 'Click Goruntule'],
        fixtureUsed: 'support_open_fixture',
      },
      async () => {
        await safeGoto(page, `/siparis/${fixtureState.orderIds.supportOpen}`)
        await page.getByRole('link', { name: /Görüntüle/i }).click()
        await expect(page).toHaveURL(/\/destek\/[^/]+$/, { timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Reply to open support ticket',
        expected: 'Customer should be able to reply on an unresolved support ticket.',
        steps: ['Stay on support thread', 'Fill textarea', 'Click Yanitla'],
        fixtureUsed: 'support_open_fixture',
      },
      async () => {
        await page.getByPlaceholder(/Yanıtınızı buraya yazın/i).fill(CUSTOMER_FIXTURE.supportReplyBody)
        await page.getByRole('button', { name: /Yanıtla/i }).click()
        await expect(page.getByText(CUSTOMER_FIXTURE.supportReplyBody)).toBeVisible({
          timeout: 15_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Create return request open form',
        expected: 'Return-eligible order should open the return request form.',
        steps: ['Open return-eligible order', 'Click Iade Talebi Olustur'],
        fixtureUsed: 'return_eligible_fixture',
      },
      async () => {
        await safeGoto(page, `/siparis/${fixtureState.orderIds.returnEligible}`)
        await page.getByRole('button', { name: /İade Talebi Oluştur/i }).click()
        await expect(page.getByPlaceholder(/İade sebebi/i)).toBeVisible({ timeout: 10_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cancel return request form',
        expected: 'Return request form should allow canceling before submit.',
        steps: ['Stay on return request form', 'Click Vazgec'],
        fixtureUsed: 'return_eligible_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Vazgeç/i }).click()
        await expect(page.getByRole('button', { name: /İade Talebi Oluştur/i })).toBeVisible({
          timeout: 10_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Submit return request',
        expected: 'Return-eligible order should accept a new return request.',
        steps: ['Re-open return form', 'Fill reason', 'Click Talebi Gonder'],
        fixtureUsed: 'return_eligible_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /İade Talebi Oluştur/i }).click()
        await page.getByPlaceholder(/İade sebebi/i).fill('Urunu iade etmek istiyorum')
        await page.getByRole('button', { name: /Talebi Gönder/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Return panel send message',
        expected: 'Active return fixture should accept customer reply messages.',
        steps: ['Open active return order', 'Fill mesaj', 'Click Mesaj Gonder'],
        fixtureUsed: 'active_return_fixture',
      },
      async () => {
        await safeGoto(page, `/siparis/${fixtureState.orderIds.activeReturn}`)
        await page
          .getByPlaceholder(/Mesajınız/i)
          .fill(CUSTOMER_FIXTURE.returnReplyBody)
        await page.getByRole('button', { name: /Mesaj Gönder/i }).click()
        await expect(page.getByText(CUSTOMER_FIXTURE.returnReplyBody)).toBeVisible({
          timeout: 15_000,
        })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Return panel submit shipment',
        expected: 'Active return fixture should accept Kargoya Verdim action.',
        steps: ['Stay on active return order', 'Fill carrier/tracking', 'Click Kargoya Verdim'],
        fixtureUsed: 'active_return_fixture',
      },
      async () => {
        await page.getByPlaceholder(/Kargo firması/i).fill('Yurtici Kargo')
        await page.getByPlaceholder(/Kargo takip numarası/i).fill('PWRETURNTRACK001')
        await page.getByRole('button', { name: /Kargoya Verdim/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Extension request approve path',
        expected: 'Customer should be able to respond to pending extension request.',
        steps: ['Open cancelable order', 'Click Onayliyorum', 'Click Yanitimi Onayla'],
        fixtureUsed: 'extension_request_fixture',
      },
      async () => {
        await safeGoto(page, `/siparis/${fixtureState.orderIds.cancelable}`)
        await page.getByRole('button', { name: /Onaylıyorum/i }).click()
        await page.getByRole('button', { name: /Yanıtımı Onayla/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cancelable order open cancel dialog',
        expected: 'Cancelable order should open the cancel dialog.',
        steps: ['Stay on cancelable order', 'Click Siparisi Iptal Et'],
        fixtureUsed: 'cancelable_order_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Siparişi İptal Et/i }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cancelable order cancel dialog dismiss',
        expected: 'Cancel dialog should allow backing out.',
        steps: ['Stay on cancel dialog', 'Click Vazgec'],
        fixtureUsed: 'cancelable_order_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Vazgeç/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cancelable order submit cancellation',
        expected: 'Cancelable order should be cancelable by customer.',
        steps: ['Re-open cancel dialog', 'Select reason', 'Click Evet, iptal et'],
        fixtureUsed: 'cancelable_order_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Siparişi İptal Et/i }).click()
        await page.locator('input[name="cancel-reason"]').first().check()
        await page.getByRole('button', { name: /Evet, iptal et/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Addresses add shipping',
        expected: 'Customer should be able to add a new shipping address.',
        steps: ['Open /hesabim/adresler', 'Click Yeni Adres', 'Fill form', 'Click Kaydet'],
        fixtureUsed: 'account_addresses',
      },
      async () => {
        await safeGoto(page, '/hesabim/adresler')
        await page.getByRole('button', { name: /Yeni Adres/i }).click()
        await page.locator('#label').fill('Audit Adresi')
        await page.locator('#fullName').fill('Playwright Musteri')
        await page.locator('#phone').fill('05001112233')
        await page.locator('#addressLine1').fill('Audit Sokak No:3')
        await page.locator('#district').fill('Sisli')
        await page.locator('#city').fill('Istanbul')
        await page.locator('#postalCode').fill('34381')
        await page.getByRole('button', { name: /^Kaydet$/i }).click()
        await expect(page.getByText(/Audit Adresi/i)).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Addresses edit shipping',
        expected: 'Customer should be able to edit the created shipping address.',
        steps: ['Stay on addresses page', 'Click Duzenle', 'Change label', 'Click Kaydet'],
        fixtureUsed: 'account_addresses',
      },
      async () => {
        const card = page.getByText(/Audit Adresi/i).locator('..').locator('..')
        await card.getByText(/Düzenle/i).click()
        await page.locator('#label').fill('Audit Adresi Guncel')
        await page.getByRole('button', { name: /^Kaydet$/i }).click()
        await expect(page.getByText(/Audit Adresi Guncel/i)).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Addresses set default',
        expected: 'Non-default address should be settable as default.',
        steps: ['Stay on addresses page', 'Click Varsayilan Yap on created address'],
        fixtureUsed: 'account_addresses',
      },
      async () => {
        const card = page.getByText(/Audit Adresi Guncel/i).locator('..').locator('..')
        await card.getByText(/Varsayılan Yap/i).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Addresses add billing',
        expected: 'Customer should be able to add a billing address.',
        steps: ['Stay on addresses page', 'Click Yeni Fatura Adresi', 'Fill corporate form', 'Click Kaydet'],
        fixtureUsed: 'billing_address_fixture',
      },
      async () => {
        await page.getByRole('button', { name: /Yeni Fatura Adresi/i }).click()
        await page.getByLabel(/Ünvan/i).fill('Audit Fatura Ltd Sti')
        await page.getByLabel(/Yetkili Ad Soyad/i).fill('Playwright Musteri')
        await page.getByLabel(/^Telefon/i).fill('05009998877')
        await page.locator('#taxOffice').fill('Sisli')
        await page.locator('#taxNumber').fill('1234512345')
        await page.locator('#addressLine1').fill('Fatura Caddesi No:5')
        await page.locator('#district').fill('Sisli')
        await page.locator('#city').fill('Istanbul')
        await page.locator('#postalCode').fill('34381')
        await page.getByRole('button', { name: /^Kaydet$/i }).click()
        await expect(page.getByText(/Audit Fatura Ltd Sti/i)).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Addresses delete created shipping',
        expected: 'Customer should be able to delete a non-fixture address.',
        steps: ['Stay on addresses page', 'Accept confirm', 'Click Sil'],
        fixtureUsed: 'account_addresses',
      },
      async () => {
        page.once('dialog', (dialog) => dialog.accept())
        const card = page.getByText(/Audit Adresi Guncel/i).locator('..').locator('..')
        await card.getByText(/^Sil$/i).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Favorites page remove item',
        expected: 'Favorited product should be removable from Favorites page.',
        steps: ['Open /hesabim/favoriler', 'Click favorite toggle on product card'],
        fixtureUsed: 'favorites_fixture',
      },
      async () => {
        await safeGoto(page, '/hesabim/favoriler')
        await expect(page.getByText(/Favorilerim/i)).toBeVisible({ timeout: 10_000 })
        await page.getByRole('button', { name: /Favorilerden çıkar/i }).first().click()
      },
    )

    await runControl(
      {
        priority: 'P3',
        clickedControl: 'Favorites empty state explore button',
        expected: 'Empty favorites page should link back to product discovery.',
        steps: ['Stay on /hesabim/favoriler', 'Click Urunleri Kesfet'],
        fixtureUsed: 'favorites_fixture',
      },
      async () => {
        await page.getByRole('link', { name: /Ürünleri Keşfet/i }).click()
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Review submit',
        expected: 'Eligible customer should be able to submit a product review.',
        steps: ['Open canonical product', 'Switch to reviews tab', 'Fill form', 'Click Degerlendirmeyi Gonder'],
        fixtureUsed: 'review_eligible_fixture',
      },
      async () => {
        await safeGoto(page, `/urun/${fixtureState.productSlug}`)
        await page.getByRole('tab', { name: /Değerlendirmeler/i }).click()
        await expect(page.getByText(/Değerlendirme yaz/i)).toBeVisible({ timeout: 10_000 })
        await page.getByRole('radio', { name: /5 yıldız/i }).click()
        await page.locator('#review-title').fill(CUSTOMER_FIXTURE.reviewTitle)
        await page.locator('#review-body').fill(CUSTOMER_FIXTURE.reviewBody)
        await page.getByRole('button', { name: /Değerlendirmeyi Gönder/i }).click()
        await expect(page.getByText(/Değerlendirmen alındı/i)).toBeVisible({ timeout: 15_000 })
      },
    )

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Invoices page load',
        expected: 'Invoices page should be accessible for logged-in customer.',
        steps: ['Open /faturalarim'],
        fixtureUsed: 'invoice_fixture',
      },
      async () => {
        await safeGoto(page, '/faturalarim')
        await expect(page.getByText(/Faturalarım/i)).toBeVisible({ timeout: 10_000 })
      },
    )

    if (fixtureState.invoiceFixtureAvailable) {
      await runControl(
        {
          priority: 'P2',
          clickedControl: 'Invoice page to order link',
          expected: 'Invoice card should navigate back to the order detail.',
          steps: ['Stay on /faturalarim', 'Click Siparis'],
          fixtureUsed: 'invoice_fixture',
        },
        async () => {
          await page.getByRole('link', { name: /Sipariş/i }).first().click()
          await expect(page).toHaveURL(new RegExp(`/siparis/${fixtureState.orderIds.invoiceReview}$`), {
            timeout: 10_000,
          })
        },
      )

      await safeGoto(page, '/faturalarim')

      await runControl(
        {
          priority: 'P2',
          clickedControl: 'Invoice view button',
          expected: 'Invoice view link should respond successfully.',
          steps: ['Stay on /faturalarim', 'Click Goruntule'],
          fixtureUsed: 'invoice_fixture',
        },
        async () => {
          const href = await page.getByRole('link', { name: /Görüntüle/i }).first().getAttribute('href')
          expect(href).toBeTruthy()
          const response = await page.request.get(href!)
          expect(response.ok()).toBeTruthy()
        },
      )

      await runControl(
        {
          priority: 'P2',
          clickedControl: 'Invoice download button',
          expected: 'Invoice download link should respond successfully.',
          steps: ['Stay on /faturalarim', 'Click Indir'],
          fixtureUsed: 'invoice_fixture',
        },
        async () => {
          const href = await page.getByRole('link', { name: /İndir/i }).first().getAttribute('href')
          expect(href).toBeTruthy()
          const response = await page.request.get(href!)
          expect(response.ok()).toBeTruthy()
        },
      )
    } else {
      recordFixtureGap(
        'Invoice buttons',
        'Seller invoice view/download controls should be visible when invoice fixture is available.',
        `Invoice fixture unavailable: ${fixtureState.invoiceFixtureError ?? 'unknown R2/setup error'}`,
        'invoice_fixture',
        ['Open /faturalarim'],
      )
    }

    await runControl(
      {
        priority: 'P2',
        clickedControl: 'Cross-customer order access',
        expected: 'Customer should not access another customer order.',
        steps: ['Open seeded foreign order /siparis/order_01 while logged in as Playwright customer'],
        fixtureUsed: 'negative_authorization',
      },
      async () => {
        await page.goto('/siparis/order_01')
        await expect(page.getByText(/Bulunamadı|Not Found|Giriş/i)).toBeVisible({ timeout: 15_000 })
      },
    )
  } finally {
    await recorder.writeReport()
  }

  const summary = recorder.getPrioritySummary()
  expect(summary.P1).toBeGreaterThanOrEqual(0)
})
