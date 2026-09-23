/**
 * Read receipt for a conversation screen (product questions, customer and
 * seller panels). Sends "the last message shown" once and retries only
 * transient failures (network error, 429, 5xx) a bounded number of times with a
 * growing delay; a successful response is never sent again, and a client
 * error (400/401/403/404…) is not retried. Nothing is sent while the page is
 * hidden — the attempt waits until it becomes visible.
 *
 * Framework-free so the retry policy is unit-testable; components pass in the
 * request, the visibility source and (optionally) the scheduler.
 */

export interface ReadReceiptOptions {
  /** Performs the POST; resolves with the response or rejects on a network error. */
  send: () => Promise<Response>
  /** Called once when the server reports that the read boundary moved forward. */
  onAdvanced?: () => void
  isVisible: () => boolean
  /** Subscribes to visibility changes; returns an unsubscribe function. */
  onVisibilityChange: (listener: () => void) => () => void
  /** Returns a cancel function. Defaults to setTimeout. */
  schedule?: (callback: () => void, delayMs: number) => () => void
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number
  /** Delay before the second attempt; grows ×3 per attempt. Default 1000 ms. */
  baseDelayMs?: number
  /** Upper bound for any delay, including Retry-After. Default 30000 ms. */
  maxDelayMs?: number
}

export type ReadReceiptOutcome = 'pending' | 'sent' | 'rejected' | 'gave_up' | 'cancelled'

export interface ReadReceiptHandle {
  cancel: () => void
  outcome: () => ReadReceiptOutcome
}

function defaultSchedule(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

function isTransient(status: number) {
  return status === 429 || status >= 500
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

export function startReadReceipt(options: ReadReceiptOptions): ReadReceiptHandle {
  const schedule = options.schedule ?? defaultSchedule
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxDelayMs = options.maxDelayMs ?? 30_000

  let outcome: ReadReceiptOutcome = 'pending'
  let attempts = 0
  let inFlight = false
  let waitingForVisibility = false
  let cancelTimer: (() => void) | null = null

  const unsubscribe = options.onVisibilityChange(() => {
    if (waitingForVisibility && options.isVisible()) void attempt()
  })

  function finish(result: ReadReceiptOutcome) {
    outcome = result
    cancelTimer?.()
    cancelTimer = null
    unsubscribe()
  }

  function retryLater(response: Response | null) {
    const backoff = baseDelayMs * 3 ** (attempts - 1)
    const requested = response ? retryAfterMs(response) : null
    const delay = Math.min(maxDelayMs, requested ?? backoff)
    cancelTimer = schedule(() => {
      cancelTimer = null
      void attempt()
    }, delay)
  }

  async function attempt(): Promise<void> {
    if (outcome !== 'pending' || inFlight || cancelTimer) return
    if (!options.isVisible()) {
      waitingForVisibility = true
      return
    }
    waitingForVisibility = false
    inFlight = true
    attempts += 1
    let response: Response | null = null
    try {
      response = await options.send()
    } catch {
      response = null
    }
    inFlight = false
    if (outcome !== 'pending') return

    if (response?.ok) {
      finish('sent')
      const payload = (await response.json().catch(() => null)) as {
        data?: { advanced?: boolean }
      } | null
      if (payload?.data?.advanced) options.onAdvanced?.()
      return
    }
    if (response && !isTransient(response.status)) {
      finish('rejected')
      return
    }
    if (attempts >= maxAttempts) {
      finish('gave_up')
      return
    }
    retryLater(response)
  }

  void attempt()

  return {
    cancel: () => {
      if (outcome === 'pending') finish('cancelled')
    },
    outcome: () => outcome,
  }
}
