import type { FulfillmentRiskStatus, OrderStatus, PrismaClient } from '@prisma/client'
import { addBusinessDays, countBusinessDaysBetween, subtractBusinessDays } from '../domain/business-days'
import { createPlatformSettingsService } from './platform-settings.service'

const ACTIVE_FULFILLMENT_STATUSES: OrderStatus[] = [
  'seller_queue_ready',
  'seller_reviewing',
  'seller_accepted',
  'preparing',
  'awaiting_shipment',
]

const ACTIVE_RISK_STATUSES: FulfillmentRiskStatus[] = ['warning', 'breached']

export interface FulfillmentRiskInfo {
  deadlineAt: Date
  warningStartedAt: Date
  status: 'warning' | 'breached'
  businessDaysRemaining: number
  businessDaysOverdue: number
}

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function getFulfillmentSourceDate(order: {
  paymentConfirmedAt?: Date | null
  sellerQueueReadyAt?: Date | null
  createdAt: Date
}) {
  return order.paymentConfirmedAt ?? order.sellerQueueReadyAt ?? order.createdAt
}

function calculateFulfillmentRisk(params: {
  deadlineAt: Date
  warningDays: number
  now?: Date
}): FulfillmentRiskInfo | null {
  const now = startOfDay(params.now ?? new Date())
  const deadlineAt = startOfDay(params.deadlineAt)
  const warningStartedAt = subtractBusinessDays(deadlineAt, params.warningDays)

  if (now.getTime() < warningStartedAt.getTime()) return null

  const businessDaysOverdue = countBusinessDaysBetween(deadlineAt, now)
  const businessDaysRemaining =
    now.getTime() > deadlineAt.getTime() ? 0 : countBusinessDaysBetween(now, deadlineAt)

  return {
    deadlineAt,
    warningStartedAt,
    status: businessDaysOverdue > 0 ? 'breached' : 'warning',
    businessDaysRemaining,
    businessDaysOverdue,
  }
}

export function createFulfillmentRiskService({ prisma }: { prisma: PrismaClient }) {
  const settingsSvc = createPlatformSettingsService({ prisma })

  async function refreshActiveRisks(now = new Date()) {
    const settings = await settingsSvc.get()
    const activeLines = await prisma.orderLine.findMany({
      where: {
        fulfilledAt: null,
        promisedFulfillmentDays: { not: null },
        order: {
          status: { in: ACTIVE_FULFILLMENT_STATUSES },
        },
      },
      select: {
        id: true,
        sellerId: true,
        productName: true,
        promisedFulfillmentDays: true,
        fulfillmentDueAt: true,
        order: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            paymentConfirmedAt: true,
            sellerQueueReadyAt: true,
          },
        },
      },
    })

    const activeRiskLineIds: string[] = []
    let warning = 0
    let breached = 0

    for (const line of activeLines) {
      const promisedFulfillmentDays = line.promisedFulfillmentDays ?? settings.fulfillmentDays
      const activeExtension = await prisma.fulfillmentExtensionRequest.findFirst({
        where: {
          orderId: line.order.id,
          sellerId: line.sellerId,
          status: 'approved',
          approvedDays: { not: null },
        },
        select: { approvedDays: true },
        orderBy: { approvedAt: 'desc' },
      })

      const baseDeadline =
        line.fulfillmentDueAt ??
        addBusinessDays(getFulfillmentSourceDate(line.order), promisedFulfillmentDays)
      const deadlineAt = activeExtension?.approvedDays
        ? addBusinessDays(baseDeadline, activeExtension.approvedDays)
        : baseDeadline

      const info = calculateFulfillmentRisk({
        deadlineAt,
        warningDays: settings.fulfillmentWarningDays,
        now,
      })

      if (!info) continue

      activeRiskLineIds.push(line.id)
      if (info.status === 'warning') warning += 1
      if (info.status === 'breached') breached += 1

      await prisma.fulfillmentRisk.upsert({
        where: { orderLineId: line.id },
        create: {
          orderId: line.order.id,
          orderLineId: line.id,
          sellerId: line.sellerId,
          status: info.status,
          deadlineAt: info.deadlineAt,
          warningStartedAt: info.warningStartedAt,
          ...(info.status === 'breached' ? { breachedAt: now } : {}),
          lastSeenAt: now,
        },
        update: {
          sellerId: line.sellerId,
          status: info.status,
          deadlineAt: info.deadlineAt,
          warningStartedAt: info.warningStartedAt,
          resolvedAt: null,
          ...(info.status === 'breached' ? { breachedAt: now } : {}),
          lastSeenAt: now,
        },
      })
    }

    const resolvedWhere =
      activeRiskLineIds.length > 0
        ? {
            status: { in: ACTIVE_RISK_STATUSES },
            OR: [
              { orderLineId: null },
              { orderLineId: { notIn: activeRiskLineIds } },
            ],
          }
        : {
            status: { in: ACTIVE_RISK_STATUSES },
          }

    const updated = await prisma.fulfillmentRisk.updateMany({
      where: resolvedWhere,
      data: { status: 'resolved', resolvedAt: now, lastSeenAt: now },
    })

    return { warning, breached, resolved: updated.count }
  }

  async function listActiveForAdmin(params?: { take?: number }) {
    await refreshActiveRisks()
    return prisma.fulfillmentRisk.findMany({
      where: { status: { in: ['warning', 'breached'] } },
      include: {
        seller: { select: { id: true, displayName: true, slug: true } },
        order: {
          select: {
            id: true,
            publicNumber: true,
            status: true,
            createdAt: true,
            paymentConfirmedAt: true,
            sellerQueueReadyAt: true,
            totalAmount: true,
          },
        },
        orderLine: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            promisedFulfillmentDays: true,
            fulfillmentDueAt: true,
            fulfilledAt: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { deadlineAt: 'asc' }],
      take: params?.take ?? 50,
    })
  }

  return {
    refreshActiveRisks,
    listActiveForAdmin,
  }
}

export type FulfillmentRiskService = ReturnType<typeof createFulfillmentRiskService>
