/**
 * Coupon service - validates and applies discount codes.
 *
 * Rules:
 * - Code must exist, be active, and not be expired.
 * - Cart must meet minimum total requirement if set.
 * - User must not exceed per-user usage limit.
 * - Total usage must not exceed global limit if set.
 *
 * Money math uses Decimal + roundMoney throughout — never plain JS floats
 * (02-coding-standards.md, 07-marketplace-finance-rules.md). Public return
 * shapes stay `number` for backward compatibility with existing callers
 * (checkout.service, cart.service) — conversion happens only at the boundary.
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createCouponRepository } from '../repositories/coupon.repository'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { formatMoney, roundMoney } from '@hanuja/security/money'

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

    const cartTotal = new Decimal(
      params.cartTotal ??
        (params.sellerSubtotals ?? []).reduce((sum, item) => sum + item.subtotal, 0),
    )
    const eligibleCartTotal = new Decimal(
      coupon.sellerId
        ? (params.sellerSubtotals ?? []).find((item) => item.sellerId === coupon.sellerId)
            ?.subtotal ?? 0
        : cartTotal,
    )

    if (coupon.minCartTotal !== null && eligibleCartTotal.lt(coupon.minCartTotal)) {
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

    const discountValue = new Decimal(coupon.discountValue as unknown as Decimal | number)
    let discountAmount: Decimal

    if (coupon.discountType === 'percentage') {
      discountAmount = roundMoney(eligibleCartTotal.mul(discountValue).div(100))
    } else {
      discountAmount = Decimal.min(discountValue, eligibleCartTotal)
    }

    const finalCartTotal = Decimal.max(new Decimal(0), cartTotal.minus(discountAmount))

    return {
      couponId: coupon.id,
      code: coupon.code,
      sellerId: coupon.sellerId,
      discountType: coupon.discountType as 'percentage' | 'fixed_amount',
      discountValue: discountValue.toNumber(),
      eligibleCartTotal: Number(eligibleCartTotal.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      finalCartTotal: Number(finalCartTotal.toFixed(2)),
    }
  }

  async function applyCoupon(params: {
    couponId: string
    userId: string
    orderId: string
    /**
     * When provided, runs inside the caller's existing interactive transaction
     * (e.g. checkout.service.createOrder) instead of opening a new batched
     * transaction. Both operations still complete atomically with the caller's tx.
     */
    tx?: PrismaClient
  }): Promise<void> {
    const { couponId, userId, orderId, tx } = params

    if (tx) {
      const txRepo = createCouponRepository(tx)
      await txRepo.recordUsage(couponId, userId, orderId)
      await txRepo.incrementUsage(couponId)
      return
    }

    await prisma.$transaction([
      couponRepo.recordUsage(couponId, userId, orderId),
      couponRepo.incrementUsage(couponId),
    ])
  }

  async function removeCoupon(_params: { userId: string }): Promise<void> {
    // Coupon removal is handled at cart level.
  }

  function normalizeCode(code: string) {
    return code.trim().toUpperCase()
  }

  /**
   * Satıcının kendi kuponunu oluşturması — 09-seller-panel-rules.md.
   * `sellerId` her zaman oturumdaki satıcıdan gelir; caller (route) asla
   * client body'sinden sellerId almamalı.
   */
  async function createSellerCoupon(params: {
    sellerId: string
    code: string
    discountType: 'percentage' | 'fixed_amount'
    discountValue: number
    minCartTotal?: number | null
    maxUsageTotal?: number | null
    maxUsagePerUser?: number
    expiresAt?: Date | null
  }) {
    const code = normalizeCode(params.code)
    if (code.length < 3) {
      throw new ValidationError('Kupon kodu en az 3 karakter olmalı.')
    }

    if (params.discountType === 'percentage') {
      if (params.discountValue < 1 || params.discountValue > 100) {
        throw new ValidationError('Yüzde indirim 1 ile 100 arasında olmalı.')
      }
    } else if (params.discountValue <= 0) {
      throw new ValidationError('Sabit indirim tutarı sıfırdan büyük olmalı.')
    }

    if (params.minCartTotal !== undefined && params.minCartTotal !== null && params.minCartTotal < 0) {
      throw new ValidationError('Minimum sepet tutarı negatif olamaz.')
    }

    if (
      params.maxUsageTotal !== undefined &&
      params.maxUsageTotal !== null &&
      params.maxUsageTotal < 1
    ) {
      throw new ValidationError('Toplam kullanım limiti en az 1 olmalı.')
    }

    if (params.expiresAt && params.expiresAt <= new Date()) {
      throw new ValidationError('Son geçerlilik tarihi gelecekte olmalı.')
    }

    const existing = await couponRepo.findByCode(code)
    if (existing) {
      throw new ConflictError(`Bu kupon kodu zaten kullanımda: ${code}`)
    }

    return couponRepo.create({
      code,
      sellerId: params.sellerId,
      discountType: params.discountType,
      discountValue: params.discountValue,
      ...(params.minCartTotal !== undefined && params.minCartTotal !== null
        ? { minCartTotal: params.minCartTotal }
        : {}),
      ...(params.maxUsageTotal !== undefined && params.maxUsageTotal !== null
        ? { maxUsageTotal: params.maxUsageTotal }
        : {}),
      ...(params.maxUsagePerUser !== undefined ? { maxUsagePerUser: params.maxUsagePerUser } : {}),
      ...(params.expiresAt !== undefined && params.expiresAt !== null
        ? { expiresAt: params.expiresAt }
        : {}),
    })
  }

  /**
   * Satıcının kendi kuponunu güncellemesi — yalnız aktif/pasif, son geçerlilik
   * tarihi ve toplam kullanım limiti değiştirilebilir. Kod, tip, ve değer
   * (indirim tutarı/yüzdesi) sonradan değiştirilemez — mevcut kullanımların
   * anlamını bozmamak için (auditability).
   */
  async function updateSellerCoupon(params: {
    sellerId: string
    couponId: string
    isActive?: boolean
    expiresAt?: Date | null
    maxUsageTotal?: number | null
  }) {
    const coupon = await couponRepo.findById(params.couponId)
    if (!coupon || coupon.sellerId !== params.sellerId) {
      throw new NotFoundError('Coupon', params.couponId)
    }

    if (params.expiresAt !== undefined && params.expiresAt !== null && params.expiresAt <= new Date()) {
      throw new ValidationError('Son geçerlilik tarihi gelecekte olmalı.')
    }

    if (params.maxUsageTotal !== undefined && params.maxUsageTotal !== null && params.maxUsageTotal < 1) {
      throw new ValidationError('Toplam kullanım limiti en az 1 olmalı.')
    }

    return couponRepo.update(params.couponId, {
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.expiresAt !== undefined ? { expiresAt: params.expiresAt } : {}),
      ...(params.maxUsageTotal !== undefined ? { maxUsageTotal: params.maxUsageTotal } : {}),
    })
  }

  function listBySeller(sellerId: string, params: { skip?: number; take?: number } = {}) {
    return couponRepo.listBySeller(sellerId, params)
  }

  return {
    validateCoupon,
    applyCoupon,
    removeCoupon,
    createSellerCoupon,
    updateSellerCoupon,
    listBySeller,
  }
}
