/**
 * Coupon service - validates and applies discount codes.
 *
 * Rules:
 * - Code must exist, be active, and not be expired.
 * - Cart must meet minimum total requirement if set.
 * - User must not exceed per-user usage limit.
 * - Total usage must not exceed global limit if set.
 */
import type { PrismaClient } from '@prisma/client'
import { createCouponRepository } from '../repositories/coupon.repository'
import { NotFoundError, ValidationError } from '../lib/errors'
import { formatMoney } from '@hanuja/security/money'

export interface CouponValidationResult {
  couponId: string
  code: string
  sellerId: string | null
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  eligibleCartTotal: number
  discountAmount: number
  finalCartTotal: number
}

export function createCouponService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const couponRepo = createCouponRepository(prisma)

  async function validateCoupon(params: {
    code: string
    userId?: string
    cartTotal?: number
    sellerSubtotals?: Array<{ sellerId: string; subtotal: number }>
  }): Promise<CouponValidationResult> {
    const { code, userId } = params

    const coupon = await couponRepo.findByCode(code)
    if (!coupon) throw new NotFoundError('Coupon', code)

    if (!coupon.isActive) {
      throw new ValidationError('Bu kupon kodu artik gecerli degil.')
    }

    const now = new Date()
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new ValidationError('Bu kupon henuz aktif degil.')
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new ValidationError('Bu kupon kodunun suresi dolmus.')
    }

    const cartTotal =
      params.cartTotal ??
      (params.sellerSubtotals ?? []).reduce((sum, item) => sum + item.subtotal, 0)
    const eligibleCartTotal = coupon.sellerId
      ? (params.sellerSubtotals ?? []).find((item) => item.sellerId === coupon.sellerId)?.subtotal ?? 0
      : cartTotal

    if (coupon.minCartTotal !== null && eligibleCartTotal < Number(coupon.minCartTotal)) {
      throw new ValidationError(
        `Bu kupon icin minimum sepet tutari ${formatMoney(Number(coupon.minCartTotal))}.`,
      )
    }

    if (coupon.maxUsageTotal !== null && coupon.usageCount >= coupon.maxUsageTotal) {
      throw new ValidationError('Bu kupon kodu kullanim limitine ulasti.')
    }

    if (userId) {
      const userUsageCount = await couponRepo.countUsageByUser(coupon.id, userId)
      if (userUsageCount >= coupon.maxUsagePerUser) {
        throw new ValidationError('Bu kuponu zaten kullandiniz.')
      }
    }

    const discountValue = Number(coupon.discountValue)
    let discountAmount: number

    if (coupon.discountType === 'percentage') {
      discountAmount = Math.round((eligibleCartTotal * discountValue) / 100 * 100) / 100
    } else {
      discountAmount = Math.min(discountValue, eligibleCartTotal)
    }

    const finalCartTotal = Math.max(0, cartTotal - discountAmount)

    return {
      couponId: coupon.id,
      code: coupon.code,
      sellerId: coupon.sellerId,
      discountType: coupon.discountType as 'percentage' | 'fixed_amount',
      discountValue,
      eligibleCartTotal,
      discountAmount,
      finalCartTotal,
    }
  }

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

  async function removeCoupon(_params: { userId: string }): Promise<void> {
    // Coupon removal is handled at cart level.
  }

  return { validateCoupon, applyCoupon, removeCoupon }
}
