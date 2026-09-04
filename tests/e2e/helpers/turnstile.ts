import type { Page } from '@playwright/test'

// Test-only helper:
// This isolates non-critical E2E flows from Cloudflare bot detection and network variability.
// It does not validate real Cloudflare Turnstile widget behavior.
export async function mockTurnstile(
  page: Page,
  token = 'dev-turnstile-bypass',
  delayMs = 60,
) {
  // Both values must travel through the argument object — addInitScript serializes the
  // function, so closure variables are not available in the page context.
  await page.addInitScript(({ mockToken, mockDelayMs }) => {
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
      render: (container, opts) => {
        // Stand in for Cloudflare's iframe at its real minimum footprint (300x65) so layout
        // assertions can catch the widget overflowing a narrower container.
        const stub = document.createElement('div')
        stub.setAttribute('data-turnstile-stub', 'true')
        stub.style.width = '300px'
        stub.style.height = '65px'
        container.appendChild(stub)

        setTimeout(() => opts.callback?.(mockToken), mockDelayMs)
        return 'mock-widget-id'
      },
      remove: () => {},
    }
  }, { mockToken: token, mockDelayMs: delayMs })

  await page.route('**/challenges.cloudflare.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  )
}
