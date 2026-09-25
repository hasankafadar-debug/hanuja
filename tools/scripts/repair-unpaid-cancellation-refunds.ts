/**
 * Repairs refunds that were created for orders that never collected a payment.
 *
 * Before the fix in 2026-09, cancelling an EFT order before the admin confirmed
 * the transfer queued a refund anyway: a `manual_required` RefundTransaction
 * (shown in "Manuel iade bekleyen"), a negative seller ledger entry, a pending
 * payment left in the EFT approval queue and a cancellation e-mail to the
 * seller. Nothing was collected, so none of it should exist.
 *
 * Default mode is read-only. `--apply` requires `--actor <adminUserId>` and
 * `--reason "..."`. Per refund, in one transaction:
 *   - every ledger row of the refund gets an exact reversal; both are hidden
 *     from the seller statement (nothing is deleted, the balance chain stays)
 *   - the refund and its items become `voided`
 *   - the cancellation record owes no refund (amounts 0, status completed)
 *   - a still-pending payment is closed as `cancelled`
 *   - a status the later EFT rejection overwrote returns to the customer
 *     cancellation it replaced
 *   - the seller's in-app cancellation notification is removed
 *   - an admin audit entry keeps every previous value
 *
 * Usage:
 *   pnpm refund:repair-unpaid
 *   pnpm refund:repair-unpaid --apply --actor <adminUserId> --reason "..."
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createSellerLedgerRepository } from '../../api/repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../../api/repositories/admin-audit-log.repository'
import { lockSellerFinance } from '../../api/lib/seller-finance-lock'
import { formatOrderNumber } from '../../api/lib/order-number'

const VOID_REASON = 'Geçersiz: ödemesi tahsil edilmemiş siparişin iptalinde hatalı oluşturuldu'
const REVERSAL_DESCRIPTION =
  'Düzeltme: ödemesi alınmamış sipariş iptalinde hatalı yazılan kayıt geri alındı'
const STATUS_RESTORE_NOTE =
  'Düzeltme: sipariş müşteri tarafından iptal edilmişti; sonradan yapılan ödeme reddi durumu geri alındı'
const REVERSAL_EVENT_PREFIX = 'refund-void:'

/** Refund rows of cancellations whose order never confirmed any payment. */
export async function findUnpaidCancellationRefunds(prisma: PrismaClient) {
  return prisma.refundTransaction.findMany({
    where: {
      sourceType: 'cancellation',
      paymentId: null,
      status: { not: 'voided' },
      order: {
        is: {
          payments: { some: {}, none: { confirmedAt: { not: null } } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
}

async function loadRepairContext(client: Prisma.TransactionClient | PrismaClient, refundId: string) {
  const refund = await client.refundTransaction.findUniqueOrThrow({
    where: { id: refundId },
    include: {
      items: true,
      order: {
        select: {
          id: true,
          publicNumber: true,
          status: true,
          cancellationReason: true,
          refundedShippingAmount: true,
          payments: { select: { id: true, method: true, status: true, confirmedAt: true } },
          statusHistory: {
            orderBy: { createdAt: 'asc' },
            select: { toStatus: true, createdAt: true },
          },
          lines: {
            select: { id: true, productName: true, quantity: true, cancelledQuantity: true },
          },
        },
      },
    },
  })
  const ledgerEntries = await client.sellerLedgerEntry.findMany({
    where: { referenceType: 'refund_transaction', referenceId: refund.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const originals = ledgerEntries.filter(
    (entry) => !entry.eventKey?.startsWith(REVERSAL_EVENT_PREFIX),
  )
  const reversedIds = new Set(
    ledgerEntries
      .filter((entry) => entry.eventKey?.startsWith(REVERSAL_EVENT_PREFIX))
      .map((entry) => entry.eventKey!.slice(REVERSAL_EVENT_PREFIX.length)),
  )
  const cancellation = await client.orderCancellation.findUnique({
    where: { id: refund.sourceId },
    include: { items: true },
  })
  const restoreStatus =
    refund.order.status === 'cancelled_due_to_payment_failure' &&
    refund.order.statusHistory.some((entry) => entry.toStatus === 'cancelled_by_customer')
  return { refund, originals, reversedIds, cancellation, restoreStatus }
}

/** Human-readable dry-run of one refund; also lists the order's e-mail records. */
export async function describeRepair(prisma: PrismaClient, refundId: string) {
  const { refund, originals, reversedIds, cancellation, restoreStatus } =
    await loadRepairContext(prisma, refundId)
  const seller = refund.sellerId
    ? await prisma.seller.findUnique({
        where: { id: refund.sellerId },
        select: { displayName: true },
      })
    : null
  const outbox = await prisma.notificationOutbox.findMany({
    where: {
      OR: [
        { eventKey: { contains: refund.orderId } },
        { eventKey: { startsWith: `cancellation:${refund.sourceId}:` } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { eventKey: true, type: true, status: true, createdAt: true },
  })
  const deliveries = await prisma.notificationDelivery.findMany({
    where: { eventKey: { in: outbox.map((row) => row.eventKey) } },
    select: { eventKey: true, channel: true, status: true, recipient: true },
  })
  return {
    order: formatOrderNumber(refund.order.publicNumber, refund.order.id),
    orderId: refund.orderId,
    orderStatus: refund.order.status,
    restoreStatusTo: restoreStatus ? 'cancelled_by_customer' : null,
    seller: seller?.displayName ?? refund.sellerId,
    refund: {
      id: refund.id,
      status: refund.status,
      customerAmount: refund.customerAmount.toFixed(2),
      grossProductAmount: refund.grossProductAmount.toFixed(2),
      items: refund.items.map((item) => `${item.kind} ${item.amount.toFixed(2)} ${item.status}`),
    },
    ledgerToReverse: originals
      .filter((entry) => !reversedIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount.toFixed(2),
        visibleToSeller: entry.visibleToSeller,
        description: entry.description,
      })),
    cancellation: cancellation
      ? {
          id: cancellation.id,
          status: cancellation.status,
          customerRefundAmount: cancellation.customerRefundAmount.toFixed(2),
          shippingRefundAmount: cancellation.shippingRefundAmount.toFixed(2),
        }
      : null,
    payments: refund.order.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      status: payment.status,
      action: payment.status === 'pending' ? 'cancelled yapılacak' : 'değişmeyecek',
    })),
    lines: refund.order.lines.map(
      (line) => `${line.productName}: ${line.cancelledQuantity}/${line.quantity} iptal (stoğa dokunulmaz)`,
    ),
    notifications: outbox.map((row) => ({
      eventKey: row.eventKey,
      type: row.type,
      outboxStatus: row.status,
      deliveries: deliveries
        .filter((delivery) => delivery.eventKey === row.eventKey)
        .map((delivery) => `${delivery.channel}:${delivery.status}`),
    })),
  }
}

export async function applyRepair(
  prisma: PrismaClient,
  refundId: string,
  options: { actorId: string; reason: string },
) {
  return prisma.$transaction(
    async (tx) => {
      const first = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: refundId },
        select: { sellerId: true },
      })
      if (first.sellerId) await lockSellerFinance(tx, [first.sellerId])
      const { refund, originals, reversedIds, cancellation, restoreStatus } =
        await loadRepairContext(tx, refundId)
      if (refund.status === 'voided') return { refundId, skipped: true as const }
      // Re-checked under the lock: a confirmed payment means this refund is real.
      if (refund.paymentId || refund.order.payments.some((payment) => payment.confirmedAt)) {
        throw new Error(`Refund ${refund.id}: sipariş tahsil edilmiş; onarım kapsamında değil`)
      }

      const ledger = createSellerLedgerRepository(tx)
      const reversals = []
      for (const entry of originals) {
        if (reversedIds.has(entry.id)) continue
        reversals.push(
          await ledger.createEntry(
            {
              sellerId: entry.sellerId,
              type: entry.type,
              amount: entry.amount.negated(),
              eventKey: `${REVERSAL_EVENT_PREFIX}${entry.id}`,
              effectiveAt: entry.effectiveAt,
              referenceType: 'refund_transaction',
              referenceId: refund.id,
              description: REVERSAL_DESCRIPTION,
              createdBy: options.actorId,
              visibleToSeller: false,
            },
            tx,
          ),
        )
      }
      await tx.sellerLedgerEntry.updateMany({
        where: { id: { in: originals.map((entry) => entry.id) } },
        data: { visibleToSeller: false },
      })

      await tx.refundTransaction.update({
        where: { id: refund.id },
        data: { status: 'voided', failureReason: VOID_REASON },
      })
      await tx.refundTransactionItem.updateMany({
        where: { refundTransactionId: refund.id },
        data: { status: 'voided', failureReason: VOID_REASON },
      })

      if (cancellation) {
        await tx.orderCancellation.update({
          where: { id: cancellation.id },
          data: {
            status: 'completed',
            customerRefundAmount: 0,
            sellerAdjustmentAmount: 0,
            commissionAdjustmentAmount: 0,
            couponAdjustmentAmount: 0,
            shippingRefundAmount: 0,
          },
        })
        await tx.orderCancellationItem.updateMany({
          where: { cancellationId: cancellation.id },
          data: {
            customerRefundAmount: 0,
            sellerAdjustmentAmount: 0,
            commissionAdjustmentAmount: 0,
            couponAdjustmentAmount: 0,
          },
        })
        if (cancellation.shippingRefundAmount.gt(0)) {
          await tx.order.update({
            where: { id: refund.orderId },
            data: { refundedShippingAmount: { decrement: cancellation.shippingRefundAmount } },
          })
        }
      }

      const pending = refund.order.payments.filter((payment) => payment.status === 'pending')
      if (pending.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: pending.map((payment) => payment.id) }, status: 'pending' },
          data: { status: 'cancelled' },
        })
        for (const payment of pending) {
          await tx.paymentEvent.create({
            data: {
              paymentId: payment.id,
              eventType: 'cancelled_before_confirmation',
              payload: { repair: true, refundId: refund.id, actorId: options.actorId },
            },
          })
        }
      }

      if (restoreStatus) {
        await tx.order.update({
          where: { id: refund.orderId },
          data: { status: 'cancelled_by_customer', cancellationReason: 'customer_requested' },
        })
        await tx.orderStatusHistory.create({
          data: {
            orderId: refund.orderId,
            fromStatus: 'cancelled_due_to_payment_failure',
            toStatus: 'cancelled_by_customer',
            actorId: options.actorId,
            reason: STATUS_RESTORE_NOTE,
          },
        })
      }

      // The seller never saw this order; drop its in-app cancellation notice.
      // The e-mail delivery log stays (the relation is SET NULL).
      const sellerDeliveries = await tx.notificationDelivery.findMany({
        where: { eventKey: `cancellation:${refund.sourceId}:seller`, notificationId: { not: null } },
        select: { notificationId: true },
      })
      const notificationIds = sellerDeliveries.map((delivery) => delivery.notificationId!)
      if (notificationIds.length > 0) {
        await tx.notification.deleteMany({ where: { id: { in: notificationIds } } })
      }

      await createAdminAuditLogRepository(tx).createEntry({
        actorId: options.actorId,
        actionType: 'manual_ledger_adjustment',
        targetType: 'refund_transaction',
        targetId: refund.id,
        previousData: {
          refundStatus: refund.status,
          customerAmount: refund.customerAmount.toFixed(2),
          grossProductAmount: refund.grossProductAmount.toFixed(2),
          orderStatus: refund.order.status,
          payments: refund.order.payments.map((payment) => ({
            id: payment.id,
            status: payment.status,
          })),
          ledgerEntries: originals.map((entry) => ({
            id: entry.id,
            type: entry.type,
            amount: entry.amount.toFixed(2),
            visibleToSeller: entry.visibleToSeller,
          })),
          cancellation: cancellation
            ? {
                id: cancellation.id,
                status: cancellation.status,
                customerRefundAmount: cancellation.customerRefundAmount.toFixed(2),
                sellerAdjustmentAmount: cancellation.sellerAdjustmentAmount.toFixed(2),
                commissionAdjustmentAmount: cancellation.commissionAdjustmentAmount.toFixed(2),
                couponAdjustmentAmount: cancellation.couponAdjustmentAmount.toFixed(2),
                shippingRefundAmount: cancellation.shippingRefundAmount.toFixed(2),
              }
            : null,
          removedSellerNotificationIds: notificationIds,
        },
        newData: {
          refundStatus: 'voided',
          reversalEntryIds: reversals.map((entry) => entry.id),
          orderStatus: restoreStatus ? 'cancelled_by_customer' : refund.order.status,
          cancelledPaymentIds: pending.map((payment) => payment.id),
        },
        reason: options.reason,
      })

      return {
        refundId: refund.id,
        skipped: false as const,
        reversed: reversals.length,
        netLedger: originals
          .reduce((sum, entry) => sum.add(entry.amount), new Decimal(0))
          .add(reversals.reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)))
          .toFixed(2),
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  )
}

