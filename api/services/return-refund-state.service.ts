import { Prisma, type RefundSourceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { isPendingReturnInspection } from '../domain/communication-audience'
import { NotFoundError } from '../lib/errors'

/** Receipt decisions and the bank/provider settlement are separate facts. */
export async function updateReturnRefundState(
  tx: Prisma.TransactionClient,
  refund: {
    orderId: string
    sourceType: RefundSourceType
    sourceId: string
  },
) {
  const returns = await tx.returnRequest.findMany({
    where:
      refund.sourceType === 'return_request'
        ? { id: refund.sourceId, orderId: refund.orderId }
        : { disputeId: refund.sourceId, orderId: refund.orderId },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (refund.sourceType === 'return_request' && !returns.length)
    throw new NotFoundError('İade talebi', refund.sourceId)
  for (const entry of returns) {
    // Two refund records may finish concurrently; the last writer reads all
    // settlements after taking the return row lock, rather than closing early.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM return_requests WHERE id = ${entry.id} FOR UPDATE`)
    const request = await tx.returnRequest.findUniqueOrThrow({ where: { id: entry.id } })
    const refunds = await tx.refundTransaction.findMany({
      where: {
        orderId: request.orderId,
        OR: [
          { sourceType: 'return_request', sourceId: request.id },
          ...(request.disputeId
            ? [{ sourceType: 'dispute' as const, sourceId: request.disputeId }]
            : []),
        ],
      },
      select: { status: true, customerAmount: true },
    })
    const allSettled = refunds.length > 0 && refunds.every((value) => value.status === 'completed')
    const pendingDecision = isPendingReturnInspection(request)
    const finalRejection =
      request.status === 'rejected' && Boolean(request.reviewedAt) && !pendingDecision
    await tx.returnRequest.update({
      where: { id: request.id },
      data: {
        status: pendingDecision
          ? 'under_review'
          : finalRejection
            ? 'rejected'
            : allSettled
              ? 'refund_completed'
              : 'received',
        refundedAt: allSettled && !pendingDecision ? new Date() : null,
        refundAmount: refunds.reduce((sum, value) => sum.add(value.customerAmount), new Decimal(0)),
      },
    })
  }
}
