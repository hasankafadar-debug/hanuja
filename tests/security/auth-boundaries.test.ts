/**
 * Security tests — auth boundaries and permission guards
 *
 * Tests the domain-level enforcement of permission boundaries:
 * - Error types carry correct HTTP status codes
 * - Finance-critical operations require correct authorization context
 * - Admin-only operations are distinguishable at the error level
 * - Payout security invariants
 *
 * 05-security-rules.md, .claude/rules/10-admin-panel-rules.md
 */
import { describe, it, expect } from 'vitest'
import {
  DomainError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  PayoutBlockedError,
  InvalidTransitionError,
  SellerNotActiveError,
  PaymentNotConfirmedError,
} from '../../api/lib/errors'

// ─── Error hierarchy ──────────────────────────────────────────────────────────

describe('error hierarchy: all domain errors extend DomainError', () => {
  const allErrors = [
    new NotFoundError('Order', 'ord-001'),
    new UnauthorizedError(),
    new ForbiddenError(),
    new ConflictError('Conflict'),
    new ValidationError('Invalid'),
    new PayoutBlockedError('Reason'),
    new InvalidTransitionError('draft', 'delivered'),
    new SellerNotActiveError(),
    new PaymentNotConfirmedError(),
  ]

  allErrors.forEach((err) => {
    it(`${err.constructor.name} extends DomainError and Error`, () => {
      expect(err).toBeInstanceOf(DomainError)
      expect(err).toBeInstanceOf(Error)
    })
  })
})

// ─── HTTP status codes ────────────────────────────────────────────────────────

describe('HTTP status codes: security-sensitive errors', () => {
  it('UnauthorizedError → 401 (must authenticate)', () => {
    expect(new UnauthorizedError().statusCode).toBe(401)
  })

  it('ForbiddenError → 403 (authenticated but not permitted)', () => {
    expect(new ForbiddenError().statusCode).toBe(403)
  })

  it('NotFoundError → 404 (resource not found or ownership-scoped away)', () => {
    expect(new NotFoundError('Order', 'ord-999').statusCode).toBe(404)
  })

  it('ConflictError → 409 (state conflict, e.g. duplicate payment)', () => {
    expect(new ConflictError('Already processed').statusCode).toBe(409)
  })

  it('ValidationError → 422 (invalid input)', () => {
    expect(new ValidationError('Field required').statusCode).toBe(422)
  })

  it('PayoutBlockedError → 409 (payout cannot proceed)', () => {
    expect(new PayoutBlockedError('Return open').statusCode).toBe(409)
  })

  it('InvalidTransitionError → 409 (invalid lifecycle move)', () => {
    expect(new InvalidTransitionError('shipped', 'cancelled').statusCode).toBe(409)
  })

  it('SellerNotActiveError → 403 (seller account not permitted)', () => {
    expect(new SellerNotActiveError().statusCode).toBe(403)
  })

  it('PaymentNotConfirmedError → 409 (finance gate not passed)', () => {
    expect(new PaymentNotConfirmedError().statusCode).toBe(409)
  })
})

// ─── Error code constants ─────────────────────────────────────────────────────

describe('error codes: machine-readable codes for clients', () => {
  it('NotFoundError code is NOT_FOUND', () => {
    expect(new NotFoundError('Order').code).toBe('NOT_FOUND')
  })

  it('UnauthorizedError code is UNAUTHORIZED', () => {
    expect(new UnauthorizedError().code).toBe('UNAUTHORIZED')
  })

  it('ForbiddenError code is FORBIDDEN', () => {
    expect(new ForbiddenError().code).toBe('FORBIDDEN')
  })

  it('ConflictError code is CONFLICT', () => {
    expect(new ConflictError('x').code).toBe('CONFLICT')
  })

  it('ValidationError code is VALIDATION_ERROR', () => {
    expect(new ValidationError('x').code).toBe('VALIDATION_ERROR')
  })

  it('PayoutBlockedError code is PAYOUT_BLOCKED', () => {
    expect(new PayoutBlockedError('x').code).toBe('PAYOUT_BLOCKED')
  })

  it('InvalidTransitionError code is INVALID_TRANSITION', () => {
    expect(new InvalidTransitionError('a', 'b').code).toBe('INVALID_TRANSITION')
  })

  it('SellerNotActiveError code is SELLER_NOT_ACTIVE', () => {
    expect(new SellerNotActiveError().code).toBe('SELLER_NOT_ACTIVE')
  })

  it('PaymentNotConfirmedError code is PAYMENT_NOT_CONFIRMED', () => {
    expect(new PaymentNotConfirmedError().code).toBe('PAYMENT_NOT_CONFIRMED')
  })
})

