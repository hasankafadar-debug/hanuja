import { randomUUID } from 'node:crypto'

interface VerifyTurnstileTokenOptions {
  action?: string
  ip?: string | null
  token: string
}

interface TurnstileSiteVerifyResponse {
  action?: string
  'error-codes'?: string[]
  success: boolean
}

const DEV_BYPASS_TOKEN = 'dev-turnstile-bypass'
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5_000
const RETRY_DELAY_MS = 250
const MAX_ATTEMPTS = 2
const TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function getSafeErrorClass(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'

  const cause = (error as Error & { cause?: unknown }).cause
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : undefined

  if (error.name === 'TimeoutError' || causeCode === 'ETIMEDOUT') return 'timeout'
  return error.name || 'Error'
}

function waitBeforeRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
}

export async function verifyTurnstileToken(
  options: VerifyTurnstileTokenOptions,
): Promise<{ message?: string; success: boolean }> {
  const token = options.token.trim()

  if (!token) {
    return { success: false, message: 'Lutfen insan dogrulamasini tamamlayin.' }
  }

  const secretKey = process.env['TURNSTILE_SECRET_KEY']

  if (!secretKey) {
    if (process.env.NODE_ENV === 'production') {
      return { success: false, message: 'Insan dogrulama servisi hazir degil.' }
    }

    if (token === DEV_BYPASS_TOKEN) {
      console.warn('[turnstile] TURNSTILE_SECRET_KEY missing; using development bypass token.')
      return { success: true }
    }

    return {
      success: false,
      message: 'Insan dogrulamasi su anda kullanilamiyor.',
    }
  }

  if (process.env.NODE_ENV === 'production' && TEST_SECRET_KEYS.has(secretKey)) {
    console.error('[turnstile] Cloudflare test secret key is not allowed in production.')
    return { success: false, message: 'Insan dogrulama servisi hazir degil.' }
  }

  const idempotencyKey = randomUUID()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
      idempotency_key: idempotencyKey,
    })

    if (options.ip) {
      body.set('remoteip', options.ip)
    }

    let response: Response
    try {
      response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        // Next.js fetch cache genişletmesi — Node tipi RequestInit'te yok
        ...({ cache: 'no-store' } as RequestInit),
      })
    } catch (error) {
      const errorClass = getSafeErrorClass(error)
      console.warn('[turnstile] verification attempt failed', {
        attempt,
        errorClass,
        maxAttempts: MAX_ATTEMPTS,
      })

      if (attempt < MAX_ATTEMPTS) {
        await waitBeforeRetry()
        continue
      }

      return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
    }

    if (!response.ok) {
      if (isRetriableStatus(response.status)) {
        console.warn('[turnstile] verification attempt received retriable response', {
          attempt,
          errorClass: response.status === 429 ? 'rate_limited' : 'server_error',
          maxAttempts: MAX_ATTEMPTS,
          status: response.status,
        })

        if (attempt < MAX_ATTEMPTS) {
          await waitBeforeRetry()
          continue
        }
      }

      return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
    }

    let payload: TurnstileSiteVerifyResponse
    try {
      payload = (await response.json()) as TurnstileSiteVerifyResponse
    } catch (error) {
      console.error('[turnstile] verification returned an invalid response', {
        attempt,
        errorClass: getSafeErrorClass(error),
      })
      return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
    }

    if (!payload.success) {
      return { success: false, message: 'Lutfen insan dogrulamasini tamamlayin.' }
    }

    if (options.action && payload.action !== options.action) {
      return { success: false, message: 'Insan dogrulamasi gecersiz gorunuyor.' }
    }

    return { success: true }
  }

  return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
}
