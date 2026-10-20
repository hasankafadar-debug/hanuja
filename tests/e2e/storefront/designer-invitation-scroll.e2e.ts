import { expect, test, type Page } from '@playwright/test'

const invitation = '/tasarimci-daveti'

async function scene(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#heroVideo')!
    const track = document.querySelector<HTMLElement>('#heroScroll')!
    const hero = document.querySelector<HTMLElement>('#sahne')!
    return {
      start: track.getBoundingClientRect().top + scrollY,
      travel: track.offsetHeight - hero.offsetHeight,
      end: track.getBoundingClientRect().bottom + scrollY,
      time: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      seeking: video.seeking,
      y: scrollY,
      viewport: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
}

async function expectFrame(page: Page, progress: number) {
  const geometry = await scene(page)
  await page.evaluate(y => scrollTo(0, y), geometry.start + geometry.travel * progress)
  await expect.poll(async () => (await scene(page)).time).toBeCloseTo(
    progress * (geometry.duration - 1 / 30), 1,
  )
  await expect.poll(async () => (await scene(page)).seeking).toBe(false)
  expect((await scene(page)).paused).toBe(true)
  expect((await scene(page)).overflow).toBe(false)
}

for (const mobile of [false, true]) {
  test.describe(mobile ? '390px touch invitation' : '1440px desktop invitation', () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      contextOptions: { reducedMotion: 'no-preference' },
    })

    test('scroll position selects paused frames, including reverse and fast native input', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit cannot decode this MP4; this is not an iPhone playback test.')
      const errors: string[] = []
      const missing: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('response', r => { if (r.status() >= 400) missing.push(r.url()) })
      const response = await page.goto(invitation)
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
      await expect.poll(() => page.locator('#heroVideo').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
      await page.evaluate(() => document.fonts.ready)
      const initial = await scene(page)
      expect(initial.time).toBe(0)
      expect(initial.paused).toBe(true)
      expect(initial.travel / initial.viewport).toBeGreaterThan(1)
      expect(initial.travel / initial.viewport).toBeLessThan(1.3)
      await expect(page.locator('.rail-cue, #replay')).toHaveCount(0)
      await expect(page.locator('#sahne')).not.toContainText(/Sahneyi kurmak için kaydırın|Kaydırın|Kaydır/)
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('#heroVideo')!
        ;(window as typeof window & { heroSeeks?: number }).heroSeeks = 0
        video.addEventListener('seeking', () => {
          const state = window as typeof window & { heroSeeks: number }
          state.heroSeeks++
        })
      })
      for (const progress of [0.25, 0.5, 1, 0.5, 0]) await expectFrame(page, progress)
      await expectFrame(page, 0.5)
      const stopped = await scene(page)
      const stoppedSeeks = await page.evaluate(() => (window as typeof window & { heroSeeks: number }).heroSeeks)
      await page.waitForTimeout(650)
      expect((await scene(page)).time).toBe(stopped.time)
      expect(await page.evaluate(() => (window as typeof window & { heroSeeks: number }).heroSeeks)).toBe(stoppedSeeks)
      await expectFrame(page, 0)
      const began = Date.now()
      if (mobile) {
        test.skip(browserName !== 'chromium', 'Native fling uses Chromium CDP, not a real iPhone.')
        const cdp = await page.context().newCDPSession(page)
        for (let swipe = 0; swipe < 3; swipe++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 740 }] })
          for (const y of [620, 500, 360, 200, 60]) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] })
            await page.waitForTimeout(16)
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        }
      } else {
        await page.mouse.wheel(0, 5000)
      }
      await expect.poll(async () => (await scene(page)).y).toBeGreaterThan(initial.end)
      expect(Date.now() - began).toBeLessThan(3000)
      await expect.poll(async () => (await scene(page)).time).toBeCloseTo(initial.duration - 1 / 30, 1)
      expect(errors).toEqual([])
      expect(missing).toEqual([])
    })

    test('resize, restored position and direct anchors never create a scroll gate', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit MP4 codec limitation.')
      await page.goto(invitation)
      await expect.poll(() => page.locator('#heroVideo').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
      await expectFrame(page, 0.5)
      await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 390, height: 844 })
      await expect.poll(async () => {
        const state = await scene(page)
        const progress = Math.max(0, Math.min(1, (state.y - state.start) / state.travel))
        return Math.abs(state.time - progress * (state.duration - 1 / 30))
      }).toBeLessThan(0.06)
      expect((await scene(page)).overflow).toBe(false)
      await page.reload()
      await expect.poll(() => page.locator('#heroVideo').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
      await expect.poll(async () => {
        const state = await scene(page)
        return Math.abs(state.time - Math.max(0, Math.min(1, (state.y - state.start) / state.travel)) * (state.duration - 1 / 30))
      }).toBeLessThan(0.06)
      await page.goto(invitation + '#panel')
      await expect.poll(async () => (await scene(page)).y).toBeGreaterThan((await scene(page)).end)
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflowY)).not.toBe('hidden')
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
    })
  })
}

test.describe('page-specific full motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('keeps full motion even when the operating system requests reduced motion', async ({ page }) => {
    await page.goto(invitation)
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
    await expect(page.locator('#heroScroll')).toHaveClass(/is-scrubbing/)
    await expect(page.locator('#heroVideo')).toHaveAttribute('src', /stage-9x16-scroll\.mp4/)
    expect((await scene(page)).travel).toBeGreaterThan(800)
    expect(await page.locator('.marquee-row').evaluate(el => getComputedStyle(el).animationName)).toBe('slide')
    expect(await page.locator('.hero-anim > *').first().evaluate(el => getComputedStyle(el).animationName)).toBe('heroIn')
    await page.keyboard.press('PageDown')
    await expect.poll(async () => (await scene(page)).y).toBeGreaterThan(0)
    await expect.poll(async () => (await scene(page)).time).toBeGreaterThan(0)
  })
})
