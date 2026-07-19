/**
 * Shared password policy — customer and seller auth surfaces.
 *
 * Pure, client-bundle-safe module (only depends on `zod`). Used by:
 * - client-side form validation (apps/web, apps/seller-panel)
 * - server-side Better Auth `hooks.before` enforcement (apps/web/src/lib/auth.ts,
 *   apps/seller-panel/src/lib/auth.ts) via `evaluateAuthPasswordPolicy`
 *
 * Unicode-aware (`\p{...}` with the `u` flag) so Turkish letters (ş, Ç, ğ, İ, ı, ö, ü…)
 * count as letters/uppercase/lowercase correctly.
 *
 * Do not add Node-only imports here — this file is imported by client components.
 */
import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

const LETTER_PATTERN = /\p{L}/u
const UPPERCASE_PATTERN = /\p{Lu}/u
const LOWERCASE_PATTERN = /\p{Ll}/u
const DIGIT_PATTERN = /\p{N}/u
const SYMBOL_PATTERN = /[^\p{L}\p{N}\s]/u

const MESSAGES = {
  min: 'Şifre en az 8 karakter olmalıdır.',
  max: 'Şifre en fazla 128 karakter olabilir.',
  whitespace: 'Şifre boşluk ile başlayamaz veya bitemez.',
  letter: 'Şifre en az bir harf içermelidir.',
  digit: 'Şifre en az bir rakam içermelidir.',
  uppercase: 'Şifre en az bir büyük harf içermelidir.',
  lowercase: 'Şifre en az bir küçük harf içermelidir.',
  symbol: 'Şifre en az bir sembol içermelidir (örn. ! @ # .).',
} as const

function getCommonPasswordErrors(password: string): string[] {
  const errors: string[] = []

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(MESSAGES.min)
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(MESSAGES.max)
  }

  if (password !== password.trim()) {
    errors.push(MESSAGES.whitespace)
  }

  return errors
}

export function getCustomerPasswordErrors(password: string): string[] {
  const errors = getCommonPasswordErrors(password)

  if (!LETTER_PATTERN.test(password)) {
    errors.push(MESSAGES.letter)
  }

  if (!DIGIT_PATTERN.test(password)) {
    errors.push(MESSAGES.digit)
  }

  return errors
}

export function getSellerPasswordErrors(password: string): string[] {
  const errors = getCommonPasswordErrors(password)

  if (!UPPERCASE_PATTERN.test(password)) {
    errors.push(MESSAGES.uppercase)
  }

  if (!LOWERCASE_PATTERN.test(password)) {
    errors.push(MESSAGES.lowercase)
  }

  if (!DIGIT_PATTERN.test(password)) {
    errors.push(MESSAGES.digit)
  }

  if (!SYMBOL_PATTERN.test(password)) {
    errors.push(MESSAGES.symbol)
  }

  return errors
}

export function isCustomerPasswordValid(password: string): boolean {
  return getCustomerPasswordErrors(password).length === 0
}

export function isSellerPasswordValid(password: string): boolean {
  return getSellerPasswordErrors(password).length === 0
}

export const customerPasswordSchema = z.string().superRefine((value, ctx) => {
  const errors = getCustomerPasswordErrors(value)
  if (errors[0]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: errors[0] })
  }
})

export const sellerPasswordSchema = z.string().superRefine((value, ctx) => {
  const errors = getSellerPasswordErrors(value)
  if (errors[0]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: errors[0] })
  }
})

type AuthRole = 'customer' | 'seller'

const PASSWORD_FIELD_BY_PATH: Record<string, string> = {
  '/sign-up/email': 'password',
  '/reset-password': 'newPassword',
  '/change-password': 'newPassword',
}

/**
 * Server-side Better Auth `hooks.before` policy check.
 *
 * Maps a Better Auth endpoint path to its password field and validates it against
 * the role-specific policy. Returns the first violation message, or `null` if the
 * path is not password-relevant, the field is missing/malformed (left to Better
 * Auth's own validation), or the password satisfies the policy.
 *
 * CRITICAL: any path other than sign-up/reset-password/change-password (e.g.
 * `/sign-in/email`, `/sign-in/social`) must return `null` — login must never be
 * blocked by this check.
 */
export function evaluateAuthPasswordPolicy(
  path: string,
  body: unknown,
  role: AuthRole,
): string | null {
  const field = PASSWORD_FIELD_BY_PATH[path]
  if (!field) {
    return null
  }

  if (typeof body !== 'object' || body === null) {
    return null
  }

  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string') {
    return null
  }

  const errors = role === 'seller' ? getSellerPasswordErrors(value) : getCustomerPasswordErrors(value)
  return errors[0] ?? null
}
