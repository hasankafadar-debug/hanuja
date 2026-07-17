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
const TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

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

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
    })

    if (options.ip) {
      body.set('remoteip', options.ip)
    }

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // Next.js fetch cache genişletmesi — Node tipi RequestInit'te yok
      ...({ cache: 'no-store' } as RequestInit),
    })

    if (!response.ok) {
      return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
    }

    const payload = (await response.json()) as TurnstileSiteVerifyResponse
    if (!payload.success) {
      return { success: false, message: 'Lutfen insan dogrulamasini tamamlayin.' }
    }

    if (options.action && payload.action !== options.action) {
      return { success: false, message: 'Insan dogrulamasi gecersiz gorunuyor.' }
    }

    return { success: true }
  } catch (error) {
    console.error('[turnstile] verification failed', error)
    return { success: false, message: 'Insan dogrulamasi su anda dogrulanamadi.' }
  }
}
