import { Decimal } from '@prisma/client/runtime/client'

const ZERO = new Decimal(0)
const SNAPSHOT_TOLERANCE = new Decimal('0.01')

export const LEGACY_FINANCIAL_REVIEW_PREFIX = 'Eski sipariş finansal incelemesi:'

type LegacyLineSnapshot = {
  sellerId: string
  quantity: number
  totalPrice: Decimal
  couponDiscountAmount: Decimal
  commissionAmount: Decimal
  netPayoutAmount: Decimal
  commissionExemptedAt?: Date | null
}

type LegacyPaymentSnapshot = {
  amount: Decimal
  refundedAmount: Decimal
}

export type LegacyRefundAllocation = {
  customerAmount: Decimal
  grossProductAmount: Decimal
  couponAdjustmentAmount: Decimal
  sellerAdjustmentAmount: Decimal
  commissionAdjustmentAmount: Decimal
  platformFundedAmount: Decimal
  manualReviewReason: string | null
}

function closeEnough(left: Decimal, right: Decimal) {
  return left.sub(right).abs().lte(SNAPSHOT_TOLERANCE)
}

function manual(reason: string, customerAmount = ZERO): LegacyRefundAllocation {
  return {
    customerAmount,
    grossProductAmount: ZERO,
    couponAdjustmentAmount: ZERO,
    sellerAdjustmentAmount: ZERO,
    commissionAdjustmentAmount: ZERO,
    platformFundedAmount: ZERO,
    manualReviewReason: `${LEGACY_FINANCIAL_REVIEW_PREFIX} ${reason}`,
  }
}

/**
 * Resolves a whole-order legacy refund from persisted checkout snapshots.
 * Historical commission values are consumed as-is; current rates are never read.
 */
export function allocateLegacyFullRefund(params: {
  sellerId: string
  requestedCustomerAmount: Decimal
  orderGrossAmount: Decimal
  orderTotalAmount: Decimal
  lines: LegacyLineSnapshot[]
  confirmedPayments: LegacyPaymentSnapshot[]
  otherRefundAmount: Decimal
  hasHistoricalRefundEvidence?: boolean
}): LegacyRefundAllocation {
  if (params.hasHistoricalRefundEvidence) {
    return manual('tarihî iade kanıtı var; kalan gerçek ödeme mutabakatla doğrulanmalıdır')
  }
  if (params.confirmedPayments.length !== 1) {
    return manual('tek ve doğrulanmış ödeme snapshot’ı bulunamadı')
  }

  const payment = params.confirmedPayments[0]!
  if (
    payment.amount.lte(0) ||
    payment.refundedAmount.lt(0) ||
    payment.refundedAmount.gt(payment.amount) ||
    !closeEnough(payment.amount, params.orderTotalAmount)
  ) {
    return manual('ödeme tutarı sipariş toplamıyla doğrulanamadı')
  }

  const remainingPayment = Decimal.max(
    ZERO,
    payment.amount.sub(Decimal.max(payment.refundedAmount, params.otherRefundAmount)),
  )
  const safeRequestedAmount = Decimal.max(
    ZERO,
    Decimal.min(params.requestedCustomerAmount, remainingPayment),
  )
  if (remainingPayment.lte(0)) {
    return manual('müşterinin iade edilebilir kalan ödemesi bulunmuyor')
  }
  if (params.otherRefundAmount.gt(0) || payment.refundedAmount.gt(0)) {
    return manual(
      'önceki iadenin hangi ürünlere ait olduğu doğrulanamadı',
      safeRequestedAmount,
    )
  }

  if (params.lines.length === 0 || params.lines.some((line) => line.sellerId !== params.sellerId)) {
    return manual('ürünler tek satıcıyla güvenilir biçimde eşleştirilemedi', safeRequestedAmount)
  }

  let grossProductAmount = ZERO
  let couponAdjustmentAmount = ZERO
  let commissionAdjustmentAmount = ZERO
  let originalNetPayoutAmount = ZERO
  for (const line of params.lines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.totalPrice.lt(0) ||
      line.couponDiscountAmount.lt(0) ||
      line.commissionAmount.lt(0) ||
      line.netPayoutAmount.lt(0) ||
      line.couponDiscountAmount.gt(line.totalPrice) ||
      line.commissionAmount.gt(line.totalPrice.sub(line.couponDiscountAmount))
    ) {
      return manual('ürün finans snapshot’ı geçersiz', safeRequestedAmount)
    }

    const originalNet = line.totalPrice
      .sub(line.couponDiscountAmount)
      .sub(line.commissionAmount)
    if (!closeEnough(originalNet, line.netPayoutAmount)) {
      return manual('ürün net hakediş snapshot’ı brüt/kupon/komisyon bileşenleriyle uyuşmuyor', safeRequestedAmount)
    }

    grossProductAmount = grossProductAmount.add(line.totalPrice)
    couponAdjustmentAmount = couponAdjustmentAmount.add(line.couponDiscountAmount)
    originalNetPayoutAmount = originalNetPayoutAmount.add(line.netPayoutAmount)
    if (!line.commissionExemptedAt) {
      commissionAdjustmentAmount = commissionAdjustmentAmount.add(line.commissionAmount)
    }
  }

  if (!closeEnough(grossProductAmount, params.orderGrossAmount)) {
    return manual('ürün brüt toplamı sipariş snapshot’ıyla uyuşmuyor', safeRequestedAmount)
  }

  const isWholeRefundRequest =
    closeEnough(params.requestedCustomerAmount, grossProductAmount) ||
    closeEnough(params.requestedCustomerAmount, params.orderTotalAmount) ||
    params.requestedCustomerAmount.gte(remainingPayment)
  if (!isWholeRefundRequest) {
    return manual('kısmi tutar güvenilir ürün kalemlerine dağıtılamadı', safeRequestedAmount)
  }

  const exemptedCommission = params.lines.reduce(
    (sum, line) => sum.add(line.commissionExemptedAt ? line.commissionAmount : ZERO),
    ZERO,
  )
  const sellerAdjustmentAmount = originalNetPayoutAmount.add(exemptedCommission)

  return {
    customerAmount: remainingPayment,
    grossProductAmount,
    couponAdjustmentAmount,
    sellerAdjustmentAmount,
    commissionAdjustmentAmount,
    platformFundedAmount: Decimal.max(
      ZERO,
      remainingPayment.sub(sellerAdjustmentAmount).sub(commissionAdjustmentAmount),
    ),
    manualReviewReason: null,
  }
}
