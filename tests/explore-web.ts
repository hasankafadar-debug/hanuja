/**
 * Web panel UI exploration — DB gerektirmez.
 * Çalıştır: cd tests && npx tsx explore-web.ts
 */
import { chromium, type Page } from '@playwright/test'

const BASE = 'http://localhost:3000'
const TIMEOUT = 12000

interface Result {
  name: string
  url?: string
  fromUrl?: string
  landedUrl?: string
  httpStatus?: number | null
  h1Text?: string | null
  status: string
  errorText?: string | null
  consoleErrors?: string[]
  selector?: string
  error?: string
}

const results: Result[] = []
const pageErrors: { page: string; url: string; error: string }[] = []

async function testPage(page: Page, name: string, url: string) {
  console.log(`\n[PAGE] ${name}: ${url}`)
  let status = 'ok'
  let httpStatus: number | null = null
  let h1Text: string | null = null
  let errorText: string | null = null
  const errors: string[] = []

  const handler = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') errors.push(msg.text())
  }
  const peHandler = (err: Error) => errors.push('PAGE ERROR: ' + err.message)
  page.on('console', handler)
  page.on('pageerror', peHandler)

  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    httpStatus = resp?.status() ?? null
    await page.waitForTimeout(1500)

    const bodyText = await page.textContent('body').catch(() => '')
    if (bodyText?.includes('Application error') || bodyText?.includes('Internal Server Error')) {
      status = 'APP_ERROR'
      errorText = bodyText.slice(0, 300)
    }

    h1Text = await page.$eval('h1', (el) => el.textContent?.trim() ?? null).catch(() => null)

    if (httpStatus && httpStatus >= 400) status = `HTTP_${httpStatus}`

    console.log(`  → HTTP ${httpStatus} | h1: "${h1Text}" | status: ${status}`)
    if (errors.length) {
      console.log(`  → Console errors: ${errors.length}`)
      errors.forEach((e) => console.log(`    - ${e.slice(0, 180)}`))
    }
  } catch (err: unknown) {
    status = 'TIMEOUT_OR_ERROR'
    errorText = (err as Error).message
    console.log(`  → FAILED: ${errorText?.slice(0, 100)}`)
  }

  page.off('console', handler)
  page.off('pageerror', peHandler)

  results.push({ name, url, httpStatus, h1Text, status, errorText, consoleErrors: errors })
  pageErrors.push(...errors.map((e) => ({ page: name, url, error: e })))
}

