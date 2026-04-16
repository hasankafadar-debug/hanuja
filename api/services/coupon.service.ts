/**
 * Coupon service — validates and applies discount codes.
 *
 * Rules:
 * - Code must exist, be active, and not be expired.
 * - Cart must meet minimum total requirement if set.
 * - User must not exceed per-user usage limit.
 * - Total usage must not exceed global limit if set.
 *
 * Finance note: coupon discount impact is recorded on the order and
 * may affect seller payout (couponShareAmount) — see finance rules.
 */
import type { PrismaClient } from '@prisma/client'
import { createCouponRepository } from '../repositories/coupon.repository'
import { NotFoundError, ValidationError } from '../lib/errors'

export interface CouponValidationResult {
  couponId: string
  code: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  /** Computed discount amount given the cart total */
  discountAmount: number
  /** Cart total after discount */
  finalCartTotal: number
}

export function createCouponService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const couponRepo = createCouponRepository(prisma)

  async function validateCoupon(params: {
    code: string
    userId: string
    cartTotal: number
  }): Promise<CouponValidationResult> {
    const { code, userId, cartTotal } = params

    const coupon = await couponRepo.findByCode(code)
    if (!coupon) throw new NotFoundError('Coupon', code)

    if (!coupon.isActive) {
      throw new ValidationError('Bu kupon kodu artık geçerli değil.')
    }

    const now = new Date()
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new ValidationError('Bu kupon henüz aktif değil.')
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new ValidationError('Bu kupon kodunun süresi dolmuş.')
    }

    if (coupon.minCartTotal !== null && cartTotal < Number(coupon.minCartTotal)) {
      throw new ValidationError(
        `Bu kupon için minimum sepet tutarı ₺${Number(coupon.minCartTotal).toFixed(2)}.`,
      )
    }

    if (coupon.maxUsageTotal !== null && coupon.usageCount >= coupon.maxUsageTotal) {
      throw new ValidationError('Bu kupon kodu kullanım limitine ulaştı.')
    }

    const userUsageCount = await couponRepo.countUsageByUser(coupon.id, userId)
    if (userUsageCount >= coupon.maxUsagePerUser) {
      throw new ValidationError('Bu kuponu zaten kullandınız.')
    }

    const discountValue = Number(coupon.discountValue)
    let discountAmount: number

    if (coupon.discountType === 'percentage') {
      discountAmount = Math.round((cartTotal * discountValue) / 100 * 100) / 100
    } else {
      discountAmount = Math.min(discountValue, cartTotal)
    }

    const finalCartTotal = Math.max(0, cartTotal - discountAmount)

    return {
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType as 'percentage' | 'fixed_amount',
      discountValue,
      discountAmount,
      finalCartTotal,
    }
  }

  /**
   * Record coupon usage after order is confirmed.
   * Called from order confirmation flow — not from validation.
   */
  async function applyCoupon(params: {
    couponId: string
    userId: string
    orderId: string
  }): Promise<void> {
    const { couponId, userId, orderId } = params

    await prisma.$transaction([
      couponRepo.recordUsage(couponId, userId, orderId),
      couponRepo.incrementUsage(couponId),
    ])
  }

  /**
   * Remove coupon effect from cart — does not decrement usage count
   * (only applyCoupon does, on confirmed order).
   */
  async function removeCoupon(_params: { userId: string }): Promise<void> {
    // Coupon is stored in cart session — removal is handled at cart level.
    // This method is a no-op at service level but exists for API symmetry.
  }

  return { validateCoupon, applyCoupon, removeCoupon }
}
