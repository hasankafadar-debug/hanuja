import type { Prisma, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'

const paginationSchema = z.object({
  skip: z.number().int().min(0).default(0),
  take: z.number().int().min(1).max(100).default(50),
})

const manualRequiredWhere: Prisma.RefundTransactionWhereInput = {
  status: 'manual_required',
}

// A successful item takes precedence over failed items in the parent status.
// Include partial failures, but keep manual reconciliation in its own queue.
// These are unresolved failures, NOT proof that BullMQ has exhausted its retries.
const failedCardWhere: Prisma.RefundTransactionWhereInput = {
  payment: { is: { method: 'card' } },
  OR: [
    { status: 'failed' },
    { status: 'partially_completed', items: { some: { status: 'failed' } } },
  ],
}

const refundSelect = {
  id: true,
  orderId: true,
  sourceType: true,
  sourceId: true,
  status: true,
  customerAmount: true,
  failureReason: true,
  createdAt: true,
  order: {
    select: {
      publicNumber: true,
      currency: true,
      customer: { select: { id: true, name: true } },
    },
  },
  payment: { select: { method: true, provider: true } },
  items: {
    select: {
      id: true,
      amount: true,
      status: true,
      attemptCount: true,
      lastAttemptAt: true,
      failureReason: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.RefundTransactionSelect

type Pagination = { skip?: number; take?: number }

/** Read-only admin projection. Does not issue refunds, enqueue jobs or change ledger entries. */
export function createAdminRefundQueryService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  async function list(
    where: Prisma.RefundTransactionWhereInput,
    params: Pagination,
  ) {
    const { skip, take } = paginationSchema.parse(params)
    const [refunds, total] = await prisma.$transaction(
      [
        prisma.refundTransaction.findMany({
          where,
          select: refundSelect,
          // Oldest unresolved refunds first; stable ordering across equal timestamps.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
        prisma.refundTransaction.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    )

    const rows = refunds.map(({ items, customerAmount, ...refund }) => {
      // Only unfinished items are payable. Never show the original total as the
      // remaining amount after a partial success. Missing items require review.
      const outstandingAmount =
        items.length === 0
          ? null
          : items
              .filter((item) => item.status !== 'completed')
              .reduce((sum, item) => sum.add(item.amount), new Decimal(0))
              .toFixed(2)

      return {
        ...refund,
        customerAmount: customerAmount.toFixed(2),
        outstandingAmount,
        items: items.map((item) => ({
          ...item,
          amount: item.amount.toFixed(2),
        })),
      }
    })
    return { rows, total }
  }

  async function getCounts() {
    const [pendingManualRefunds, failedCardRefunds] = await prisma.$transaction(
      [
        prisma.refundTransaction.count({ where: manualRequiredWhere }),
        prisma.refundTransaction.count({ where: failedCardWhere }),
      ],
      { isolationLevel: 'RepeatableRead' },
    )
    return { pendingManualRefunds, failedCardRefunds }
  }

  return {
    getCounts,
    listManualRequiredForAdmin: (params: Pagination = {}) =>
      list(manualRequiredWhere, params),
    listFailedCardForAdmin: (params: Pagination = {}) =>
      list(failedCardWhere, params),
  }
}

export type AdminRefundQueueRow = Awaited<
  ReturnType<
    ReturnType<
      typeof createAdminRefundQueryService
    >['listManualRequiredForAdmin']
  >
>['rows'][number]
