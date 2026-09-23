/**
 * Fulfillment risk notifications for the operations mailbox.
 *
 * One e-mail per order + seller when the risk first appears and on every level
 * change. Repeats of the same level (the job runs daily) and growing overdue day
 * counts produce nothing.
 *
 * The event id comes from a persistent transition record rather than from
 * order + seller + level, so a risk that is resolved and later recurs at the same
 * level is notifiable again.
 */
import type {
  FulfillmentRiskStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { formatMoney } from '@hanuja/security/money'
import { formatOrderNumber } from '../lib/order-number'
import { resolveEmailImageUrl } from '../lib/email-line-items'
import {
  adminPanelLink,
  recordAdminOperationNotification,
} from './admin-notification.service'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3

type ActiveLevel = Extract<FulfillmentRiskStatus, 'warning' | 'breached'>

export type RiskSweepOutcome =
  | 'notified'
  | 'unchanged'
  | 'resolved'
  | 'contended'

export interface FulfillmentRiskSweepResult {
  notified: number
  resolved: number
  unchanged: number
  contended: number
}

/** `breached` outranks `warning`; an empty group means the risk is gone. */
export function aggregateRiskLevel(
  statuses: readonly FulfillmentRiskStatus[],
): FulfillmentRiskStatus {
  if (statuses.includes('breached')) return 'breached'
  if (statuses.includes('warning')) return 'warning'
  return 'resolved'
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002'
}

function overdueDaysOf(deadlineAt: Date, asOf: Date) {
  return Math.max(0, Math.floor((asOf.getTime() - deadlineAt.getTime()) / MS_PER_DAY))
}

const RISK_INCLUDE = {
  order: { select: { id: true, publicNumber: true } },
  seller: { select: { id: true, displayName: true } },
  orderLine: {
    select: {
      productId: true,
      productName: true,
      variantName: true,
      quantity: true,
      unitPrice: true,
    },
  },
} as const

/**
 * Scans the union of (a) groups that currently carry an active risk and
 * (b) groups previously recorded as risky. Without (b) a group that dropped off
 * the active list would keep its old level for ever and a later recurrence at
 * the same level would be silently deduplicated away.
 */
export async function sweepFulfillmentRiskNotifications(
  prisma: PrismaClient,
  asOf: Date,
): Promise<FulfillmentRiskSweepResult> {
  const [activeRisks, trackedStates] = await Promise.all([
    prisma.fulfillmentRisk.findMany({
      where: { status: { in: ['warning', 'breached'] } },
      select: { orderId: true, sellerId: true },
    }),
    prisma.fulfillmentRiskNotificationState.findMany({
      where: { notifiedStatus: { not: 'resolved' } },
      select: { orderId: true, sellerId: true },
    }),
  ])

  const groups = new Map<string, { orderId: string; sellerId: string }>()
  for (const row of [...activeRisks, ...trackedStates]) {
    groups.set(`${row.orderId}|${row.sellerId}`, {
      orderId: row.orderId,
      sellerId: row.sellerId,
    })
  }

  const result: FulfillmentRiskSweepResult = {
    notified: 0,
    resolved: 0,
    unchanged: 0,
    contended: 0,
  }
  for (const group of groups.values()) {
    const outcome = await processRiskGroup(prisma, group, asOf)
    if (outcome === 'notified') result.notified += 1
    else if (outcome === 'resolved') result.resolved += 1
    else if (outcome === 'contended') result.contended += 1
    else result.unchanged += 1
  }
  return result
}

export async function processRiskGroup(
  prisma: PrismaClient,
  group: { orderId: string; sellerId: string },
  asOf: Date,
): Promise<RiskSweepOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => runRiskTransition(tx, group, asOf))
    } catch (error) {
      // A concurrent worker created the row first: the transaction is gone, so
      // the retry has to start a new one and re-read everything.
      if (attempt < MAX_ATTEMPTS && isUniqueViolation(error)) continue
      throw error
    }
  }
}

