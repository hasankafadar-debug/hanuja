import { expect, test, type Page } from '@playwright/test'

const invitation = '/tasarimci-daveti'
type Trigger = { vars: { id?: string }; start: number; end: number; pin?: HTMLElement; progress: number }
type MotionWindow = typeof window & { ScrollTrigger: { getAll(): Trigger[]; refresh(): void } }

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('html')).toHaveClass(/gsap-on/)
  await page.evaluate(() => (window as MotionWindow).ScrollTrigger.refresh())
}

async function progress(page: Page, id: string, value: number) {
  await page.evaluate(({ id, value }) => {
    const trigger = (window as MotionWindow).ScrollTrigger.getAll().find(t => t.vars.id === id)!
    scrollTo(0, trigger.start + (trigger.end - trigger.start) * value)
  }, { id, value })
  await expect.poll(() => page.evaluate(id => (window as MotionWindow).ScrollTrigger.getAll().find(t => t.vars.id === id)!.progress, id)).toBeCloseTo(value, 1)
}

async function channelGeometry(page: Page) {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>('#chTrack')!
    const clip = document.querySelector<HTMLElement>('.ch-scroller')!
    const trigger = (window as MotionWindow).ScrollTrigger.getAll().find(t => t.vars.id === 'channels')!
    const pin = trigger.pin!
    const style = getComputedStyle(track)
    const children = [...track.children].filter(el => getComputedStyle(el).display !== 'none')
    // Sum every rendered child's box and the gaps, independently of the production last-edge calculation.
    const childrenWidth = children.reduce((sum, el) => {
      const childStyle = getComputedStyle(el)
      return sum + el.getBoundingClientRect().width + parseFloat(childStyle.marginLeft) + parseFloat(childStyle.marginRight)
    }, 0)
    const contentWidth = childrenWidth + parseFloat(style.columnGap) * (children.length - 1)
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const last = children.at(-1)!.getBoundingClientRect()
    const viewport = clip.getBoundingClientRect()
    const label = document.querySelector('#kazanc .eyebrow')!.getBoundingClientRect()
    return {
      start: trigger.start, end: trigger.end, distance: trigger.end - trigger.start,
      expected: Math.max(0, Math.round(contentWidth) - clip.clientWidth),
      contentWidth, padding: parseFloat(getComputedStyle(pin.parentElement!).paddingBottom),
      spacerHeight: pin.parentElement!.getBoundingClientRect().height, pinHeight: pin.getBoundingClientRect().height,
      x: new DOMMatrixReadOnly(style.transform).m41,
      lastLeft: last.left, lastRight: last.right, viewportLeft: viewport.left,
      expectedRight: viewport.right - parseFloat(style.paddingRight),
      labelTop: label.top, labelBottom: label.bottom, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      pins: (window as MotionWindow).ScrollTrigger.getAll().filter(t => t.vars.id === 'channels').length,
    }
  })
}

test('horizontal pin ends at the actual cards, including WebKit intrinsic width and viewport changes', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName === 'firefox', 'Targeted Chromium baseline and WebKit layout regression; physical iOS acceptance is separate.')
  test.setTimeout(120_000)
  const results = []
  const matrix = [[393, 852], [402, 874], [412, 915], [1440, 900], [1920, 1080]]
  for (const [width, height] of matrix) {
    const mobile = width! < 1000
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' })
    const page = await context.newPage()
    try {
      await page.goto(invitation)
      await ready(page)
      const initial = await channelGeometry(page)
      expect(Math.abs(initial.distance - initial.expected)).toBeLessThanOrEqual(1)
      expect(Math.abs(initial.padding - initial.expected)).toBeLessThanOrEqual(1)
      expect(Math.abs(initial.spacerHeight - initial.pinHeight - initial.expected)).toBeLessThanOrEqual(1)
      // These content dimensions preserve the approved Chromium mobile/desktop layout.
      expect(Math.round(initial.contentWidth)).toBe(({ 393: 1444, 402: 1475, 412: 1509, 1440: 2415, 1920: 2460 } as Record<number, number>)[width!])
      for (const value of [0.25, 0.5, 0.9, 1, 0.5, 1]) {
        await progress(page, 'channels', value)
        await expect.poll(async () => {
          const state = await channelGeometry(page)
          return Math.abs(state.x + state.expected * value)
        }).toBeLessThanOrEqual(1)
      }
      const end = await channelGeometry(page)
      expect(Math.abs(end.lastRight - end.expectedRight)).toBeLessThanOrEqual(1)
      expect(end.lastLeft).toBeGreaterThanOrEqual(end.viewportLeft - 1)
      if (mobile) {
        await page.evaluate(y => scrollTo(0, y), end.end + end.height * 0.25)
        await expect.poll(async () => (await channelGeometry(page)).labelBottom).toBeLessThanOrEqual(end.height)
        expect((await channelGeometry(page)).labelTop).toBeGreaterThan(0)
        for (const viewport of [{ width: width!, height: height! - 96 }, { width: width!, height: height! }, { width: height!, height: width! }, { width: width!, height: height! }]) {
          await progress(page, 'channels', 0.5)
          await page.setViewportSize(viewport)
          await ready(page)
          const resized = await channelGeometry(page)
          expect(Math.abs(resized.distance - resized.expected)).toBeLessThanOrEqual(1)
          expect(Math.abs(resized.padding - resized.expected)).toBeLessThanOrEqual(1)
          expect(resized.pins).toBe(1)
          expect(resized.overflow).toBeLessThanOrEqual(1)
        }
        await page.goto(invitation + '#kazanc')
        await expect.poll(() => page.locator('#kazanc').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2)
        await page.goto(invitation + '#gorunurluk')
        await page.goBack()
        await ready(page)
        await progress(page, 'channels', 1)
        const restored = await channelGeometry(page)
        expect(Math.abs(restored.lastRight - restored.expectedRight)).toBeLessThanOrEqual(1)
      }
      results.push({ width, height, initial, end, final: await channelGeometry(page) })
    } finally {
      await context.close()
    }
  }
  await testInfo.attach('horizontal-pin-geometry', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
})

