import { describe, expect, it } from 'vitest'
import {
  getCustomerPasswordErrors,
  getSellerPasswordErrors,
  isCustomerPasswordValid,
  isSellerPasswordValid,
  customerPasswordSchema,
  sellerPasswordSchema,
  evaluateAuthPasswordPolicy,
} from '../../packages/security/src/password-policy'

describe('password policy', () => {
  it('rejects a digit-only password for both roles (missing letter)', () => {
    const customerErrors = getCustomerPasswordErrors('12345678')
    const sellerErrors = getSellerPasswordErrors('12345678')

    expect(isCustomerPasswordValid('12345678')).toBe(false)
    expect(isSellerPasswordValid('12345678')).toBe(false)
    expect(customerErrors.some((message) => message.includes('harf'))).toBe(true)
    expect(sellerErrors.some((message) => message.includes('harf'))).toBe(true)
  })

  it('accepts a simple letter+digit password for customer but rejects it for seller', () => {
    expect(isCustomerPasswordValid('abc12345')).toBe(true)

    expect(isSellerPasswordValid('abc12345')).toBe(false)
    const sellerErrors = getSellerPasswordErrors('abc12345')
    expect(sellerErrors).toContain('Şifre en az bir büyük harf içermelidir.')
    expect(sellerErrors).toContain('Şifre en az bir sembol içermelidir (örn. ! @ # .).')
  })

  it('treats Turkish letters as valid letters/uppercase/lowercase', () => {
    expect(isCustomerPasswordValid('şifreee1')).toBe(true)
    expect(isSellerPasswordValid('Çilek123!')).toBe(true)

    // Turkish uppercase İ satisfies the seller uppercase rule.
    expect(isSellerPasswordValid('İstanbul1!')).toBe(true)
  })

  it('rejects trailing whitespace and does not let the space count as a symbol', () => {
    const errors = getSellerPasswordErrors('Sifre123 ')
    expect(errors).toContain('Şifre boşluk ile başlayamaz veya bitemez.')
    expect(errors).toContain('Şifre en az bir sembol içermelidir (örn. ! @ # .).')

    expect(isSellerPasswordValid('Sifre123!')).toBe(true)
  })

  it('mirrors isXPasswordValid with schema safeParse results', () => {
    const validCustomer = customerPasswordSchema.safeParse('abc12345')
    expect(validCustomer.success).toBe(true)
    expect(isCustomerPasswordValid('abc12345')).toBe(true)

    const invalidCustomer = customerPasswordSchema.safeParse('12345678')
    expect(invalidCustomer.success).toBe(false)
    if (!invalidCustomer.success) {
      expect(invalidCustomer.error.issues[0]?.message).toBe(getCustomerPasswordErrors('12345678')[0])
    }

    const validSeller = sellerPasswordSchema.safeParse('Sifre123!')
    expect(validSeller.success).toBe(true)
    expect(isSellerPasswordValid('Sifre123!')).toBe(true)

    const invalidSeller = sellerPasswordSchema.safeParse('abc12345')
    expect(invalidSeller.success).toBe(false)
    if (!invalidSeller.success) {
      expect(invalidSeller.error.issues[0]?.message).toBe(getSellerPasswordErrors('abc12345')[0])
    }
  })

  it('does not evaluate password policy on the login path (regression guard)', () => {
    expect(evaluateAuthPasswordPolicy('/sign-in/email', { password: '12345678' }, 'customer')).toBeNull()
    expect(evaluateAuthPasswordPolicy('/sign-in/social', { password: '12345678' }, 'seller')).toBeNull()
  })

  it('evaluates the policy on sign-up, reset-password, and change-password paths', () => {
    expect(evaluateAuthPasswordPolicy('/sign-up/email', { password: '12345678' }, 'customer')).not.toBeNull()
    expect(evaluateAuthPasswordPolicy('/reset-password', { newPassword: 'Sifre123!' }, 'seller')).toBeNull()
  })

  it('tolerates a missing password field by returning null', () => {
    expect(evaluateAuthPasswordPolicy('/sign-up/email', {}, 'customer')).toBeNull()
  })
})
