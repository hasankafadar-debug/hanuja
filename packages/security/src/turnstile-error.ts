export interface TurnstileClientError {
  code?: string | undefined
  message?: string | undefined
  status?: number | undefined
}

const TURNSTILE_MESSAGES: Record<string, string> = {
  TURNSTILE_REQUIRED: 'Lütfen önce güvenlik doğrulamasını tamamlayın.',
  TURNSTILE_INVALID: 'Güvenlik doğrulaması geçersiz veya süresi dolmuş. Lütfen tekrar tamamlayın.',
  TURNSTILE_UNAVAILABLE:
    'Güvenlik doğrulama hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.',
  TURNSTILE_MISCONFIGURED: 'Güvenlik doğrulama hizmeti şu anda hazır değil.',
}

export function getTurnstileClientErrorMessage(
  error: TurnstileClientError | null | undefined,
): string | null {
  if (!error?.code) return null
  return TURNSTILE_MESSAGES[error.code.toUpperCase()] ?? null
}

export function isDatabaseUnavailableError(
  error: TurnstileClientError | null | undefined,
): boolean {
  return error?.code?.toUpperCase() === 'DATABASE_UNAVAILABLE'
}
