import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

export type TurnstileFailureReason =
  | 'required'
  | 'invalid'
  | 'expired_or_duplicate'
  | 'action_mismatch'
  | 'provider_unavailable'
  | 'misconfigured'

export type TurnstileVerificationResult =
  | { success: true }
  | {
      message: string
      reason: TurnstileFailureReason
      success: false
    }

export interface TurnstileFailureContract {
  body: {
    code:
      | 'TURNSTILE_REQUIRED'
      | 'TURNSTILE_INVALID'
      | 'TURNSTILE_UNAVAILABLE'
      | 'TURNSTILE_MISCONFIGURED'
    message: string
  }
  status: 400 | 403 | 503
}

interface VerifyTurnstileTokenOptions {
  action?: string
  ip?: string | null
  surface: string
  token: string
}

interface TurnstileSiteVerifyResponse {
  action?: string
  'error-codes'?: string[]
  success: boolean
}

const DEV_BYPASS_TOKEN = 'dev-turnstile-bypass'
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 4_000
const RETRY_DELAYS_MS = [250, 500] as const
const MAX_ATTEMPTS = 3
const TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

const FAILURE_MESSAGES: Record<TurnstileFailureReason, string> = {
  required: 'Lutfen insan dogrulamasini tamamlayin.',
  invalid: 'Insan dogrulamasi gecersiz gorunuyor. Lutfen tekrar deneyin.',
  expired_or_duplicate:
    'Insan dogrulamasinin suresi dolmus veya daha once kullanilmis. Lutfen tekrar tamamlayin.',
  action_mismatch: 'Insan dogrulamasi bu islem icin gecersiz gorunuyor.',
  provider_unavailable:
    'Insan dogrulama hizmetine su anda ulasilamiyor. Lutfen biraz sonra tekrar deneyin.',
  misconfigured: 'Insan dogrulama servisi hazir degil.',
}

function failure(reason: TurnstileFailureReason): TurnstileVerificationResult {
  return { success: false, reason, message: FAILURE_MESSAGES[reason] }
}

export function getTurnstileFailureContract(
  result: Extract<TurnstileVerificationResult, { success: false }>,
): TurnstileFailureContract {
  if (result.reason === 'required') {
    return {
      status: 400,
      body: { code: 'TURNSTILE_REQUIRED', message: result.message },
    }
  }

  if (result.reason === 'provider_unavailable') {
    return {
      status: 503,
      body: { code: 'TURNSTILE_UNAVAILABLE', message: result.message },
    }
  }

  if (result.reason === 'misconfigured') {
    return {
      status: 503,
      body: { code: 'TURNSTILE_MISCONFIGURED', message: result.message },
    }
  }

  return {
    status: 403,
    body: { code: 'TURNSTILE_INVALID', message: result.message },
  }
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

type IpFamily = 'IPv4' | 'IPv6' | 'mixed' | 'unknown'

function getNetworkErrorDetails(error: unknown): {
  ipFamily: IpFamily
  networkErrorClass: string
} {
  const queue: unknown[] = [error]
  const seen = new Set<unknown>()
  const codes = new Set<string>()
  const families = new Set<'IPv4' | 'IPv6'>()
  let rootName = 'unknown'

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    if (current instanceof Error && rootName === 'unknown') {
      rootName = current.name || 'Error'
    }

    if (typeof current !== 'object') continue

    const record = current as {
      address?: unknown
      cause?: unknown
      code?: unknown
      errors?: unknown
      family?: unknown
    }

    if (typeof record.code === 'string') codes.add(record.code)

    if (record.family === 4 || record.family === 'IPv4') families.add('IPv4')
    if (record.family === 6 || record.family === 'IPv6') families.add('IPv6')

    if (typeof record.address === 'string') {
      const detectedFamily = isIP(record.address)
      if (detectedFamily === 4) families.add('IPv4')
      if (detectedFamily === 6) families.add('IPv6')
    }

    if (record.cause) queue.push(record.cause)
    if (Array.isArray(record.errors)) queue.push(...record.errors)
  }

  const networkErrorClass =
    rootName === 'TimeoutError' || codes.has('ETIMEDOUT')
      ? 'ETIMEDOUT'
      : (Array.from(codes)[0] ?? rootName)
  const ipFamily: IpFamily =
    families.size > 1
      ? 'mixed'
      : families.has('IPv6')
        ? 'IPv6'
        : families.has('IPv4')
          ? 'IPv4'
          : 'unknown'

  return { ipFamily, networkErrorClass }
}

function getCfRay(response: Response): string | null {
  return response.headers?.get?.('cf-ray') ?? null
}

function waitBeforeRetry(attempt: number): Promise<void> {
  const delay = RETRY_DELAYS_MS[attempt - 1]
  return delay ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve()
}

