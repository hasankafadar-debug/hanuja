import type { PaymentMethod, PaymentStatus, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createPaymentRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.payment.findUnique({
        where: { id },
        include: { events: { orderBy: { processedAt: 'asc' } } },
      })
    },

    findByOrderId(orderId: string) {
      // orderId is not @unique in schema — use findFirst (1 order : 1 payment)
      return prisma.payment.findFirst({ where: { orderId } })
    },

    findByProviderRef(providerPaymentId: string) {
      return prisma.payment.findFirst({ where: { providerPaymentId } })
    },

    create(data: {
      orderId: string
      method: PaymentMethod
      amount: Decimal
      currency?: string
      providerPaymentId?: string
    }) {
      return prisma.payment.create({ data: { currency: 'TRY', ...data } })
    },

    updateStatus(id: string, status: PaymentStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.payment.update({ where: { id }, data: { status } })
    },

    confirm(
      id: string,
      params: { providerRef?: string; confirmedBy?: string },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.payment.update({
        where: { id },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          ...(params.providerRef !== undefined
            ? { providerPaymentId: params.providerRef }
            : {}),
          ...(params.confirmedBy !== undefined
            ? { eftConfirmedBy: params.confirmedBy }
            : {}),
        },
      })
    },

    appendEvent(data: {
      paymentId: string
      eventType: string
      providerPayload?: object
      note?: string
    }) {
      return prisma.paymentEvent.create({
        data: {
          paymentId: data.paymentId,
          eventType: data.eventType,
          payload: {
            ...(data.providerPayload ?? {}),
            ...(data.note !== undefined ? { note: data.note } : {}),
          },
        },
      })
    },

    recordRefund(
      id: string,
      params: { refundAmount: Decimal; providerRefundRef?: string },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.payment.update({
        where: { id },
        data: {
          status: 'refunded' as never,
          refundedAt: new Date(),
        },
      })
    },

    /** Pending EFT/havale approvals for admin queue */
    listPendingEft() {
      return prisma.payment.findMany({
        where: { method: 'eft', status: 'pending' },
        include: { order: true },
        orderBy: { createdAt: 'asc' },
      })
    },
  }
}

export type PaymentRepository = ReturnType<typeof createPaymentRepository>
