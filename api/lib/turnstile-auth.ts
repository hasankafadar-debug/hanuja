import { getTurnstileFailureContract, verifyTurnstileToken } from './turnstile'

export interface TurnstileAuthRule {
  action: string
  surface: string
}

export type TurnstileAuthRules = Partial<
  Record<'/sign-in/email' | '/sign-up/email', TurnstileAuthRule>
>

const AUTH_PATH_MARKER = '/api/auth'

function getAuthPath(request: Request): string | null {
  const pathname = new URL(request.url).pathname
  const markerIndex = pathname.lastIndexOf(AUTH_PATH_MARKER)
  if (markerIndex < 0) return null

  return pathname.slice(markerIndex + AUTH_PATH_MARKER.length) || '/'
}

/**
 * Verifies Turnstile on the same HTTP request that performs the credential
 * operation. A successful token is therefore not separable from sign-in/up.
 */
export async function verifyTurnstileAuthRequest(
  request: Request,
  rules: TurnstileAuthRules,
): Promise<Response | null> {
  if (request.method !== 'POST') return null

  const authPath = getAuthPath(request)
  if (authPath !== '/sign-in/email' && authPath !== '/sign-up/email') return null

  const rule = rules[authPath]
  if (!rule) return null

  const result = await verifyTurnstileToken({
    action: rule.action,
    surface: rule.surface,
    token: request.headers.get('x-captcha-response') ?? '',
  })

  if (result.success) return null

  const contract = getTurnstileFailureContract(result)
  return Response.json(contract.body, { status: contract.status })
}
