/**
 * Seller sessions must end when the browser session ends. Better Auth omits
 * Max-Age from its auth cookies when rememberMe is false.
 */
export const sellerSignInSessionPolicy = {
  rememberMe: false,
} as const