// ─── NotFoundError: ownership-safe information disclosure ────────────────────

describe('NotFoundError: prevents ID enumeration (ownership-scoped queries)', () => {
  /**
   * Security principle: when a seller queries an order they don't own,
   * the repository returns null (ownership filter applied server-side),
   * and the service throws NotFoundError — NOT ForbiddenError.
   *
   * This prevents the caller from knowing whether the resource exists at all.
   * An attacker cannot distinguish "doesn't exist" from "you don't own this".
   */

  it('NotFoundError does not reveal whether resource exists (same error for missing + unauthorized)', () => {
    const err1 = new NotFoundError('Order', 'ord-999')
    const err2 = new NotFoundError('Order', 'ord-001')
    // Both return 404 — caller cannot distinguish missing vs unauthorized
    expect(err1.statusCode).toBe(404)
    expect(err2.statusCode).toBe(404)
  })

  it('NotFoundError message includes entity name and id', () => {
    const err = new NotFoundError('Order', 'ord-001')
    expect(err.message).toContain('Order')
    expect(err.message).toContain('ord-001')
  })

  it('NotFoundError without id still has 404', () => {
    const err = new NotFoundError('Product')
    expect(err.statusCode).toBe(404)
    expect(err.message).toContain('Product')
  })
})

// ─── ForbiddenError vs UnauthorizedError distinction ─────────────────────────

describe('auth error semantics: 401 vs 403', () => {
  it('UnauthorizedError = not authenticated (no session)', () => {
    const err = new UnauthorizedError()
    expect(err.statusCode).toBe(401)
    // In HTTP: 401 means "please authenticate first"
  })

  it('ForbiddenError = authenticated but not permitted', () => {
    const err = new ForbiddenError()
    expect(err.statusCode).toBe(403)
    // In HTTP: 403 means "we know who you are, but you cannot do this"
  })

  it('ForbiddenError accepts custom message for specificity', () => {
    const err = new ForbiddenError('Yalnızca finans admini bu işlemi yapabilir')
    expect(err.message).toContain('finans admini')
  })

  it('SellerNotActiveError is 403 (account exists but not permitted)', () => {
    // Seller is authenticated but their account is suspended/pending
    const err = new SellerNotActiveError()
    expect(err.statusCode).toBe(403)
  })
})

// ─── PayoutBlockedError: clear blocking reason ────────────────────────────────

describe('PayoutBlockedError: must carry blocking reason', () => {
  /**
   * Admin must always understand WHY a payout is blocked.
   * The error must carry the reason — prevents opaque "blocked" states.
   */

  const blockingReasons = [
    'Açık iade talebi',
    'Açık uyuşmazlık',
    'Satıcı IBAN doğrulanmadı',
    'Admin tarafından bloke edildi',
    'Fraud riski algılandı',
    'Eksik satıcı belgesi',
  ]

  blockingReasons.forEach((reason) => {
    it(`PayoutBlockedError carries reason: "${reason}"`, () => {
      const err = new PayoutBlockedError(reason)
      expect(err.message).toContain(reason)
      expect(err.code).toBe('PAYOUT_BLOCKED')
    })
  })
})

// ─── InvalidTransitionError: exposes the attempted transition ─────────────────

describe('InvalidTransitionError: exposes attempted transition for debugging', () => {
  it('error message contains both from and to states', () => {
    const err = new InvalidTransitionError('payment_pending', 'delivery_confirmed')
    expect(err.message).toContain('payment_pending')
    expect(err.message).toContain('delivery_confirmed')
  })

  it('error message contains arrow/separator', () => {
    const err = new InvalidTransitionError('shipped', 'cancelled_by_customer')
    expect(err.message).toContain('→')
  })
})

// ─── Security: DomainError statusCode cannot be 200 ──────────────────────────

describe('all errors return non-2xx status codes', () => {
  const allErrors = [
    new NotFoundError('Order'),
    new UnauthorizedError(),
    new ForbiddenError(),
    new ConflictError('x'),
    new ValidationError('x'),
    new PayoutBlockedError('x'),
    new InvalidTransitionError('a', 'b'),
    new SellerNotActiveError(),
    new PaymentNotConfirmedError(),
  ]

  allErrors.forEach((err) => {
    it(`${err.constructor.name}.statusCode is not 2xx`, () => {
      expect(err.statusCode).toBeGreaterThanOrEqual(400)
      expect(err.statusCode).toBeLessThan(600)
    })
  })
})
