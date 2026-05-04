/**
 * Data masking utilities for sensitive values.
 * Use these whenever sensitive data is logged, displayed in admin UI,
 * or returned in API responses where full exposure is unnecessary.
 */

// ── IBAN ──────────────────────────────────────────────────────────────────────

/**
 * Masks an IBAN showing only the country code and last 4 digits.
 * TR330006100519786457841326 → TR** **** **** **** **** **41 26
 */
export function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '')
  if (clean.length < 6) return '****'
  const country = clean.slice(0, 2)
  const last4 = clean.slice(-4)
  const middleLen = clean.length - 6
  const masked = Array(Math.ceil(middleLen / 4))
    .fill('****')
    .join(' ')
  return `${country}** ${masked} ${last4}`
}

// ── Email ─────────────────────────────────────────────────────────────────────

/**
 * Masks an email showing first 2 chars + domain.
 * ahmet.yilmaz@example.com → ah***@example.com
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***@***.***'
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

// ── Customer name ─────────────────────────────────────────────────────────────

/**
 * Masks a customer name to first name + last name initial.
 * Used in seller-facing surfaces so sellers cannot collect full identity.
 * "Ahmet Yılmaz" → "Ahmet Y."
 * "Ali Veli Doğan" → "Ali D." (last token's initial)
 * "Ahmet" → "Ahmet"
 */
export function maskCustomerName(name: string | null | undefined): string {
  if (!name) return '-'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '-'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0] ?? '-'
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  const initial = last.charAt(0).toUpperCase()
  return `${first} ${initial}.`
}

// ── Phone ─────────────────────────────────────────────────────────────────────

/**
 * Masks a phone number showing last 2 digits.
 * 05321234567 → 0532 *** ** 67
 */
export function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '')
  if (clean.length < 4) return '****'
  const last2 = clean.slice(-2)
  return `${clean.slice(0, 4)} *** ** ${last2}`
}

// ── Card number ───────────────────────────────────────────────────────────────

/**
 * Masks a card number showing only last 4 digits.
 * 4111111111111111 → **** **** **** 1111
 */
export function maskCardNumber(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, '')
  if (clean.length < 4) return '**** **** **** ****'
  const last4 = clean.slice(-4)
  return `**** **** **** ${last4}`
}

// ── Turkish ID ────────────────────────────────────────────────────────────────

/**
 * Masks a Turkish national ID showing first 2 and last 2 digits.
 * 12345678901 → 12*******01
 */
export function maskTurkishId(id: string): string {
  if (id.length !== 11) return '***********'
  return `${id.slice(0, 2)}*******${id.slice(-2)}`
}

// ── Generic string ────────────────────────────────────────────────────────────

/**
 * Generic partial masking — keeps first `visibleStart` and last `visibleEnd` chars.
 */
export function maskPartial(
  value: string,
  visibleStart = 2,
  visibleEnd = 2,
): string {
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length)
  }
  const start = value.slice(0, visibleStart)
  const end = value.slice(-visibleEnd)
  const masked = '*'.repeat(value.length - visibleStart - visibleEnd)
  return `${start}${masked}${end}`
}

// ── Object-level masker ───────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'iban',
  'accountNumber',
  'cardNumber',
  'password',
  'token',
  'secret',
  'apiKey',
  'privateKey',
  'cvv',
  'pin',
])

/**
 * Recursively masks sensitive keys in a plain object (for logging).
 * Does not mutate the original.
 */
export function maskSensitiveObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[MASKED]'
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskSensitiveObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
