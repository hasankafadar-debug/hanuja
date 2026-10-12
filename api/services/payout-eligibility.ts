import { Prisma, type Payout } from '@prisma/client'
import { calculatePayoutDueDate, nextPayoutDay } from '../domain/payout-calculator'
import { PAYOUT_HOLD_DAYS } from '../domain/penalty-calculator'
import { payoutPaymentSnapshot } from '../domain/payout-payment-snapshot'
import { formatReportingDate } from '../lib/reporting-time'
import { isPayoutSettled } from './payout-debt.service'
import { PLATFORM_SETTINGS_ID } from './platform-settings.service'

/** Admin-configurable payout term in days, counted from the seller's invoice date. */
export async function readPayoutHoldDays(tx: Pick<Prisma.TransactionClient, 'platformSettings'>) {
  const settings = await tx.platformSettings.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
    select: { payoutHoldDays: true },
  })
  return settings?.payoutHoldDays ?? PAYOUT_HOLD_DAYS
}

/**
 * Payout due date for an order/seller pair, or null until the seller's invoice to Hanuja
 * is approved with its invoice date.
 */
export async function readInvoicePayoutSchedule(
  tx: Pick<Prisma.TransactionClient, 'platformSettings' | 'orderSellerInvoice'>,
  orderId: string,
  sellerId: string,
) {
  const invoice = await tx.orderSellerInvoice.findUnique({
    where: { orderId_sellerId: { orderId, sellerId } },
    select: { reviewStatus: true, invoiceDate: true, reviewedAt: true },
  })
  if (invoice?.reviewStatus !== 'approved' || !invoice.invoiceDate) return null
  return {
    dueDate: calculatePayoutDueDate(invoice.invoiceDate, await readPayoutHoldDays(tx)),
    approvedAt: invoice.reviewedAt,
  }
}

export async function readInvoicePayoutDueDate(
  tx: Pick<Prisma.TransactionClient, 'platformSettings' | 'orderSellerInvoice'>,
  orderId: string,
  sellerId: string,
) {
  return (await readInvoicePayoutSchedule(tx, orderId, sellerId))?.dueDate ?? null
}

/** Calendar day is fixed once eligibility returns, rather than moving on every read. */
export function payoutDayAfterEligibility(dueDate: Date, eligibleAt: Date) {
  const restoredDay = nextPayoutDay(eligibleAt)
  return dueDate > restoredDay ? dueDate : restoredDay
}

/** Called by blocker writers in their own transaction; settled payouts are immutable. */
export async function invalidatePayoutSchedule(
  tx: Pick<Prisma.TransactionClient, 'payout'>,
  orderId: string | undefined,
  sellerId?: string | null,
) {
  if (!orderId && !sellerId) return
  await tx.payout.updateMany({
    where: { ...(orderId ? { orderId } : {}), ...(sellerId ? { sellerId } : {}), status: { notIn: ['payout_paid', 'payout_offset'] } },
    data: { nextPaymentAt: null },
  })
}

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
  // The due date comes from the approved seller invoice; a concurrent rejection must not race a payment.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM order_seller_invoices WHERE "orderId" = ${payout.orderId} AND "sellerId" = ${payout.sellerId} FOR UPDATE`)
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
    where: { orderId: payout.orderId, OR: [{ sellerId: payout.sellerId }, { sellerId: null }], status: { notIn: ['completed', 'voided'] } },
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
  // Vade, onaylı satıcı faturasının tarihinden hesaplanır; teslim onayı ayrıca şarttır.
  const dueDate = await readInvoicePayoutDueDate(tx, payout.orderId, payout.sellerId)
  const holdExpired = Boolean(order?.deliveryConfirmedAt && dueDate && payout.holdUntil &&
    now >= payout.holdUntil && now >= dueDate)
  const businessReasons = [
    ...(!order?.deliveryConfirmedAt ? ['Teslim onayı bekleniyor'] : []),
    ...(!dueDate ? ["Tasarımcının Hanuja'ya faturası onaylanmadı"] : []),
    ...(openReturns ? ['Açık iade talebi var'] : []),
    ...(openDisputes ? ['Açık uyuşmazlık var'] : []),
    ...(pendingRefunds ? ['Tamamlanmamış müşteri iadesi var'] : []),
    ...(unsettledDisputes.length > completedDisputeRefunds ? ['Uyuşmazlık iadesi tamamlanmadı'] : []),
    ...(seller?.status !== 'active' ? ['Tasarımcı hesabı aktif değil'] : []),
    ...(!bank ? ['Doğrulanmış aktif banka hesabı bulunamadı'] : []),
    ...(bankChange ? ['Banka hesabı değişikliği incelemede'] : []),
    ...(payout.netAmount.lte(0) ? ['Ödenecek pozitif tutar bulunmuyor'] : []),
  ]
  const manualReason = manualPayoutBlock(payout)
  const businessBlocked = Boolean(manualReason || businessReasons.length)
  const nextPaymentAt = payout.nextPaymentAt ?? null
  const paymentDayReached = Boolean(nextPaymentAt && now >= nextPaymentAt)
  const reasons = [
    ...businessReasons,
    ...(dueDate && !holdExpired ? [`Fatura vadesi dolmadı (ödeme günü: ${formatReportingDate(dueDate)})`] : []),
    ...(!businessBlocked && holdExpired && !paymentDayReached
      ? [nextPaymentAt ? `Ödeme günü bekleniyor (${formatReportingDate(nextPaymentAt)})` : 'Ödeme günü hesaplanıyor'] : []),
  ]
  const automaticReason = reasons.join('; ') || null
  return {
    ready: !isPayoutSettled(payout.status) && !manualReason && !automaticReason,
    reason: isPayoutSettled(payout.status) ? 'already_settled' : manualReason || automaticReason,
    manualReason, automaticReason, businessBlocked, holdExpired, paymentDayReached, dueDate, nextPaymentAt, bank,
    snapshot: payoutPaymentSnapshot(payout, bank),
    amount: payout.netAmount.toFixed(2), currency: payout.currency,
  }
}