function readArg(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const { default: prisma } = await import('../../api/lib/prisma')
  const args = process.argv.slice(2)
  const unknown: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--actor' || arg === '--reason') index++
    else if (arg !== '--apply') unknown.push(arg)
  }
  if (unknown.length > 0) throw new Error(`Desteklenmeyen argüman: ${unknown.join(', ')}`)
  const apply = process.argv.includes('--apply')
  try {
    const targets = await findUnpaidCancellationRefunds(prisma)
    console.log(`\nÖdemesi alınmamış siparişlere ait iade kaydı: ${targets.length}\n`)
    for (const target of targets) {
      console.log(JSON.stringify(await describeRepair(prisma, target.id), null, 2))
    }
    if (!apply) {
      console.log('\nDRY-RUN — hiçbir kayıt değiştirilmedi. Uygulamak için --apply --actor --reason verin.\n')
      return
    }
    const actorId = readArg('--actor')
    const reason = readArg('--reason')?.trim()
    if (!actorId) throw new Error('--apply için --actor <adminUserId> zorunlu')
    if (!reason || reason.length < 10) throw new Error('--reason en az 10 karakter olmalı')
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } })
    if (actor?.role !== 'admin') throw new Error('--actor bir admin kullanıcı olmalı')
    for (const target of targets) {
      console.log(JSON.stringify(await applyRepair(prisma, target.id, { actorId, reason })))
    }
    console.log('\nOK — onarım uygulandı.\n')
  } catch (error) {
    console.error(`\nFAIL — ${String(error)}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
