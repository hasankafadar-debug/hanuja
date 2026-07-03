/**
 * Web panel UI exploration — DB gerektirmez.
 * Public sayfaları açar, linklere tıklar, hataları yakalar.
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:3000'
const TIMEOUT = 12000

const results = []
const pageErrors = []

async function testPage(page, name, url) {
  console.log(`\n[PAGE] ${name}: ${url}`)
  let status = 'ok'
  let httpStatus = null
  let h1Text = null
  let errorText = null

  const errors = []
  const handler = (msg) => { if (msg.type() === 'error') errors.push(msg.text()) }
  const peHandler = (err) => errors.push('PAGE ERROR: ' + err.message)
  page.on('console', handler)
  page.on('pageerror', peHandler)

  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    httpStatus = resp?.status()

    // Check for Next.js red error overlay
    const hasOverlay = await page.$('nextjs-portal, [data-nextjs-dialog-overlay]').catch(() => null)
    if (hasOverlay) {
      const overlayText = await page.textContent('nextjs-portal, [data-nextjs-dialog-overlay]').catch(() => 'error overlay present')
      errorText = overlayText
      status = 'ERROR_OVERLAY'
    }

    // Check for "Application error" text
    const bodyText = await page.textContent('body').catch(() => '')
    if (bodyText.includes('Application error') || bodyText.includes('Internal Server Error')) {
      status = 'APP_ERROR'
      errorText = bodyText.slice(0, 200)
    }

    h1Text = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null)

    if (httpStatus >= 400) status = `HTTP_${httpStatus}`

    console.log(`  → HTTP ${httpStatus} | h1: "${h1Text}" | status: ${status}`)
    if (errors.length) {
      console.log(`  → Console errors: ${errors.length}`)
      errors.forEach(e => console.log(`    - ${e.slice(0, 150)}`))
    }
  } catch (err) {
    status = 'TIMEOUT_OR_ERROR'
    errorText = err.message
    console.log(`  → FAILED: ${err.message.slice(0, 100)}`)
  }

  page.off('console', handler)
  page.off('pageerror', peHandler)

  results.push({ name, url, httpStatus, h1Text, status, errorText, consoleErrors: errors })
  pageErrors.push(...errors.map(e => ({ page: name, url, error: e })))
}

async function testClick(page, fromName, fromUrl, selector, clickDesc) {
  console.log(`\n[CLICK] ${fromName}: ${fromUrl} → click "${clickDesc}"`)

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
    console.log(`  → clicking: "${text?.trim()}" (href: ${href})`)

    const errors = []
    const handler = (msg) => { if (msg.type() === 'error') errors.push(msg.text()) }
    const peHandler = (err) => errors.push('PAGE ERROR: ' + err.message)
    page.on('console', handler)
    page.on('pageerror', peHandler)

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT }),
      el.click(),
    ]).catch(() => {})

    await page.waitForTimeout(2000)

    const landedUrl = page.url()
    const bodyText = await page.textContent('body').catch(() => '')
    const hasAppError = bodyText.includes('Application error') || bodyText.includes('Internal Server Error')
    const httpStatus = null // can't get directly after click

    page.off('console', handler)
    page.off('pageerror', peHandler)

    const status = hasAppError ? 'APP_ERROR' : 'ok'
    console.log(`  → landed: ${landedUrl} | status: ${status}`)
    if (errors.length) {
      console.log(`  → Console errors: ${errors.length}`)
      errors.forEach(e => console.log(`    - ${e.slice(0, 150)}`))
    }

    results.push({ name: `click:${fromName}→${clickDesc}`, fromUrl, landedUrl, status, consoleErrors: errors })
    pageErrors.push(...errors.map(e => ({ page: `click:${fromName}→${clickDesc}`, url: landedUrl, error: e })))
    return landedUrl
  } catch (err) {
    console.log(`  → ERROR: ${err.message.slice(0, 120)}`)
    results.push({ name: `click:${fromName}→${clickDesc}`, fromUrl, status: 'ERROR', error: err.message })
    return null
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  console.log('=== WEB PANELİ KEŞIF TESTİ ===')
  console.log(`Base URL: ${BASE}\n`)

  // ── 1. Public static pages ──────────────────────────────────
  await testPage(page, 'homepage', '/')
  await testPage(page, 'kategori-listesi', '/kategori')
  await testPage(page, 'urunler', '/urunler')
  await testPage(page, 'magaza-listesi', '/magaza')
  await testPage(page, 'blog-listesi', '/blog')
  await testPage(page, 'sepet', '/sepet')
  await testPage(page, 'giris', '/giris')
  await testPage(page, 'kayit', '/kayit')
  await testPage(page, 'yasal-kvkk', '/yasal/kvkk')
  await testPage(page, 'yasal-gizlilik', '/yasal/gizlilik-politikasi')

  // ── 2. Auth-required pages (should redirect, not error) ─────
  await testPage(page, 'hesabim', '/hesabim')
  await testPage(page, 'siparis', '/siparis')
  await testPage(page, 'odeme', '/odeme')

  // ── 3. Click tests from homepage ─────────────────────────────
  // Click first category link
  await testClick(page, 'homepage', '/', 'a[href^="/kategori"]', 'first-kategori-link')

  // Click first product from /urunler
  await testClick(page, 'urunler', '/urunler', 'a[href^="/urun"]', 'first-urun-link')

  // Click blog article
  await testClick(page, 'blog', '/blog', 'a[href^="/blog/"]', 'first-blog-article')

  // Click first store
  await testClick(page, 'magaza', '/magaza', 'a[href^="/magaza/"]', 'first-store-link')

  // Click nav links from homepage
  await testClick(page, 'nav-sepet', '/', 'a[href="/sepet"]', 'sepet-nav-link')
  await testClick(page, 'nav-giris', '/', 'a[href="/giris"]', 'giris-nav-link')

  // Click "Sepete Ekle" button on first product
  const firstProductUrl = await testClick(page, 'urunler', '/urunler', 'a[href^="/urun"]', 'product-for-cart-test')
  if (firstProductUrl && firstProductUrl.includes('/urun/')) {
    await testClick(page, 'urun-sepete-ekle', firstProductUrl.replace(BASE, ''), 'button[type="submit"], form button', 'sepete-ekle-button')
  }

  await browser.close()

  // ── Summary ─────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════')
  console.log('ÖZET')
  console.log('═══════════════════════════════════════')

  const failed = results.filter(r => r.status !== 'ok')
  const passed = results.filter(r => r.status === 'ok')

  console.log(`✓ Başarılı: ${passed.length}`)
  console.log(`✗ Hata: ${failed.length}`)

  if (failed.length > 0) {
    console.log('\n─── HATALAR ───')
    for (const r of failed) {
      console.log(`\n  ✗ ${r.name}`)
      console.log(`    URL: ${r.url || r.fromUrl}`)
      console.log(`    Durum: ${r.status}`)
      if (r.errorText) console.log(`    Hata: ${r.errorText?.slice(0, 200)}`)
      if (r.consoleErrors?.length) {
        r.consoleErrors.forEach(e => console.log(`    Console: ${e.slice(0, 150)}`))
      }
    }
  }

  if (pageErrors.length > 0) {
    console.log('\n─── TÜM CONSOLE HATALARI ───')
    const unique = [...new Set(pageErrors.map(e => `[${e.page}] ${e.error}`))]
    unique.forEach(e => console.log(`  ${e.slice(0, 180)}`))
  }

  process.exit(failed.length > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('Script hatası:', err)
  process.exit(1)
})