test('responsive motion geometry, full-frame screenshots and one effective motion mode', async ({ browser }, testInfo) => {
  test.setTimeout(90_000)
  const matrix = [[360, 800], [384, 832], [390, 844], [393, 873], [412, 915], [414, 896], [430, 932], [722, 874], [844, 390], [1440, 900], [1920, 1080]]
  const results = []
  for (let i = 0; i < matrix.length; i++) {
    const [width, height] = matrix[i]!
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, isMobile: width! < 1000, hasTouch: width! < 1000, reducedMotion: i % 2 ? 'reduce' : 'no-preference' })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(invitation)
    await ready(page)
    const geometry = await page.evaluate(() => ({
      mode: document.documentElement.dataset.motion,
      overflow: document.documentElement.scrollWidth - innerWidth,
      marquee: getComputedStyle(document.querySelector('.marquee-row')!).animationName,
      hero: document.querySelector('#heroScroll')!.classList.contains('is-scrubbing'),
      triggers: (window as MotionWindow).ScrollTrigger.getAll().filter(t => t.vars.id).map(t => ({ id: t.vars.id, height: t.pin?.offsetHeight, distance: t.end - t.start })),
      panel: getComputedStyle(document.querySelector('.frame')!).position,
      shots: [...document.querySelectorAll<HTMLImageElement>('#frameView img')].map(img => ({ src: img.getAttribute('src'), fit: getComputedStyle(img).objectFit, transform: getComputedStyle(img).transform })),
    }))
    expect(geometry.mode).toBe('full')
    expect(geometry.hero).toBe(true)
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    expect(geometry.marquee).toBe('slide')
    expect(geometry.panel).toBe('sticky')
    expect(new Set(geometry.triggers.map(t => t.id)).size).toBe(geometry.triggers.length)
    expect(geometry.triggers.map(t => t.id)).toEqual(width! < 1000 ? ['channels', 'cycle', 'onboarding'] : ['channels', 'cycle'])
    for (const trigger of geometry.triggers) {
      expect(trigger.height, `${width}x${height} ${trigger.id}`).toBeLessThanOrEqual(height!)
      expect(trigger.distance).toBeGreaterThan(200)
    }
    for (const shot of geometry.shots) {
      expect(shot.src).not.toContain('/f-')
      expect(shot.fit).toBe('contain')
      expect(shot.transform).toBe('none')
    }
    await progress(page, 'channels', 0.5)
    const card = await page.locator('.ch-card:not(.ch-intro-card)').nth(1).evaluate(el => ({ height: (el as HTMLElement).offsetHeight, visible: getComputedStyle(el).overflow }))
    expect(card.height).toBeLessThan(height!)
    expect(errors).toEqual([])
    results.push({ width, height, reducedMotion: i % 2 ? 'reduce' : 'no-preference', ...geometry })
    if ([390, 722, 1440].includes(width!)) {
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`${width}-initial.png`) })
      await page.locator('.pgrid').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${width}-panel.png`) })
    }
    await context.close()
  }
  await testInfo.attach('responsive-geometry', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
})

for (const reduce of [false, true]) {
  test.describe(`mobile story, OS reduce ${reduce}`, () => {
    test.use({ viewport: reduce ? { width: 393, height: 873 } : { width: 384, height: 832 }, isMobile: true, hasTouch: true, contextOptions: { reducedMotion: reduce ? 'reduce' : 'no-preference' } })
    test('vertical scrolling reaches every card, cycle, onboarding and all six panel states', async ({ page }, testInfo) => {
      const errors: string[] = []
      const failed: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
      page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(`${r.failure()?.errorText} ${r.url()}`) })
      await page.goto(invitation)
      await ready(page)
      const cards = page.locator('.ch-card:not(.ch-intro-card)')
      await expect(cards).toHaveCount(4)
      for (const index of [0, 1, 2, 3, 1, 0]) {
        const target = await page.evaluate(index => {
          const card = document.querySelectorAll<HTMLElement>('.ch-card:not(.ch-intro-card)')[index]!
          const viewport = document.querySelector<HTMLElement>('.ch-scroller')!
          const track = document.querySelector<HTMLElement>('#chTrack')!
          const trigger = (window as MotionWindow).ScrollTrigger.getAll().find(t => t.vars.id === 'channels')!
          const x = Math.max(0, Math.min(track.scrollWidth - viewport.clientWidth, card.offsetLeft + card.offsetWidth / 2 - viewport.clientWidth / 2))
          return trigger.start + x
        }, index)
        await page.evaluate(y => scrollTo(0, y), target)
        await expect.poll(() => cards.nth(index).evaluate(el => {
          const r = el.getBoundingClientRect(), v = document.querySelector('.ch-scroller')!.getBoundingClientRect()
          return r.left >= v.left - 2 && r.right <= v.right + 2 && r.top >= 0 && r.bottom <= innerHeight
        })).toBe(true)
      }
      await progress(page, 'cycle', 0.1)
      const before = await page.locator('#loopProg').getAttribute('style')
      await progress(page, 'cycle', 0.9)
      expect(await page.locator('#loopProg').getAttribute('style')).not.toBe(before)
      await expect(page.locator('.loop-node.on')).toHaveCount(4)
      await progress(page, 'cycle', 0.5)
      const loop = await page.locator('.loop-fig').boundingBox()
      expect(loop!.y).toBeGreaterThan(50)
      expect(loop!.y + loop!.height).toBeLessThan(900)
      await progress(page, 'onboarding', 0.1)
      const raw = await page.locator('.xcard.raw').evaluate(el => getComputedStyle(el).transform)
      await progress(page, 'onboarding', 0.9)
      expect(await page.locator('.xcard.raw').evaluate(el => getComputedStyle(el).transform)).not.toBe(raw)
      await page.screenshot({ path: testInfo.outputPath('onboarding.png') })
      const steps = page.locator('.pstep')
      for (const index of [0, 1, 2, 3, 4, 5, 2]) {
        await page.evaluate(index => {
          const step = document.querySelectorAll<HTMLElement>('.pstep')[index]!
          const frame = document.querySelector<HTMLElement>('.frame')!
          const header = document.querySelector('#top')!.getBoundingClientRect().bottom
          scrollTo(0, scrollY + step.getBoundingClientRect().top - header - frame.offsetHeight - 30)
        }, index)
        await expect(page.locator('#frameCount')).toHaveText(`${index + 1} / 6`)
        await expect(page.locator('#frameView img.on')).toHaveCount(1)
        await expect.poll(() => page.locator('#frameView img.on').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
        const visible = await steps.nth(index).locator('p').boundingBox()
        const frame = await page.locator('.frame').boundingBox()
        expect(visible!.y).toBeGreaterThanOrEqual(frame!.y + frame!.height)
        expect(visible!.y + visible!.height).toBeLessThanOrEqual(reduce ? 873 : 832)
      }
      await page.screenshot({ path: testInfo.outputPath('panel-step-3.png') })
      await page.locator('#manifesto').scrollIntoViewIfNeeded()
      await expect.poll(() => page.locator('#manifestoText .lit').count()).toBeGreaterThan(0)
      await expect.poll(() => page.locator('.h-display.is-in').count()).toBeGreaterThan(0)
      await page.locator('.marquee').scrollIntoViewIfNeeded()
      const marquee = await page.locator('.marquee-row').evaluate(el => getComputedStyle(el).transform)
      await expect.poll(() => page.locator('.marquee-row').evaluate(el => getComputedStyle(el).transform)).not.toBe(marquee)
      expect(await page.locator('.spot').evaluate(el => getComputedStyle(el).animationName)).toBe('breathe')
      await expect(page.locator('a[href="https://satici.hanuja.com.tr/basvuru"]').first()).toHaveAttribute('href', 'https://satici.hanuja.com.tr/basvuru')
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      expect(errors).toEqual([])
      expect(failed).toEqual([])
    })
  })
}

test('late fonts, deep anchors, reload and orientation settle at the actual target without duplicate pins', async ({ page }) => {
  await page.setViewportSize({ width: 722, height: 874 })
  await page.route('**/assets/fonts/**', async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue() })
  for (const reload of [false, true]) {
    if (reload) await page.reload()
    else await page.goto(invitation + '#panel')
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.locator('#panel').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2)
    const heading = await page.locator('#panel h2').boundingBox()
    expect(heading!.y).toBeGreaterThan(70)
    expect(heading!.y + heading!.height).toBeLessThan(874)
  }
  for (const viewport of [{ width: 844, height: 390 }, { width: 393, height: 873 }, { width: 1440, height: 900 }, { width: 722, height: 874 }]) {
    await page.setViewportSize(viewport)
    await ready(page)
    const pins = await page.evaluate(() => (window as MotionWindow).ScrollTrigger.getAll().filter(t => t.vars.id).map(t => t.vars.id))
    expect(pins.filter(id => id === 'channels')).toHaveLength(1)
    expect(pins.filter(id => id === 'cycle')).toHaveLength(1)
    expect(pins.filter(id => id === 'onboarding')).toHaveLength(viewport.width < 1000 ? 1 : 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await expect(page.locator('.frame')).toHaveCount(1)
  }
})
