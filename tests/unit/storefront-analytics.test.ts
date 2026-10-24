import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsPagePath, GOOGLE_ANALYTICS_MEASUREMENT_ID } from '@hanuja/api/lib/storefront-analytics'
import { getConsentScripts } from '../../apps/web/src/lib/cookie-consent/scripts'

let browser: typeof import('../../apps/web/src/lib/cookie-consent/browser')
let target: {
  location: { hostname: string; origin: string; pathname: string; search: string }
  localStorage: { removeItem: ReturnType<typeof vi.fn> }
  sessionStorage: { removeItem: ReturnType<typeof vi.fn> }
  dataLayer?: ArrayLike<unknown>[]
  [key: `ga-disable-${string}`]: boolean | undefined
}
let elements: { dataset: Record<string, string>; src: string }[]
let deletedCookies: string[]

beforeEach(async () => {
  vi.resetModules()
  elements = []
  deletedCookies = []
  target = {
    location: { hostname: 'www.hanuja.com.tr', origin: 'https://www.hanuja.com.tr', pathname: '/urunler', search: '?email=private@example.com' },
    localStorage: { removeItem: vi.fn() }, sessionStorage: { removeItem: vi.fn() },
  }
  const document = {
    referrer: 'https://www.hanuja.com.tr/siparis/private-order?token=secret',
    querySelector: (selector: string) => elements.find((element) => selector.includes(`"${element.dataset['consentScript']}"`)),
    createElement: () => ({ dataset: {}, src: '' }),
    head: { appendChild: (element: typeof elements[number]) => elements.push(element) },
  }
  Object.defineProperty(document, 'cookie', { set: (value: string) => deletedCookies.push(value) })
  vi.stubGlobal('window', target)
  vi.stubGlobal('document', document)
  browser = await import('../../apps/web/src/lib/cookie-consent/browser')
})

afterEach(() => vi.unstubAllGlobals())

function commands(): unknown[][] {
  return (target['dataLayer'] ?? []).map((entry: ArrayLike<unknown>) => Array.from(entry))
}

describe('GA4 consent adapter', () => {
  it('never loads the production tag on localhost or preview hosts', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'preview.hanuja.com.tr']) {
      target['location'].hostname = hostname
      browser.injectConsentScript(getConsentScripts()[0]!)
      browser.trackAnalyticsPageView('/')
    }
    expect(elements).toEqual([])
    expect(commands()).toEqual([])
  })

  it('initializes the tag once with advertising disabled and sanitized context', () => {
    const script = getConsentScripts()[0]!
    browser.injectConsentScript(script)
    browser.injectConsentScript(script)
    expect(elements).toHaveLength(1)
    expect(elements[0]?.src).toContain(`id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`)
    expect(commands()).toContainEqual(['consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    }])
    expect(commands()).toContainEqual(['config', GOOGLE_ANALYTICS_MEASUREMENT_ID, expect.objectContaining({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_domain: 'none',
    })])
    expect(commands()).toContainEqual(['set', expect.objectContaining({
      page_location: 'https://www.hanuja.com.tr/urunler', page_referrer: 'https://www.hanuja.com.tr/siparis',
    })])
  })

  it('counts navigation once and does not include query strings or private record IDs', () => {
    browser.injectConsentScript(getConsentScripts()[0]!)
    browser.trackAnalyticsPageView('/urunler?email=private@example.com#secret')
    browser.trackAnalyticsPageView('/urunler')
    browser.trackAnalyticsPageView('/siparis/private-order/destek/private-ticket')
    const views = commands().filter((command) => command[0] === 'event')
    expect(views).toHaveLength(2)
    expect(views[1]?.[2]).toMatchObject({
      page_location: 'https://www.hanuja.com.tr/siparis', page_referrer: 'https://www.hanuja.com.tr/urunler',
    })
    expect(JSON.stringify(commands())).not.toMatch(/private-order|private-ticket|private@example|token=|#secret/)
  })

  it('disables collection immediately and clears both GA cookies on withdrawal', () => {
    const script = getConsentScripts()[0]!
    browser.injectConsentScript(script)
    browser.trackAnalyticsPageView('/')
    browser.applyWithdrawalCleanup({ cookies: [...script.cleanup.cookies], storageKeys: [], scriptIds: [script.id] })
    browser.trackAnalyticsPageView('/urunler')
    expect(target[`ga-disable-${GOOGLE_ANALYTICS_MEASUREMENT_ID}`]).toBe(true)
    expect(commands().filter((command) => command[0] === 'event')).toHaveLength(1)
    for (const name of ['_ga', '_ga_79EPBQSRW2']) {
      expect(deletedCookies).toContain(`${name}=; Max-Age=0; path=/`)
      expect(deletedCookies).toContain(`${name}=; Max-Age=0; path=/; domain=.hanuja.com.tr`)
    }
  })
})

describe('analytics URL sanitization', () => {
  it('preserves catalog paths and strips sensitive areas and parameters', () => {
    expect(analyticsPagePath('/urun/masa?email=a@b.com#fragment')).toBe('/urun/masa')
    expect(analyticsPagePath('/hesabim/sorularim/secret-id')).toBe('/hesabim')
    expect(analyticsPagePath('/sifre-sifirla?token=secret')).toBe('/sifre-sifirla')
  })
})
