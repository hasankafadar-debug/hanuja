import { describe, expect, it } from 'vitest'
import { isPublicPath } from '../../apps/seller-panel/src/middleware'
import {
  canSubmitSellerApplication,
  resolveSellerApplicationState,
} from '../../apps/seller-panel/src/lib/onboarding'

describe('seller application route access', () => {
  it('exposes only the application entry, not its protected sub-routes', () => {
    expect(isPublicPath('/basvuru')).toBe(true)
    expect(isPublicPath('/basvuru/tesekkur')).toBe(true)
    expect(isPublicPath('/basvuru/belgeler')).toBe(false)
    expect(isPublicPath('/basvuru/belgeler/kimlik')).toBe(false)
  })

  it('keeps auth pages and API handlers public without prefix-matching page names', () => {
    expect(isPublicPath('/giris')).toBe(true)
    expect(isPublicPath('/giris/yanlis-alt-yol')).toBe(false)
    expect(isPublicPath('/api/auth/get-session')).toBe(true)
  })
})

describe('seller application state', () => {
  it('allows only customer accounts to submit an application', () => {
    expect(canSubmitSellerApplication('customer')).toBe(true)
    expect(canSubmitSellerApplication('seller')).toBe(false)
    expect(canSubmitSellerApplication('admin')).toBe(false)
  })

  it.each([
    ['customer', null, 'form'],
    ['customer', 'pending', 'pending'],
    ['seller', 'rejected', 'rejected'],
    ['seller', 'active', 'panel'],
    ['seller', 'suspended', 'panel'],
    ['admin', null, 'ineligible'],
    ['seller', null, 'ineligible'],
  ])('resolves role %s and status %s to %s', (role, status, expected) => {
    expect(resolveSellerApplicationState(role, status)).toBe(expected)
  })
})
