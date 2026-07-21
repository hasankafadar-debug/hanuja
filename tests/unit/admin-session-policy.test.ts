import { describe, expect, it } from 'vitest'
import { adminSignInSessionPolicy } from '../../apps/admin-panel/src/lib/admin-session-policy'
import { sellerSignInSessionPolicy } from '../../apps/seller-panel/src/lib/seller-session-policy'

describe('admin session policy', () => {
  it('creates a browser-session-only admin login', () => {
    expect(adminSignInSessionPolicy).toEqual({ rememberMe: false })
  })

  it('creates a browser-session-only seller login', () => {
    expect(sellerSignInSessionPolicy).toEqual({ rememberMe: false })
  })
})
