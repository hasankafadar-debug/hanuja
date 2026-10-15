import { sellerOrderStatusWhere, sellerOperationalStatus } from '../lib/seller-order-status'
import type { OrderStatus, Prisma, PrismaClient } from '@prisma/client'
import { toSellerSafeLegalSnapshot } from '../lib/seller-legal-snapshot'

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

// Satıcı Hanuja modeli: satıcı faturasını Hanuja'ya keser, müşterinin fatura kimliğine
// (TC/VKN, kurumsal bilgiler) ihtiyacı yoktur; yalnız teslimat bilgisi görünür.

const customerInvoiceSummarySelect = {
  id: true,
  invoiceNumber: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
} satisfies Prisma.OrderCustomerInvoiceSelect

/**
 * Sellers only ever see orders whose payment was collected. Status alone is not
 * enough: an unpaid EFT order the customer cancelled ends in the same
 * `cancelled_*` status as a paid one. `confirmedAt` survives a later refund.
 */
export const SELLER_VISIBLE_PAYMENT_WHERE = {
  OR: [
    { paymentConfirmedAt: { not: null } },
    { payments: { some: { confirmedAt: { not: null } } } },
  ],
} satisfies Prisma.OrderWhereInput

const sellerVisibleLegalSnapshotSelect = {
  distanceSalesHtml: true,
  preInformationHtml: true,
} satisfies Prisma.OrderLegalSnapshotSelect

