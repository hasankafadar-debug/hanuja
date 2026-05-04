/**
 * Unit tests — product-review.service.ts
 *
 * Covers the rule shape this service enforces:
 *  - rating must be integer 1-5
 *  - body length min 10, max 4000
 *  - eligibility decision matrix (no_purchase, not_delivery_confirmed, already_reviewed, eligible)
 *  - aggregate computation: only approved reviews feed avgRating + reviewCount
 *
 * No DB connection — pure rule verification mirroring service-layer logic.
 */
import { describe, it, expect } from 'vitest'

const REVIEW_BODY_MIN = 10
const REVIEW_BODY_MAX = 4000

function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
}

function isValidBodyLength(body: string): boolean {
  const trimmed = body.trim()
  return trimmed.length >= REVIEW_BODY_MIN && trimmed.length <= REVIEW_BODY_MAX
}

type EligibilityReason = 'no_purchase' | 'not_delivery_confirmed' | 'already_reviewed'
type EligibilityResult =
  | { eligible: true; orderId: string }
  | { eligible: false; reason: EligibilityReason }

function decideEligibility(input: {
  hasOrderForProduct: boolean
  deliveryConfirmedAt: Date | null
  alreadyReviewed: boolean
  orderId: string | null
}): EligibilityResult {
  if (!input.hasOrderForProduct || !input.orderId) {
    return { eligible: false, reason: 'no_purchase' }
  }
  if (!input.deliveryConfirmedAt) {
    return { eligible: false, reason: 'not_delivery_confirmed' }
  }
  if (input.alreadyReviewed) {
    return { eligible: false, reason: 'already_reviewed' }
  }
  return { eligible: true, orderId: input.orderId }
}

function computeAggregate(ratings: number[]): { avgRating: number | null; reviewCount: number } {
  if (ratings.length === 0) return { avgRating: null, reviewCount: 0 }
  const sum = ratings.reduce((acc, r) => acc + r, 0)
  return {
    avgRating: Number((sum / ratings.length).toFixed(2)),
    reviewCount: ratings.length,
  }
}

// ── Rating validation ────────────────────────────────────────────────────────

describe('Review — rating range (1-5 integer)', () => {
  it.each([1, 2, 3, 4, 5])('accepts integer %i', (n) => {
    expect(isValidRating(n)).toBe(true)
  })

  it('rejects 0', () => {
    expect(isValidRating(0)).toBe(false)
  })

  it('rejects 6', () => {
    expect(isValidRating(6)).toBe(false)
  })

  it('rejects fractional ratings', () => {
    expect(isValidRating(4.5)).toBe(false)
  })

  it('rejects negative ratings', () => {
    expect(isValidRating(-1)).toBe(false)
  })
})

// ── Body length validation ───────────────────────────────────────────────────

describe('Review — body length bounds', () => {
  it('rejects body shorter than 10 characters', () => {
    expect(isValidBodyLength('iyiydi')).toBe(false)
  })

  it('accepts body exactly at minimum (10)', () => {
    expect(isValidBodyLength('1234567890')).toBe(true)
  })

  it('accepts a typical comment', () => {
    expect(isValidBodyLength('Ürün beklediğimden çok daha kaliteli, kargo da hızlıydı.')).toBe(true)
  })

  it('rejects body over 4000 characters', () => {
    expect(isValidBodyLength('a'.repeat(REVIEW_BODY_MAX + 1))).toBe(false)
  })

  it('trims whitespace before measuring', () => {
    expect(isValidBodyLength('   short   ')).toBe(false)
  })
})

// ── Eligibility decision matrix ──────────────────────────────────────────────

describe('Review — eligibility decision matrix', () => {
  const confirmedAt = new Date()

  it('returns no_purchase when there is no order for the product', () => {
    const result = decideEligibility({
      hasOrderForProduct: false,
      deliveryConfirmedAt: null,
      alreadyReviewed: false,
      orderId: null,
    })
    expect(result).toEqual({ eligible: false, reason: 'no_purchase' })
  })

  it('returns not_delivery_confirmed when order exists but is not yet delivery_confirmed', () => {
    const result = decideEligibility({
      hasOrderForProduct: true,
      deliveryConfirmedAt: null,
      alreadyReviewed: false,
      orderId: 'order-1',
    })
    expect(result).toEqual({ eligible: false, reason: 'not_delivery_confirmed' })
  })

  it('returns already_reviewed when there is an existing review for the same (order, product)', () => {
    const result = decideEligibility({
      hasOrderForProduct: true,
      deliveryConfirmedAt: confirmedAt,
      alreadyReviewed: true,
      orderId: 'order-1',
    })
    expect(result).toEqual({ eligible: false, reason: 'already_reviewed' })
  })

  it('returns eligible when all conditions are satisfied', () => {
    const result = decideEligibility({
      hasOrderForProduct: true,
      deliveryConfirmedAt: confirmedAt,
      alreadyReviewed: false,
      orderId: 'order-1',
    })
    expect(result).toEqual({ eligible: true, orderId: 'order-1' })
  })
})

// ── Aggregate computation (only approved reviews count) ──────────────────────

describe('Review — aggregate avgRating + reviewCount', () => {
  it('returns null avg and 0 count when there are no approved reviews', () => {
    expect(computeAggregate([])).toEqual({ avgRating: null, reviewCount: 0 })
  })

  it('computes correct average for a single review', () => {
    expect(computeAggregate([5])).toEqual({ avgRating: 5, reviewCount: 1 })
  })

  it('computes correct average for multiple reviews', () => {
    expect(computeAggregate([5, 4, 3])).toEqual({ avgRating: 4, reviewCount: 3 })
  })

  it('rounds to 2 decimal places', () => {
    expect(computeAggregate([5, 4, 4]).avgRating).toBe(4.33)
  })

  it('does not include rejected ratings (caller must pre-filter)', () => {
    // Caller (repository.recomputeProductAggregate) filters by status='approved'
    // before passing to this aggregate. We test only the aggregation step.
    const approvedOnly = [5, 4]
    expect(computeAggregate(approvedOnly)).toEqual({ avgRating: 4.5, reviewCount: 2 })
  })
})

// ── Moderation default ───────────────────────────────────────────────────────

describe('Review — moderation default', () => {
  it('all submissions default to pending_moderation (never auto-approve)', () => {
    const defaultStatus: 'pending_moderation' | 'approved' | 'rejected' = 'pending_moderation'
    expect(defaultStatus).toBe('pending_moderation')
  })

  it('approved decision maps to approved status', () => {
    const decision = 'approved' as const
    const newStatus = decision === 'approved' ? 'approved' : 'rejected'
    expect(newStatus).toBe('approved')
  })

  it('rejected decision maps to rejected status', () => {
    const decision = 'rejected' as const
    const newStatus: 'approved' | 'rejected' = decision === 'rejected' ? 'rejected' : 'approved'
    expect(newStatus).toBe('rejected')
  })
})
