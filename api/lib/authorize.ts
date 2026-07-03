/**
 * Route-level authorization bridge.
 *
 * The permission matrix in @hanuja/security is the single source of truth for
 * "which role may perform which action". Its `assertCan` throws a
 * `PermissionDeniedError` that extends plain `Error`, so `handleError` would map
 * it to a 500. This helper wraps `assertCan` and rethrows a `ForbiddenError`
 * (a DomainError with statusCode 403) so the existing route error handler maps
 * it to a proper 403 response.
 *
 * Behaviour today is identical to the previous inline `role !== 'admin'` checks
 * for admin routes. The value is future-proofing: when finance / support role
 * separation is turned on, only the matrix data changes — the routes already
 * enforce the correct action-level permission.
 *
 * 05-security-rules.md, docs/05-security/admin-action-policy.md
 */
import { assertCan, type Action, type UserRole, PermissionDeniedError } from '@hanuja/security'
import { ForbiddenError } from './errors'

/**
 * Asserts that `role` may perform `action`, mapping a matrix denial to a 403.
 * Throws `ForbiddenError` (403) when the role lacks the permission.
 */
export function assertRoleCan(role: string, action: Action): void {
  try {
    assertCan(role as UserRole, action)
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      throw new ForbiddenError()
    }
    throw err
  }
}
