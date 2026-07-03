import type { OrderStatus, Prisma, PrismaClient } from '@prisma/client'

// Delivery/cargo coordination is the seller's operational responsibility, so
// the customer's delivery phone number is intentionally exposed to sellers
// here (business decision, see `.claude/rules/12-production-readiness.md` §8).
// Unlike `customer.email` (never selected below) and `customer.name` (masked
// in the UI via `maskCustomerName`), `address.phone` is returned raw on
// purpose. Do not add masking here without an explicit policy change.
const sellerVisibleAddressSelect = {
  fullName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  district: true,
  city: true,
  postalCode: true,
} satisfies Prisma.AddressSelect

export function createOrderRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.order.findUnique({
        where: { id },
        include: {
          lines: { include: { product: true } },
          payments: true,
          shipments: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      })
    },

    /** Customer can only view their own orders */
    findByIdForCustomer(id: string, customerId: string) {
      return prisma.order.findFirst({
        where: { id, customerId },
        include: {
          lines: { include: { product: { include: { images: { take: 1 } } } } },
          payments: true,
          shipments: true,
          address: true,
          legalSnapshot: true,
          sellerInvoices: {
            include: {
              seller: {
                select: {
                  id: true,
                  displayName: true,
                  slug: true,
                },
              },
            },
            orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
          },
          returnRequests: {
            select: { id: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
    },

    /** Seller sees only payment_confirmed+ orders for their products */
    findByIdForSeller(id: string, sellerId: string) {
      return prisma.order.findUnique({
        where: {
          id,
          lines: { some: { sellerId } },
          status: {
            notIn: [
              'draft',
              'checkout_started',
              'payment_pending',
              'payment_failed',
              'payment_cancelled',
              'bank_transfer_waiting',
            ],
          },
        },
        include: {
          lines: { where: { sellerId }, include: { product: true } },
          shipments: true,
          address: { select: sellerVisibleAddressSelect },
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          statusHistory: { orderBy: { createdAt: 'asc' } },
          legalSnapshot: true,
          payouts: {
            where: { sellerId },
            orderBy: { createdAt: 'desc' },
          },
          penalties: {
            where: { sellerId },
            orderBy: { createdAt: 'desc' },
          },
          sellerInvoices: {
            where: { sellerId },
            include: {
              seller: {
                select: {
                  id: true,
                  displayName: true,
                  slug: true,
                },
              },
            },
            orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
          },
          emailAliases: {
            where: { sellerId, purpose: 'invoice', status: 'active' },
            select: {
              id: true,
              aliasEmail: true,
              purpose: true,
              status: true,
            },
          },
        },
      })
    },

    listByCustomer(params: {
      customerId: string
      status?: OrderStatus
      skip?: number
      take?: number
    }) {
      return prisma.order.findMany({
        where: {
          customerId: params.customerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: {
          lines: { include: { product: { include: { images: { take: 1 } } } } },
          legalSnapshot: true,
          sellerInvoices: {
            include: {
              seller: {
                select: {
                  id: true,
                  displayName: true,
                  slug: true,
                },
              },
            },
            orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
          },
          returnRequests: {
            select: { id: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 10,
      })
    },

    /** Seller queue — payment-confirmed orders only */
    listForSellerQueue(params: {
      sellerId: string
      orderIds?: string[]
      status?: OrderStatus[]
      query?: string
      from?: Date
      to?: Date
      missingInvoice?: boolean
      skip?: number
      take?: number
    }) {
      const sellerVisibleStatuses = params.status ?? [
        'seller_queue_ready',
        'seller_reviewing',
        'seller_accepted',
        'preparing',
        'awaiting_shipment',
        'shipped',
        'delivered',
        'delivery_confirmation_pending',
        'delivery_confirmed',
      ]

      const normalizedQuery = params.query?.trim()
      const createdAtFilter =
        params.from !== undefined || params.to !== undefined
          ? {
              createdAt: {
                ...(params.from !== undefined ? { gte: params.from } : {}),
                ...(params.to !== undefined ? { lte: params.to } : {}),
              },
            }
          : {}

      return prisma.order.findMany({
        where: {
          ...(params.orderIds !== undefined ? { id: { in: params.orderIds } } : {}),
          lines: { some: { sellerId: params.sellerId } },
          ...(params.missingInvoice ? { sellerInvoices: { none: { sellerId: params.sellerId } } } : {}),
          status: { in: sellerVisibleStatuses },
          ...createdAtFilter,
          ...(normalizedQuery
            ? {
                OR: [
                  { id: { contains: normalizedQuery } },
                  { customer: { name: { contains: normalizedQuery, mode: 'insensitive' } } },
                  { address: { fullName: { contains: normalizedQuery, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: {
          lines: {
            where: { sellerId: params.sellerId },
            include: { product: { include: { images: { take: 1 } } } },
          },
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          address: { select: sellerVisibleAddressSelect },
          emailAliases: {
            where: { sellerId: params.sellerId, purpose: 'invoice', status: 'active' },
            select: {
              id: true,
              aliasEmail: true,
              purpose: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    countForSellerQueue(params: {
      sellerId: string
      orderIds?: string[]
      status?: OrderStatus[]
      query?: string
      from?: Date
      to?: Date
      missingInvoice?: boolean
    }) {
      const normalizedQuery = params.query?.trim()
      const createdAtFilter =
        params.from !== undefined || params.to !== undefined
          ? {
              createdAt: {
                ...(params.from !== undefined ? { gte: params.from } : {}),
                ...(params.to !== undefined ? { lte: params.to } : {}),
              },
            }
          : {}

      return prisma.order.count({
        where: {
          ...(params.orderIds !== undefined ? { id: { in: params.orderIds } } : {}),
          lines: { some: { sellerId: params.sellerId } },
          ...(params.missingInvoice ? { sellerInvoices: { none: { sellerId: params.sellerId } } } : {}),
          ...(params.status !== undefined ? { status: { in: params.status } } : {}),
          ...createdAtFilter,
          ...(normalizedQuery
            ? {
                OR: [
                  { id: { contains: normalizedQuery } },
                  { customer: { name: { contains: normalizedQuery, mode: 'insensitive' } } },
                  { address: { fullName: { contains: normalizedQuery, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
      })
    },

    async listForAdmin(params: {
      status?: OrderStatus[]
      sellerId?: string
      customerId?: string
      query?: string
      invoice?: 'missing' | 'present'
      financeInvoice?: 'missing' | 'present'
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const where: Prisma.OrderWhereInput = {
        ...(params.status !== undefined && params.status.length > 0 ? { status: { in: params.status } } : {}),
        ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
        ...(params.sellerId !== undefined
          ? {
              lines: {
                some: {
                  sellerId: params.sellerId,
                },
              },
            }
          : {}),
        ...(params.invoice === 'missing'
          ? {
              sellerInvoices: {
                none: params.sellerId !== undefined ? { sellerId: params.sellerId } : {},
              },
            }
          : {}),
        ...(params.invoice === 'present'
          ? {
              sellerInvoices: {
                some: params.sellerId !== undefined ? { sellerId: params.sellerId } : {},
              },
            }
          : {}),
        ...(params.financeInvoice === 'missing'
          ? {
              financeInvoices: {
                none: { type: 'commission' },
              },
            }
          : {}),
        ...(params.financeInvoice === 'present'
          ? {
              financeInvoices: {
                some: { type: 'commission' },
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
                { id: { contains: normalizedQuery } },
                { customer: { name: { contains: normalizedQuery, mode: 'insensitive' } } },
                { customer: { email: { contains: normalizedQuery, mode: 'insensitive' } } },
                { address: { fullName: { contains: normalizedQuery, mode: 'insensitive' } } },
                { lines: { some: { product: { name: { contains: normalizedQuery, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            lines: {
              include: {
                product: true,
                seller: { include: { profile: true } },
              },
            },
            payments: true,
            sellerInvoices: {
              include: {
                seller: {
                  select: {
                    id: true,
                    displayName: true,
                    slug: true,
                  },
                },
              },
              orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
            },
            financeInvoices: {
              where: { type: 'commission' },
              orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
            },
            fulfillmentRisks: {
              where: { status: { in: ['warning', 'breached'] } },
              orderBy: [{ status: 'asc' }, { deadlineAt: 'asc' }],
              include: {
                orderLine: {
                  select: {
                    id: true,
                    productName: true,
                    quantity: true,
                  },
                },
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            address: true,
          },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        prisma.order.count({ where }),
      ])

      return { rows, total }
    },

    updateStatus(id: string, status: OrderStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.order.update({ where: { id }, data: { status } })
    },

    appendStatusHistory(
      orderId: string,
      toStatus: OrderStatus,
      actorId: string,
      note?: string,
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.orderStatusHistory.create({
        data: { orderId, toStatus, actorId, ...(note !== undefined ? { note } : {}) },
      })
    },

    setDeliveryConfirmed(id: string, confirmedAt: Date, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.order.update({
        where: { id },
        data: { status: 'delivery_confirmed', deliveryConfirmedAt: confirmedAt },
      })
    },

    /** Find delivered orders eligible for silent confirmation */
    findEligibleForSilentConfirmation(deliveredBefore: Date) {
      return prisma.order.findMany({
        where: {
          status: 'delivered',
          deliveredAt: { lte: deliveredBefore },
        },
        include: {
          returnRequests: { where: { status: { not: 'rejected' } } },
          disputes: { where: { status: 'open' } },
        },
      })
    },

    /** Find orders at risk of 20-day breach */
    findAtFulfillmentRisk(paymentConfirmedBefore: Date) {
      return prisma.order.findMany({
        where: {
          status: {
            in: ['seller_queue_ready', 'seller_reviewing', 'seller_accepted', 'preparing', 'awaiting_shipment'],
          },
          paymentConfirmedAt: { lte: paymentConfirmedBefore },
        },
      })
    },
  }
}

export type OrderRepository = ReturnType<typeof createOrderRepository>