async function testClick(
  page: Page,
  fromName: string,
  fromUrl: string,
  selector: string,
  clickDesc: string,
): Promise<string | null> {
  console.log(`\n[CLICK] ${fromName}: ${fromUrl} → "${clickDesc}"`)
  try {
    await page.goto(BASE + fromUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    await page.waitForTimeout(1000)

    const el = await page.$(selector)
    if (!el) {
      console.log(`  → selector not found: ${selector}`)
      results.push({ name: `click:${fromName}→${clickDesc}`, status: 'NO_SELECTOR', selector })
      return null
    }

    const href = await el.getAttribute('href').catch(() => null)
    const text = await el.textContent().catch(() => '')
    console.log(`  → clicking: "${text?.trim()?.slice(0, 60)}" (href: ${href})`)

    const errors: string[] = []
    const handler = (msg: { type(): string; text(): string }) => {
      if (msg.type() === 'error') errors.push(msg.text())
    }
    const peHandler = (err: Error) => errors.push('PAGE ERROR: ' + err.message)
    page.on('console', handler)
    page.on('pageerror', peHandler)

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT }),
      el.click(),
    ]).catch(() => {})
    await page.waitForTimeout(2000)

    const landedUrl = page.url()
    const bodyText = await page.textContent('body').catch(() => '')
    const hasAppError = bodyText?.includes('Application error') || bodyText?.includes('Internal Server Error')

    page.off('console', handler)
    page.off('pageerror', peHandler)

    const status = hasAppError ? 'APP_ERROR' : 'ok'
    console.log(`  → landed: ${landedUrl} | status: ${status}`)
    if (errors.length) {
      console.log(`  → Console errors: ${errors.length}`)
      errors.forEach((e) => console.log(`    - ${e.slice(0, 180)}`))
    }

    results.push({
      name: `click:${fromName}→${clickDesc}`,
      fromUrl,
      landedUrl,
      status,
      consoleErrors: errors,
    })
    pageErrors.push(...errors.map((e) => ({ page: `click:${fromName}→${clickDesc}`, url: landedUrl, error: e })))
    return landedUrl
  } catch (err: unknown) {
    console.log(`  → ERROR: ${(err as Error).message.slice(0, 120)}`)
    results.push({
      name: `click:${fromName}→${clickDesc}`,
      fromUrl,
      status: 'ERROR',
      error: (err as Error).message,
    })
    return null
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  console.log('=== WEB PANELİ KEŞİF TESTİ ===')
  console.log(`Base URL: ${BASE}\n`)

  // 1. Public static pages
  await testPage(page, 'homepage', '/')
  await testPage(page, 'kategori-listesi', '/kategori')
  await testPage(page, 'urunler', '/urunler')
  await testPage(page, 'magaza-listesi', '/magaza')
  await testPage(page, 'blog-listesi', '/blog')
  await testPage(page, 'sepet', '/sepet')
  await testPage(page, 'giris', '/giris')
  await testPage(page, 'kayit', '/kayit')

  // 2. Auth-required (should redirect, not error)
  await testPage(page, 'hesabim', '/hesabim')
  await testPage(page, 'siparis', '/siparis')
  await testPage(page, 'odeme', '/odeme')

  // 3. Click: first category from homepage
  await testClick(page, 'homepage', '/', 'a[href^="/kategori"]', 'first-kategori')

  // 4. Click: first product from /urunler
  const productUrl = await testClick(page, 'urunler', '/urunler', 'a[href^="/urun"]', 'first-urun')

  // 5. Click: add to cart on product page
  if (productUrl?.includes('/urun/')) {
    const rel = productUrl.replace(BASE, '')
    await testPage(page, 'urun-detail', rel)
    await testClick(page, 'urun-detail', rel, 'button[type="submit"]', 'sepete-ekle')
  }

  // 6. Click: blog article
  await testClick(page, 'blog', '/blog', 'a[href^="/blog/"]', 'first-blog-article')

  // 7. Click: store page
  await testClick(page, 'magaza', '/magaza', 'a[href^="/magaza/"]', 'first-store')

  await browser.close()

  // ── Summary
  console.log('\n\n═══════════════════════════════════════')
  console.log('ÖZET')
  console.log('═══════════════════════════════════════')
  const failed = results.filter((r) => r.status !== 'ok')
  const passed = results.filter((r) => r.status === 'ok')
  console.log(`✓ Başarılı: ${passed.length}`)
  console.log(`✗ Hata: ${failed.length}`)

  if (failed.length > 0) {
    console.log('\n─── BAŞARISIZ TESTLER ───')
    for (const r of failed) {
      console.log(`\n  ✗ ${r.name}`)
      if (r.url || r.fromUrl) console.log(`    URL: ${r.url ?? r.fromUrl}`)
      if (r.landedUrl) console.log(`    Landed: ${r.landedUrl}`)
      console.log(`    Durum: ${r.status}`)
      if (r.selector) console.log(`    Selector: ${r.selector}`)
      if (r.errorText) console.log(`    Hata: ${r.errorText.slice(0, 300)}`)
      r.consoleErrors?.forEach((e) => console.log(`    Console: ${e.slice(0, 180)}`))
    }
  }

  const allConsoleErrors = pageErrors.filter((e) => !e.error.includes('Failed to load resource'))
  if (allConsoleErrors.length > 0) {
    console.log('\n─── CONSOLE HATALARI ───')
    const unique = [...new Set(allConsoleErrors.map((e) => `[${e.page}] ${e.error}`))]
    unique.forEach((e) => console.log(`  ${e.slice(0, 200)}`))
  }

  process.exit(failed.length > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error('Script hatası:', err)
  process.exit(1)
})