function classifyCloudflareFailure(errorCodes: string[]): TurnstileFailureReason {
  if (errorCodes.includes('timeout-or-duplicate')) return 'expired_or_duplicate'
  if (errorCodes.includes('missing-input-response')) return 'required'
  if (errorCodes.includes('missing-input-secret') || errorCodes.includes('invalid-input-secret')) {
    return 'misconfigured'
  }
  return 'invalid'
}

export async function verifyTurnstileToken(
  options: VerifyTurnstileTokenOptions,
): Promise<TurnstileVerificationResult> {
  const token = options.token.trim()

  if (!token) return failure('required')

  const secretKey = process.env['TURNSTILE_SECRET_KEY']

  if (!secretKey) {
    if (process.env.NODE_ENV !== 'production' && token === DEV_BYPASS_TOKEN) {
      console.warn('[turnstile] TURNSTILE_SECRET_KEY missing; using development bypass token.', {
        action: options.action ?? null,
        surface: options.surface,
      })
      return { success: true }
    }

    console.error('[turnstile] verification is misconfigured', {
      action: options.action ?? null,
      surface: options.surface,
    })
    return failure('misconfigured')
  }

  if (process.env.NODE_ENV === 'production' && TEST_SECRET_KEYS.has(secretKey)) {
    console.error('[turnstile] Cloudflare test secret key is not allowed in production.', {
      action: options.action ?? null,
      surface: options.surface,
    })
    return failure('misconfigured')
  }

  const idempotencyKey = randomUUID()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
      idempotency_key: idempotencyKey,
    })

    if (options.ip) body.set('remoteip', options.ip)

    const startedAt = Date.now()
    let response: Response

    try {
      response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        // Next.js fetch cache extension is not part of the Node RequestInit type.
        ...({ cache: 'no-store' } as RequestInit),
      })
    } catch (error) {
      const details = getNetworkErrorDetails(error)
      console.warn('[turnstile] verification attempt failed', {
        action: options.action ?? null,
        attempt,
        durationMs: Date.now() - startedAt,
        ipFamily: details.ipFamily,
        maxAttempts: MAX_ATTEMPTS,
        networkErrorClass: details.networkErrorClass,
        surface: options.surface,
      })

      if (attempt < MAX_ATTEMPTS) {
        await waitBeforeRetry(attempt)
        continue
      }

      return failure('provider_unavailable')
    }

    const durationMs = Date.now() - startedAt
    const cfRay = getCfRay(response)

    if (!response.ok) {
      const retriable = isRetriableStatus(response.status)
      console.warn('[turnstile] verification received an HTTP error', {
        action: options.action ?? null,
        attempt,
        cfRay,
        durationMs,
        maxAttempts: MAX_ATTEMPTS,
        status: response.status,
        surface: options.surface,
      })

      if (retriable && attempt < MAX_ATTEMPTS) {
        await waitBeforeRetry(attempt)
        continue
      }

      return failure(retriable ? 'provider_unavailable' : 'invalid')
    }

    let payload: TurnstileSiteVerifyResponse
    try {
      payload = (await response.json()) as TurnstileSiteVerifyResponse
    } catch (error) {
      console.error('[turnstile] verification returned an invalid response', {
        action: options.action ?? null,
        attempt,
        cfRay,
        durationMs,
        networkErrorClass: getNetworkErrorDetails(error).networkErrorClass,
        status: response.status,
        surface: options.surface,
      })
      return failure('provider_unavailable')
    }

    if (!payload.success) {
      const errorCodes = payload['error-codes'] ?? []
      const internalError = errorCodes.includes('internal-error')

      console.warn('[turnstile] verification rejected', {
        action: options.action ?? null,
        attempt,
        cfRay,
        durationMs,
        errorClass: internalError ? 'internal-error' : classifyCloudflareFailure(errorCodes),
        status: response.status,
        surface: options.surface,
      })

      if (internalError && attempt < MAX_ATTEMPTS) {
        await waitBeforeRetry(attempt)
        continue
      }

      return failure(internalError ? 'provider_unavailable' : classifyCloudflareFailure(errorCodes))
    }

    if (options.action && payload.action !== options.action) {
      console.warn('[turnstile] verification action mismatch', {
        action: options.action,
        attempt,
        cfRay,
        durationMs,
        status: response.status,
        surface: options.surface,
      })
      return failure('action_mismatch')
    }

    console.info('[turnstile] verification succeeded', {
      action: options.action ?? null,
      attempt,
      cfRay,
      durationMs,
      status: response.status,
      surface: options.surface,
    })
    return { success: true }
  }

  return failure('provider_unavailable')
}
