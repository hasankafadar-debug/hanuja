import type { PrismaClient } from '@prisma/client'

export type ProductAnalyticsEventName = 'product_view' | 'cart_add' | 'favorite_add'

export interface SellerProductReportRow {
  productId: string
  name: string
  slug: string
  imageUrl: string | null
  viewedCustomerCount: number
  favoritedCustomerCount: number
  cartCustomerCount: number
  convertedCustomerCount: number
  conversionRate: number | null
}

export interface SellerProductReport {
  rows: SellerProductReportRow[]
  totals: {
    viewedCustomerCount: number
    favoritedCustomerCount: number
    cartCustomerCount: number
    convertedCustomerCount: number
  }
  topViewedProduct: SellerProductReportRow | null
}

interface ProductAnalyticsServiceDeps {
  prisma: PrismaClient
}

const CONVERTED_ORDER_STATUSES = [
  'seller_queue_ready',
  'seller_reviewing',
  'seller_accepted',
  'preparing',
  'awaiting_shipment',
  'shipped',
  'delivered',
  'delivery_confirmation_pending',
  'delivery_confirmed',
  'return_requested',
  'return_under_review',
  'return_approved',
  'return_received',
  'refund_completed',
] as const

function toUtcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function addCustomer(target: Map<string, Set<string>>, productId: string, userId?: string | null) {
  if (!userId) return
  const customers = target.get(productId) ?? new Set<string>()
  customers.add(userId)
  target.set(productId, customers)
}

function countCustomers(target: Map<string, Set<string>>, productId: string) {
  return target.get(productId)?.size ?? 0
}

export function createProductAnalyticsService({ prisma }: ProductAnalyticsServiceDeps) {
  return {
    async recordProductEvent(params: {
      productId: string
      userId: string
      eventType: ProductAnalyticsEventName
      occurredAt?: Date
    }) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { role: true },
      })

      if (user?.role !== 'customer') {
        return { recorded: false }
      }

      const product = await prisma.product.findUnique({
        where: { id: params.productId },
        select: { id: true, sellerId: true, status: true },
      })

      if (!product || product.status !== 'published') {
        return { recorded: false }
      }

      const eventDate = toUtcDateOnly(params.occurredAt ?? new Date())

      await prisma.productAnalyticsEvent.upsert({
        where: {
          productId_userId_eventType_eventDate: {
            productId: product.id,
            userId: params.userId,
            eventType: params.eventType,
            eventDate,
          },
        },
        update: {},
        create: {
          productId: product.id,
          sellerId: product.sellerId,
          userId: params.userId,
          eventType: params.eventType,
          eventDate,
        },
      })

      return { recorded: true }
    },

    async getSellerProductReport(params: {
      sellerId: string
      from: Date
      to: Date
    }): Promise<SellerProductReport> {
      const from = new Date(params.from)
      from.setUTCHours(0, 0, 0, 0)

      const to = new Date(params.to)
      to.setUTCHours(23, 59, 59, 999)

      const eventFrom = toUtcDateOnly(from)
      const eventTo = toUtcDateOnly(to)

      const products = await prisma.product.findMany({
        where: { sellerId: params.sellerId },
        select: {
          id: true,
          name: true,
          slug: true,
          images: {
            select: { url: true },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      })

      if (products.length === 0) {
        return {
          rows: [],
          totals: {
            viewedCustomerCount: 0,
            favoritedCustomerCount: 0,
            cartCustomerCount: 0,
            convertedCustomerCount: 0,
          },
          topViewedProduct: null,
        }
      }

      const productIds = products.map((product) => product.id)

      const [events, favorites, cartItems, orderLines] = await Promise.all([
        prisma.productAnalyticsEvent.findMany({
          where: {
            sellerId: params.sellerId,
            eventDate: { gte: eventFrom, lte: eventTo },
          },
          select: {
            productId: true,
            userId: true,
            eventType: true,
          },
        }),
        prisma.favoriteProduct.findMany({
          where: {
            productId: { in: productIds },
            createdAt: { gte: from, lte: to },
          },
          select: {
            productId: true,
            userId: true,
          },
        }),
        prisma.cartItem.findMany({
          where: {
            productId: { in: productIds },
            createdAt: { gte: from, lte: to },
            cart: { userId: { not: null } },
          },
          select: {
            productId: true,
            cart: { select: { userId: true } },
          },
        }),
        prisma.orderLine.findMany({
          where: {
            sellerId: params.sellerId,
            productId: { in: productIds },
            order: {
              createdAt: { gte: from, lte: to },
              status: { in: [...CONVERTED_ORDER_STATUSES] },
            },
          },
          select: {
            productId: true,
            order: { select: { customerId: true } },
          },
        }),
      ])

      const viewedCustomers = new Map<string, Set<string>>()
      const favoritedCustomers = new Map<string, Set<string>>()
      const cartCustomers = new Map<string, Set<string>>()
      const convertedCustomers = new Map<string, Set<string>>()

      for (const event of events) {
        if (event.eventType === 'product_view') {
          addCustomer(viewedCustomers, event.productId, event.userId)
        } else if (event.eventType === 'favorite_add') {
          addCustomer(favoritedCustomers, event.productId, event.userId)
        } else if (event.eventType === 'cart_add') {
          addCustomer(cartCustomers, event.productId, event.userId)
        }
      }

      for (const favorite of favorites) {
        addCustomer(favoritedCustomers, favorite.productId, favorite.userId)
      }

      for (const item of cartItems) {
        addCustomer(cartCustomers, item.productId, item.cart.userId)
      }

      for (const line of orderLines) {
        addCustomer(convertedCustomers, line.productId, line.order.customerId)
      }

      const rows = products
        .map<SellerProductReportRow>((product) => {
          const viewedCustomerCount = countCustomers(viewedCustomers, product.id)
          const convertedCustomerCount = countCustomers(convertedCustomers, product.id)

          return {
            productId: product.id,
            name: product.name,
            slug: product.slug,
            imageUrl: product.images[0]?.url ?? null,
            viewedCustomerCount,
            favoritedCustomerCount: countCustomers(favoritedCustomers, product.id),
            cartCustomerCount: countCustomers(cartCustomers, product.id),
            convertedCustomerCount,
            conversionRate:
              viewedCustomerCount > 0 ? convertedCustomerCount / viewedCustomerCount : null,
          }
        })
        .sort((left, right) => (
          right.viewedCustomerCount - left.viewedCustomerCount ||
          right.convertedCustomerCount - left.convertedCustomerCount ||
          left.name.localeCompare(right.name, 'tr')
        ))

      const totals = rows.reduce(
        (acc, row) => ({
          viewedCustomerCount: acc.viewedCustomerCount + row.viewedCustomerCount,
          favoritedCustomerCount: acc.favoritedCustomerCount + row.favoritedCustomerCount,
          cartCustomerCount: acc.cartCustomerCount + row.cartCustomerCount,
          convertedCustomerCount: acc.convertedCustomerCount + row.convertedCustomerCount,
        }),
        {
          viewedCustomerCount: 0,
          favoritedCustomerCount: 0,
          cartCustomerCount: 0,
          convertedCustomerCount: 0,
        },
      )

      return {
        rows,
        totals,
        topViewedProduct: rows.find((row) => row.viewedCustomerCount > 0) ?? null,
      }
    },
  }
}

export type ProductAnalyticsService = ReturnType<typeof createProductAnalyticsService>
