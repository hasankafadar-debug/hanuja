import { describe, expect, it } from 'vitest'
import { isPublicAdminPath } from '../../apps/admin-panel/src/lib/admin-public-paths'
import {
  getResetPasswordValidationError,
  INVALID_RESET_LINK_MESSAGE,
} from '../../apps/admin-panel/src/app/(auth)/sifre-sifirla/password-reset-validation'

describe('admin public auth paths', () => {
  it.each(['/giris', '/sifremi-unuttum', '/sifre-sifirla'])(
    'allows the exact public route %s',
    (pathname) => {
      expect(isPublicAdminPath(pathname)).toBe(true)
    },
  )

  it.each(['/giris/deneme', '/sifremi-unuttum/deneme', '/sifre-sifirla/deneme', '/dashboard'])(
    'does not allow a protected or nested route %s',
    (pathname) => {
      expect(isPublicAdminPath(pathname)).toBe(false)
    },
  )
})

describe('admin password reset validation', () => {
  it('rejects a missing token', () => {
    expect(
      getResetPasswordValidationError({
        token: '',
        password: 'yeni-sifre',
        confirmPassword: 'yeni-sifre',
      }),
    ).toBe('Şifre sıfırlama bağlantısı eksik veya hatalı.')
  })

  it('requires at least eight characters', () => {
    expect(
      getResetPasswordValidationError({
        token: 'token',
        password: '1234567',
        confirmPassword: '1234567',
      }),
    ).toBe('Şifre en az 8 karakter olmalıdır.')
  })

  it('requires matching passwords', () => {
    expect(
      getResetPasswordValidationError({
        token: 'token',
        password: 'yeni-sifre',
        confirmPassword: 'farkli-sifre',
      }),
    ).toBe('Şifreler eşleşmiyor.')
  })

  it('accepts a valid reset submission', () => {
    expect(
      getResetPasswordValidationError({
        token: 'token',
        password: 'yeni-sifre',
        confirmPassword: 'yeni-sifre',
      }),
    ).toBeNull()
  })

  it('uses one message for expired, invalid, or used links', () => {
    expect(INVALID_RESET_LINK_MESSAGE).toContain('süresi dolmuş')
    expect(INVALID_RESET_LINK_MESSAGE).toContain('geçersiz')
    expect(INVALID_RESET_LINK_MESSAGE).toContain('kullanılmış')
  })
})
