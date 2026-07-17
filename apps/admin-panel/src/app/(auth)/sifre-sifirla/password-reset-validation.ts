export const MIN_ADMIN_PASSWORD_LENGTH = 8

type ResetPasswordInput = {
  token: string
  password: string
  confirmPassword: string
}

export function getResetPasswordValidationError({
  token,
  password,
  confirmPassword,
}: ResetPasswordInput): string | null {
  if (!token) {
    return 'Şifre sıfırlama bağlantısı eksik veya hatalı.'
  }

  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `Şifre en az ${MIN_ADMIN_PASSWORD_LENGTH} karakter olmalıdır.`
  }

  if (password !== confirmPassword) {
    return 'Şifreler eşleşmiyor.'
  }

  return null
}

export const INVALID_RESET_LINK_MESSAGE =
  'Şifre sıfırlanamadı. Bağlantının süresi dolmuş, geçersiz veya daha önce kullanılmış olabilir.'
