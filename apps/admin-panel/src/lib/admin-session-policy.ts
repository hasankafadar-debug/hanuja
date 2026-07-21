/**
 * Admin sessions must end when the browser session ends.  Better Auth turns
 * this into a session cookie by omitting Max-Age from both auth cookies.
 */
export const adminSignInSessionPolicy = {
  rememberMe: false,
} as const
