import type { Page } from '@playwright/test'

// Test-only helper:
// This isolates non-critical E2E flows from Cloudflare bot detection and network variability.
// It does not validate real Cloudflare Turnstile widget behavior.
export async function mockTurnstile(page: Page, token = 'playwright-mock-token') {
  await page.addInitScript(({ mockToken }) => {
    ;(
      window as typeof window & {
        __hanujaTurnstileScriptPromise: Promise<void>
        turnstile: {
          render: (
            container: HTMLElement,
            opts: { callback?: (value: string) => void; 'error-callback'?: () => void },
          ) => string
          remove: (id: string) => void
        }
      }
    ).__hanujaTurnstileScriptPromise = Promise.resolve()

    ;(
      window as typeof window & {
        turnstile: {
          render: (
            container: HTMLElement,
            opts: { callback?: (value: string) => void },
          ) => string
          remove: (id: string) => void
        }
      }
    ).turnstile = {
      render: (_container, opts) => {
        setTimeout(() => opts.callback?.(mockToken), 60)
        return 'mock-widget-id'
      },
      remove: () => {},
    }
  }, { mockToken: token })

  await page.route('**/challenges.cloudflare.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  )

  await page.route('**/api/turnstile-verify', (route) =>
    route.fulfill({ json: { ok: true }, status: 200 }),
  )
}
