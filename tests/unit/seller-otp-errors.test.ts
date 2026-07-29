import { describe, expect, it } from 'vitest'
import {
  getSellerOtpErrorMessage,
  isSellerOtpChallengeError,
} from '../../apps/seller-panel/src/lib/seller-otp-errors'

describe('seller OTP error messages', () => {
  it('returns to sign-in for an invalid or expired challenge', () => {
    const error = { code: 'INVALID_TWO_FACTOR_COOKIE', status: 401 }

    expect(isSellerOtpChallengeError(error)).toBe(true)
    expect(getSellerOtpErrorMessage('send', error)).toEqual({
      message: 'Doğrulama oturumunuz sona erdi. Lütfen tekrar giriş yapın.',
      challengeExpired: true,
    })
  })

  it('distinguishes the resend cooldown from the hourly send limit', () => {
    expect(
      getSellerOtpErrorMessage('send', {
        status: 429,
        message: 'Yeni kod istemek için 60 saniye bekleyin.',
      }).message,
    ).toBe('Yeni kod istemek için 60 saniye bekleyin.')

    expect(
      getSellerOtpErrorMessage('send', {
        status: 429,
        message: 'Saatlik kod gönderim limitine ulaştınız.',
      }).message,
    ).toBe(
      'Saatlik kod gönderim limitine ulaştınız. Lütfen daha sonra tekrar deneyin.',
    )
  })

  it.each([
    ['INVALID_CODE', 'Girdiğiniz kod hatalı.'],
    ['OTP_HAS_EXPIRED', 'Kodun süresi doldu. Lütfen yeni kod isteyin.'],
    [
      'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      'Bu kod için deneme hakkınız doldu. Lütfen yeni kod isteyin.',
    ],
  ])('maps %s without leaking server details', (code, expected) => {
    expect(
      getSellerOtpErrorMessage('verify', {
        code,
        message: 'sensitive-internal-detail',
      }).message,
    ).toBe(expected)
  })

  it('uses a generic message for an unknown server error', () => {
    expect(
      getSellerOtpErrorMessage('verify', {
        status: 500,
        message: 'database host and stack trace',
      }).message,
    ).toBe('Kod doğrulanamadı. Lütfen tekrar deneyin.')
  })
})