export function createOrderRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.order.findUnique({
        where: { id },
        include: {
          lines: { include: { product: true } },
          payments: true,
          shipments: true,
          sellerFulfillments: true,
          cancellations: {
            include: { items: true },
            orderBy: { createdAt: 'desc' },
          },
          refundTransactions: { orderBy: { createdAt: 'desc' } },
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
          shipments: { include: { items: true } },
          sellerFulfillments: true,
          cancellations: {
            include: { items: true },
            orderBy: { createdAt: 'desc' },
          },
          refundTransactions: { orderBy: { createdAt: 'desc' } },
          address: true,
          legalSnapshot: true,
          customerInvoice: { select: customerInvoiceSummarySelect },
          returnRequests: {
            select: {
              id: true,
              status: true,
              reviewedAt: true,
              sellerRejectedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })
    },

    /** Seller sees only payment_confirmed+ orders for their products */
    async findByIdForSeller(id: string, sellerId: string) {
      const order = await prisma.order.findUnique({
        where: {
          id,
          lines: { some: { sellerId } },
          AND: [SELLER_VISIBLE_PAYMENT_WHERE],
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
          shipments: { where: { sellerId }, include: { items: true } },
          sellerFulfillments: { where: { sellerId } },
          cancellations: {
            where: { sellerId },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
          },
          address: { select: sellerVisibleAddressSelect },
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          statusHistory: { orderBy: { createdAt: 'asc' } },
          legalSnapshot: { select: sellerVisibleLegalSnapshotSelect },
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
        },
      })

      if (!order?.legalSnapshot) return order

      return {
        ...order,
        legalSnapshot: toSellerSafeLegalSnapshot(order.legalSnapshot),
      }
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
          customerInvoice: { select: customerInvoiceSummarySelect },
          returnRequests: {
            select: {
              id: true,
              status: true,
              reviewedAt: true,
              sellerRejectedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 10,
      })
    },

    /** Seller queue — payment-confirmed orders only */
    async listForSellerQueue(params: {
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

      const rows = await prisma.order.findMany({
        where: {
          ...(params.orderIds !== undefined ? { id: { in: params.orderIds } } : {}),
          lines: { some: { sellerId: params.sellerId } },
          AND: [
            SELLER_VISIBLE_PAYMENT_WHERE,
            sellerOrderStatusWhere(params.sellerId, sellerVisibleStatuses),
          ],
          ...(params.missingInvoice
            ? { sellerInvoices: { none: { sellerId: params.sellerId } } }
            : {}),
          ...createdAtFilter,
          ...(normalizedQuery
            ? {
                OR: [
                  { id: { contains: normalizedQuery } },
                  {
                    customer: {
                      name: { contains: normalizedQuery, mode: 'insensitive' },
                    },
                  },
                  {
                    address: {
                      fullName: {
                        contains: normalizedQuery,
                        mode: 'insensitive',
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        include: {
          sellerFulfillments: { where: { sellerId: params.sellerId }, select: { status: true } },
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
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
      return rows.map((order) => ({
        ...order,
        sellerOperationalStatus:
          order.quantityLifecycleVersion === 2 && order.sellerFulfillments[0]
            ? sellerOperationalStatus(order.sellerFulfillments[0].status)
            : order.status,
      }))
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
          AND: [
            SELLER_VISIBLE_PAYMENT_WHERE,
            sellerOrderStatusWhere(params.sellerId, params.status),
          ],
          ...(params.missingInvoice
            ? { sellerInvoices: { none: { sellerId: params.sellerId } } }
            : {}),
          ...createdAtFilter,
          ...(normalizedQuery
            ? {
                OR: [
                  { id: { contains: normalizedQuery } },
                  {
                    customer: {
                      name: { contains: normalizedQuery, mode: 'insensitive' },
                    },
                  },
                  {
                    address: {
                      fullName: {
                        contains: normalizedQuery,
                        mode: 'insensitive',
                      },
                    },
                  },
                ],
              }
            : {}),
        },
      })
    },

    async listForAdmin(params: {
      orderedOrderIds?: string[]
      status?: OrderStatus[]
      sellerId?: string
      customerId?: string
      query?: string
      invoice?: 'missing' | 'present'
      customerInvoice?: 'missing' | 'present'
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const where: Prisma.OrderWhereInput = {
        ...(params.orderedOrderIds !== undefined ? { id: { in: params.orderedOrderIds } } : {}),
        ...(params.status !== undefined && params.status.length > 0
          ? { status: { in: params.status } }
          : {}),
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
        // Hanuja's customer invoice is due once the goods are handed to the carrier.
        ...(params.customerInvoice === 'missing'
          ? {
              customerInvoice: null,
              shipments: { some: { handedAt: { not: null } } },
            }
          : {}),
        ...(params.customerInvoice === 'present' ? { customerInvoice: { isNot: null } } : {}),
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
                {
                  customer: {
                    name: { contains: normalizedQuery, mode: 'insensitive' },
                  },
                },
                {
                  customer: {
                    email: { contains: normalizedQuery, mode: 'insensitive' },
                  },
                },
                {
                  address: {
                    fullName: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                },
                {
                  lines: {
                    some: {
                      product: {
                        name: {
                          contains: normalizedQuery,
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      }

      // Apply all filters before paginating the externally ranked overdue queue.
      // Sorting only one createdAt page would hide the longest-waiting orders.
      const rank = new Map(params.orderedOrderIds?.map((id, index) => [id, index]))
      const matchingIds =
        params.orderedOrderIds !== undefined
          ? (await prisma.order.findMany({ where, select: { id: true } }))
              .map((row) => row.id)
              .sort((a, b) => rank.get(a)! - rank.get(b)!)
          : undefined
      const pageIds = matchingIds?.slice(params.skip ?? 0, (params.skip ?? 0) + (params.take ?? 20))

      const [rows, total] = await Promise.all([
        prisma.order.findMany({
          where: pageIds !== undefined ? { AND: [where, { id: { in: pageIds } }] } : where,
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
            customerInvoice: { select: { id: true, invoiceNumber: true } },
            shipments: { select: { sellerId: true, handedAt: true } },
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
          ...(pageIds === undefined && params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        matchingIds !== undefined
          ? Promise.resolve(matchingIds.length)
          : prisma.order.count({ where }),
      ])

      if (matchingIds !== undefined) rows.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
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
        data: {
          orderId,
          toStatus,
          actorId,
          ...(note !== undefined ? { note } : {}),
        },
      })
    },

    setDeliveryConfirmed(id: string, confirmedAt: Date, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.order.update({
        where: { id },
        data: {
          status: 'delivery_confirmed',
          deliveryConfirmedAt: confirmedAt,
        },
      })
    },

    /** Find orders at risk of 20-day breach */
    findAtFulfillmentRisk(paymentConfirmedBefore: Date) {
      return prisma.order.findMany({
        where: {
          status: {
            in: [
              'seller_queue_ready',
              'seller_reviewing',
              'seller_accepted',
              'preparing',
              'awaiting_shipment',
            ],
          },
          paymentConfirmedAt: { lte: paymentConfirmedBefore },
        },
      })
    },
  }
}

export type OrderRepository = ReturnType<typeof createOrderRepository>
