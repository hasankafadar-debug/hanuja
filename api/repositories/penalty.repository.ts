import type { PenaltyReason, PenaltyStatus, Prisma, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createPenaltyRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.penalty.findUnique({ where: { id } })
    },

    findByOrderId(orderId: string) {
      return prisma.penalty.findFirst({ where: { orderId } })
    },

    findByOrderIdAndReason(orderId: string, reason: PenaltyReason) {
      return prisma.penalty.findFirst({ where: { orderId, reason } })
    },

    create(
      data: {
        sellerId: string
        orderId: string
        reason: PenaltyReason
        baseAmount: Decimal
        rate: Decimal
        penaltyAmount: Decimal
        accrualSourceDate?: Date
        accrualDayCount?: number
        dailyAccrualRate?: Decimal
        lastAccrualAt?: Date
      },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.penalty.create({ data })
    },

    waive(
      id: string,
      params: { waivedBy: string; waiverReason: string },
    ) {
      // History-preserving waiver — original penalty record is NOT deleted.
      // Status changes to 'waived', original amounts remain for audit.
      return prisma.penalty.update({
        where: { id },
        data: {
          status: 'waived',
          waivedBy: params.waivedBy,
          waivedAt: new Date(),
          waiverReason: params.waiverReason,
        },
      })
    },

    markOffsetted(id: string, payoutId: string) {
      return prisma.penalty.update({
        where: { id },
        data: { status: 'offset', offsetPayoutId: payoutId },
      })
    },

    updateAccrual(
      id: string,
      data: {
        rate: Decimal
        penaltyAmount: Decimal
        accrualDayCount: number
        lastAccrualAt?: Date | null
      },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.penalty.update({
        where: { id },
        data,
      })
    },

    listBySeller(params: {
      sellerId: string
      status?: PenaltyStatus
      skip?: number
      take?: number
    }) {
      return prisma.penalty.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    async listForAdmin(params: {
      sellerId?: string
      status?: PenaltyStatus
      query?: string
      tab?: 'unbilled' | 'billed' | 'waived'
      financeInvoice?: 'missing' | 'present'
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const tabWhere: Prisma.PenaltyWhereInput =
        params.tab === 'waived'
          ? { status: 'waived' }
          : params.tab === 'unbilled'
            ? {
                status: { not: 'waived' as const },
                financeInvoices: {
                  none: { type: 'penalty' },
                },
              }
            : params.tab === 'billed'
              ? {
                  status: { not: 'waived' as const },
                  financeInvoices: {
                    some: { type: 'penalty' },
                  },
                }
              : {}
      const where: Prisma.PenaltyWhereInput = {
        ...(params.sellerId !== undefined ? { sellerId: params.sellerId } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...tabWhere,
        ...(params.financeInvoice === 'missing'
          ? {
              status: { not: 'waived' as const },
              financeInvoices: {
                none: { type: 'penalty' },
              },
            }
          : {}),
        ...(params.financeInvoice === 'present'
          ? {
              financeInvoices: {
                some: { type: 'penalty' },
              },
            }
          : {}),
        ...(params.from !== undefined || params.to !== undefined
          ? {
              createdAt: {
                ...(params.from !== undefined ? { gte: params.from } : {}),
                ...(params.to !== undefined ? { lte: params.to } : {}),
              },
            }
          : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { orderId: { contains: normalizedQuery } },
                { seller: { displayName: { contains: normalizedQuery, mode: 'insensitive' } } },
                { seller: { slug: { contains: normalizedQuery, mode: 'insensitive' } } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.penalty.findMany({
          where,
          include: {
            seller: { include: { profile: true } },
            order: true,
            financeInvoices: {
              where: { type: 'penalty' },
              orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
            },
          },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        prisma.penalty.count({ where }),
      ])

      return { rows, total }
    },
  }
}

export type PenaltyRepository = ReturnType<typeof createPenaltyRepository>
