import type { FulfillmentRiskStatus, OrderStatus, PrismaClient } from '@prisma/client'
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
  sourceAt: Date
  deadlineAt: Date
  warningStartedAt: Date
  status: 'warning' | 'breached'
  daysRemaining: number
  daysOverdue: number
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function diffCalendarDays(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

export function getFulfillmentSourceDate(order: {
  paymentConfirmedAt?: Date | null
  sellerQueueReadyAt?: Date | null
  createdAt: Date
}) {
  return order.paymentConfirmedAt ?? order.sellerQueueReadyAt ?? order.createdAt
}

export function calculateFulfillmentRisk(params: {
  sourceAt: Date
  now?: Date
  fulfillmentDays: number
  warningDays: number
}): FulfillmentRiskInfo | null {
  const now = params.now ?? new Date()
  const deadlineAt = addDays(params.sourceAt, params.fulfillmentDays)
  const warningStartedAt = addDays(deadlineAt, -params.warningDays)

  if (now < warningStartedAt) return null

  const daysRemaining = diffCalendarDays(now, deadlineAt)
  const daysOverdue = Math.max(0, diffCalendarDays(deadlineAt, now))

  return {
    sourceAt: params.sourceAt,
    deadlineAt,
    warningStartedAt,
    status: now > deadlineAt ? 'breached' : 'warning',
    daysRemaining: Math.max(0, daysRemaining),
    daysOverdue,
  }
}

export function createFulfillmentRiskService({ prisma }: { prisma: PrismaClient }) {
  const settingsSvc = createPlatformSettingsService({ prisma })

  async function refreshActiveRisks(now = new Date()) {
    const settings = await settingsSvc.get()
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ACTIVE_FULFILLMENT_STATUSES },
        lines: { some: {} },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        paymentConfirmedAt: true,
        sellerQueueReadyAt: true,
        lines: { select: { sellerId: true }, take: 1 },
      },
    })

    const activeRiskOrderIds: string[] = []
    let warning = 0
    let breached = 0
    let resolved = 0

    for (const order of orders) {
      const sellerId = order.lines[0]?.sellerId
      if (!sellerId) continue

      const info = calculateFulfillmentRisk({
        sourceAt: getFulfillmentSourceDate(order),
        now,
        fulfillmentDays: settings.fulfillmentDays,
        warningDays: settings.fulfillmentWarningDays,
      })

      if (!info) continue

      activeRiskOrderIds.push(order.id)
      if (info.status === 'warning') warning++
      if (info.status === 'breached') breached++

      await prisma.fulfillmentRisk.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          sellerId,
          status: info.status,
          deadlineAt: info.deadlineAt,
          warningStartedAt: info.warningStartedAt,
          ...(info.status === 'breached' ? { breachedAt: now } : {}),
          lastSeenAt: now,
        },
        update: {
          sellerId,
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
      activeRiskOrderIds.length > 0
        ? {
            status: { in: ACTIVE_RISK_STATUSES },
            orderId: { notIn: activeRiskOrderIds },
          }
        : {
            status: { in: ACTIVE_RISK_STATUSES },
          }

    const updated = await prisma.fulfillmentRisk.updateMany({
      where: resolvedWhere,
      data: { status: 'resolved', resolvedAt: now, lastSeenAt: now },
    })
    resolved = updated.count

    return { warning, breached, resolved }
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
