import { Prisma, type PrismaClient } from '@prisma/client'

type QueueOptions = { sellerReported?: boolean; now?: Date }
type Counts = { orderCount: number; lineCount: number }

/** One predicate for both dashboard counters and the product-level review queue. */
function pendingSql({ sellerReported = false, now = new Date() }: QueueOptions) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return Prisma.sql`
    l."deliveryConfirmedAt" IS NULL
    AND l.quantity > l."cancelledQuantity"
    AND o.status IN ('shipped', 'delivered', 'delivery_confirmation_pending')
    AND ((o."quantityLifecycleVersion" = 2 AND l."shippedQuantity" >= l.quantity - l."cancelledQuantity")
      OR (o."quantityLifecycleVersion" <> 2 AND l."fulfilledAt" IS NOT NULL))
    AND ${
      sellerReported
        ? Prisma.sql`l."sellerDeliveryReportedAt" IS NOT NULL`
        : Prisma.sql`l."fulfilledAt" < ${cutoff}`
    }
  `
}

export function createAdminDeliveryQueryService({ prisma }: { prisma: PrismaClient }) {
  async function getCounts(
    options: QueueOptions = {},
    client: Prisma.TransactionClient | PrismaClient = prisma,
  ) {
    const rows = await client.$queryRaw<Counts[]>(Prisma.sql`
      SELECT COUNT(DISTINCT l."orderId")::int AS "orderCount", COUNT(*)::int AS "lineCount"
      FROM order_lines l JOIN orders o ON o.id = l."orderId" WHERE ${pendingSql(options)}
    `)
    return rows[0] ?? { orderCount: 0, lineCount: 0 }
  }

  return {
    getCounts,
    async listForAdmin(options: QueueOptions & { skip?: number; take?: number } = {}) {
      const now = options.now ?? new Date()
      return prisma.$transaction(
        async (tx) => {
          const counts = await getCounts({ ...options, now }, tx)
          const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT l.id FROM order_lines l JOIN orders o ON o.id = l."orderId"
          WHERE ${pendingSql({ ...options, now })}
          ORDER BY ${options.sellerReported ? Prisma.sql`l."sellerDeliveryReportedAt"` : Prisma.sql`l."fulfilledAt"`} ASC,
            l."createdAt" ASC, l.id ASC
          LIMIT ${options.take ?? 50} OFFSET ${options.skip ?? 0}
        `)
          const lines = await tx.orderLine.findMany({
            where: { id: { in: ids.map((row) => row.id) } },
            select: {
              id: true,
              sellerId: true,
              productName: true,
              quantity: true,
              cancelledQuantity: true,
              fulfilledAt: true,
              sellerDeliveryReportedAt: true,
              seller: { select: { displayName: true } },
              order: {
                select: {
                  id: true,
                  publicNumber: true,
                  status: true,
                  shippedAt: true,
                  customer: { select: { name: true } },
                  shipments: {
                    select: {
                      sellerId: true,
                      cargoProvider: true,
                      trackingNumber: true,
                    },
                  },
                },
              },
            },
          })
          const byId = new Map(lines.map((line) => [line.id, line]))
          return {
            ...counts,
            lines: ids.flatMap(({ id }) => {
              const line = byId.get(id)
              return line ? [line] : []
            }),
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
    },
  }
}
