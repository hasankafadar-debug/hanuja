import { Prisma, type Payout } from '@prisma/client'
import { calculateHoldUntil } from '../domain/payout-calculator'
import { payoutPaymentSnapshot } from '../domain/payout-payment-snapshot'
import { isPayoutSettled } from './payout-debt.service'

export function manualPayoutBlock(payout: Payout) {
  // Also protect blocks written by an older worker during a rolling deployment.
  return payout.manualBlockedReason || (payout.manualBlockedAt ? 'Yönetici blokesinde' : null) ||
    (payout.status === 'payout_blocked' && !payout.automaticBlockReason
      ? payout.blockedReason || 'Yönetici incelemesi gerekli' : null)
}

/** Caller acquires seller finance advisory locks first, in stable seller ID order. */
export async function lockPayoutEligibility(tx: Prisma.TransactionClient, payout: Payout) {
  // Row locks cover direct status updates and FK-backed insertions as well as
  // writers that predate the seller advisory-lock convention.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM sellers WHERE id = ${payout.sellerId} FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${payout.orderId} FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM seller_bank_details WHERE "sellerId" = ${payout.sellerId} ORDER BY id FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM return_requests WHERE "orderId" = ${payout.orderId} ORDER BY id FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM disputes WHERE "orderId" = ${payout.orderId} ORDER BY id FOR UPDATE`)
}

export async function readPayoutEligibility(tx: Prisma.TransactionClient, payout: Payout) {
  const order = await tx.order.findUnique({ where: { id: payout.orderId }, select: { deliveryConfirmedAt: true } })
  const seller = await tx.seller.findUnique({ where: { id: payout.sellerId }, select: { status: true } })
  const bank = await tx.sellerBankDetail.findFirst({
    where: { sellerId: payout.sellerId, isActive: true, status: 'ACTIVE', isVerified: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  })
  const bankChange = await tx.sellerBankDetail.count({
    where: { sellerId: payout.sellerId, status: { in: ['PENDING_ACTIVATION', 'BLOCKED'] } },
  })
  const openReturns = await tx.returnRequest.count({
    where: { orderId: payout.orderId, status: { notIn: ['rejected', 'refund_completed'] }, OR: [{ sellerId: payout.sellerId }, { sellerId: null }] },
  })
  const openDisputes = await tx.dispute.count({
    where: {
      orderId: payout.orderId, status: { in: ['open', 'under_review'] },
      OR: [{ escalatedFromReturn: { sellerId: payout.sellerId } }, { escalatedFromReturn: { sellerId: null } }, { escalatedFromReturn: null }],
    },
  })
  const pendingRefunds = await tx.refundTransaction.count({
    where: { orderId: payout.orderId, OR: [{ sellerId: payout.sellerId }, { sellerId: null }], status: { not: 'completed' } },
  })
  // A customer-favoured decision is persisted before its refund is queued.
  // Keep that gap blocked as well; completed dispute refunds remove the blocker.
  const customerDisputes = await tx.dispute.findMany({
    where: { orderId: payout.orderId, status: 'resolved_for_customer', payoutBlocked: true,
      OR: [{ escalatedFromReturn: { sellerId: payout.sellerId } }, { escalatedFromReturn: { sellerId: null } }, { escalatedFromReturn: null }] },
    select: { id: true, escalatedFromReturn: {
      select: { refundedAt: true, items: { select: { id: true }, take: 1 } },
    } },
  })
  // Legacy whole-return refunds record completion on the return itself.
  const unsettledDisputes = customerDisputes.filter((dispute) => {
    const legacyReturn = dispute.escalatedFromReturn
    return !(legacyReturn?.refundedAt && legacyReturn.items.length === 0)
  })
  const completedDisputeRefunds = unsettledDisputes.length ? await tx.refundTransaction.count({
    where: { sourceType: 'dispute', sourceId: { in: unsettledDisputes.map((d) => d.id) }, status: 'completed' },
  }) : 0
  const now = new Date()
  const holdExpired = Boolean(order?.deliveryConfirmedAt && payout.holdUntil &&
    now >= payout.holdUntil && now >= calculateHoldUntil(order.deliveryConfirmedAt))
  const reasons = [
    ...(!holdExpired ? ['Zorunlu 30 günlük bekleme süresi dolmadı'] : []),
    ...(openReturns ? ['Açık iade talebi var'] : []),
    ...(openDisputes ? ['Açık uyuşmazlık var'] : []),
    ...(pendingRefunds ? ['Tamamlanmamış müşteri iadesi var'] : []),
    ...(unsettledDisputes.length > completedDisputeRefunds ? ['Uyuşmazlık iadesi tamamlanmadı'] : []),
    ...(seller?.status !== 'active' ? ['Satıcı hesabı aktif değil'] : []),
    ...(!bank ? ['Doğrulanmış aktif banka hesabı bulunamadı'] : []),
    ...(bankChange ? ['Banka hesabı değişikliği incelemede'] : []),
    ...(payout.netAmount.lte(0) ? ['Ödenecek pozitif tutar bulunmuyor'] : []),
  ]
  const manualReason = manualPayoutBlock(payout)
  const automaticReason = reasons.join('; ') || null
  return {
    ready: !isPayoutSettled(payout.status) && !manualReason && !automaticReason,
    reason: isPayoutSettled(payout.status) ? 'already_settled' : manualReason || automaticReason,
    manualReason, automaticReason, holdExpired, bank,
    snapshot: payoutPaymentSnapshot(payout, bank),
    amount: payout.netAmount.toFixed(2), currency: payout.currency,
  }
}