async function runRiskTransition(
  tx: Prisma.TransactionClient,
  group: { orderId: string; sellerId: string },
  asOf: Date,
): Promise<RiskSweepOutcome> {
  // Re-read inside the transaction: both the risk rows and the state row.
  const risks = await tx.fulfillmentRisk.findMany({
    where: { orderId: group.orderId, sellerId: group.sellerId },
    include: RISK_INCLUDE,
  })
  const level = aggregateRiskLevel(risks.map((risk) => risk.status))
  const state = await tx.fulfillmentRiskNotificationState.findUnique({
    where: {
      orderId_sellerId: { orderId: group.orderId, sellerId: group.sellerId },
    },
  })

  if (!state) {
    if (level === 'resolved') return 'unchanged'
    const created = await tx.fulfillmentRiskNotificationState.create({
      data: {
        orderId: group.orderId,
        sellerId: group.sellerId,
        notifiedStatus: level,
        transitionSeq: 1,
        lastNotifiedAt: asOf,
      },
    })
    await notifyRisk(tx, risks, level, created.transitionSeq, asOf)
    return 'notified'
  }

  if (state.notifiedStatus === level) return 'unchanged'

  const nextSeq =
    level === 'resolved' ? state.transitionSeq : state.transitionSeq + 1
  // Version-checked update first: the notification is only written once this
  // transition is ours, so a losing worker writes nothing at all.
  const claim = await tx.fulfillmentRiskNotificationState.updateMany({
    where: { id: state.id, version: state.version },
    data: {
      notifiedStatus: level,
      transitionSeq: nextSeq,
      version: { increment: 1 },
      ...(level === 'resolved' ? {} : { lastNotifiedAt: asOf }),
    },
  })
  if (claim.count !== 1) return 'contended'
  if (level === 'resolved') return 'resolved'

  await notifyRisk(tx, risks, level, nextSeq, asOf)
  return 'notified'
}

type RiskRow = Prisma.FulfillmentRiskGetPayload<{ include: typeof RISK_INCLUDE }>

async function notifyRisk(
  tx: Prisma.TransactionClient,
  risks: readonly RiskRow[],
  level: ActiveLevel,
  seq: number,
  asOf: Date,
) {
  const relevant = risks.filter((risk) => risk.status === level)
  const first = relevant[0] ?? risks[0]
  if (!first) return
  const orderNumber = formatOrderNumber(first.order.publicNumber, first.orderId)
  const deadlineAt = relevant.reduce<Date>(
    (earliest, risk) => (risk.deadlineAt < earliest ? risk.deadlineAt : earliest),
    first.deadlineAt,
  )
  const productIds = relevant
    .map((risk) => risk.orderLine?.productId)
    .filter((id): id is string => Boolean(id))
  const images = productIds.length
    ? await tx.productImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        select: { productId: true, url: true, isPrimary: true, sortOrder: true },
      })
    : []
  const imagesByProduct = new Map<string, typeof images>()
  for (const image of images) {
    const bucket = imagesByProduct.get(image.productId) ?? []
    bucket.push(image)
    imagesByProduct.set(image.productId, bucket)
  }

  const items = relevant
    .filter((risk) => risk.orderLine)
    .map((risk) => ({
      productName: risk.orderLine!.productName,
      variantName: risk.orderLine!.variantName,
      sellerId: risk.sellerId,
      quantity: risk.orderLine!.quantity,
      unitPrice: formatMoney(risk.orderLine!.unitPrice.toNumber()),
      lineTotal: formatMoney(
        risk.orderLine!.unitPrice.mul(risk.orderLine!.quantity).toNumber(),
      ),
      imageUrl: resolveEmailImageUrl(imagesByProduct.get(risk.orderLine!.productId)),
    }))

  const overdueDays = overdueDaysOf(deadlineAt, asOf)
  await recordAdminOperationNotification(tx, {
    event: 'fulfillment_risk',
    type: 'admin_fulfillment_risk',
    eventKey: `fulfillment-risk:${first.orderId}:${first.sellerId}:${seq}:${level}`,
    title:
      level === 'breached'
        ? 'Sevk taahhüdü aşıldı'
        : 'Sevk taahhüdü yaklaşıyor',
    body: `#${orderNumber} siparişinde sevk riski: ${level === 'breached' ? 'taahhüt aşıldı' : 'teslim tarihi yaklaşıyor'}.`,
    data: {
      orderId: first.orderId,
      orderNumber,
      riskLevel: level,
      sellerName: first.seller?.displayName ?? undefined,
      deadlineLabel: deadlineAt.toLocaleDateString('tr-TR'),
      overdueDays,
      adminUrl: adminPanelLink(`/siparisler/${first.orderId}`),
      items,
    },
  })
}
