/**
 * Payout Service — payout hold activation, readiness check, release.
 *
 * INVARIANTS:
 * - Payout countdown starts from delivery_confirmed ONLY.
 * - 30-day hold is mandatory after delivery_confirmed.
 * - Open return or dispute BLOCKS payout — no exceptions without admin override.
 * - All payout state changes are auditable.
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, PayoutBlockedError, ConflictError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createSellerRepository } from '../repositories/seller.repository'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { calculateHoldUntil, isHoldExpired, sumPayoutSnapshot } from '../domain/payout-calculator'

interface PayoutServiceDeps {
  prisma: PrismaClient
}

export function createPayoutService({ prisma }: PayoutServiceDeps) {
  const payouts = createPayoutRepository(prisma)
  const sellers = createSellerRepository(prisma)
  const returnRequests = createReturnRequestRepository(prisma)
  const disputes = createDisputeRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    async activateHold(params: { orderId: string; deliveryConfirmedAt: Date }) {
      return prisma.$transaction(
        async (tx) => {
          const owners = await tx.orderLine.findMany({
            where: { orderId: params.orderId },
            select: { sellerId: true },
          })
          await lockSellerFinance(
            tx,
            owners.map((line) => line.sellerId),
          )
          const order = await tx.order.findUnique({
            where: { id: params.orderId },
          })
          if (!order) throw new NotFoundError('Order', params.orderId)
          const lines = await tx.orderLine.findMany({
            where: { orderId: params.orderId },
          })
          if (!lines.length) throw new ConflictError('Sipariş kalemleri bulunamadı')
          const payouts = createPayoutRepository(tx)
          const ledger = createSellerLedgerRepository(tx)

          const holdUntil = calculateHoldUntil(params.deliveryConfirmedAt)
          const sellerIds = [...new Set(lines.map((line) => line.sellerId))]
          const existingPayouts = await payouts.findManyByOrderId(params.orderId)
          const created = []
          const zero = new Decimal(0)

          for (const sellerId of sellerIds) {
            const sellerLines = lines.filter((line) => line.sellerId === sellerId)
            const snapshotTotals = sumPayoutSnapshot(sellerLines)
            // RefundTransaction is the accounting source for cancellations,
            // returns and disputes. An operation not queued yet is deducted by
            // queue() when it commits; counting its source row here would double it.
            const accountedRefunds = await tx.refundTransaction.findMany({
              where: {
                orderId: params.orderId,
                sellerId,
                accountingAppliedAt: { not: null },
                payoutAppliedAt: null,
              },
              select: {
                id: true,
                grossProductAmount: true,
                couponAdjustmentAmount: true,
                sellerAdjustmentAmount: true,
                commissionAdjustmentAmount: true,
              },
            })
            const refundedCommissionAmount = accountedRefunds.reduce(
              (sum, refund) => sum.add(refund.commissionAdjustmentAmount),
              new Decimal(0),
            )
            const refundedCouponAmount = accountedRefunds.reduce(
              (sum, refund) => sum.add(refund.couponAdjustmentAmount),
              new Decimal(0),
            )
            const refundedGrossAmount = accountedRefunds.reduce((sum, refund) => {
              const gross = refund.grossProductAmount.gt(0)
                ? refund.grossProductAmount
                : refund.sellerAdjustmentAmount
                    .add(refund.commissionAdjustmentAmount)
                    .add(refund.couponAdjustmentAmount)
              return sum.add(gross)
            }, new Decimal(0))
            const grossAmount = snapshotTotals.grossAmount
            const commissionAmount = Decimal.max(
              zero,
              snapshotTotals.commissionAmount.sub(refundedCommissionAmount),
            )
            const couponShareAmount = Decimal.max(
              zero,
              snapshotTotals.couponShareAmount.sub(refundedCouponAmount),
            )
            const cargoChargeAmount = zero
            const adFeeAmount = zero
            const penaltyAmount = zero
            const refundAmount = refundedGrossAmount
            const adjustmentAmount = zero
            const netAmount = Decimal.max(
              zero,
              grossAmount.sub(refundAmount).sub(commissionAmount).sub(couponShareAmount),
            )

            const existingPayout = existingPayouts.find((payout) => payout.sellerId === sellerId)
            const payout =
              existingPayout ??
              (await payouts.create({
                sellerId,
                orderId: params.orderId,
                grossAmount,
                commissionAmount,
                couponShareAmount,
                cargoChargeAmount,
                adFeeAmount,
                penaltyAmount,
                refundAmount,
                adjustmentAmount,
                netAmount,
                holdStartedAt: params.deliveryConfirmedAt,
                holdUntil,
              }))
            const saleEntry = await ledger.findByReference({
              sellerId,
              type: 'sale',
              referenceType: 'order',
              referenceId: params.orderId,
            })
            if (!saleEntry) {
              await ledger.createEntry({
                sellerId,
                type: 'sale',
                amount: grossAmount,
                eventKey: `payment-confirmed:sale:${params.orderId}:${sellerId}`,
                effectiveAt: order.paymentConfirmedAt ?? params.deliveryConfirmedAt,
                referenceType: 'order',
                referenceId: params.orderId,
                description: 'Ödemesi onaylanan brüt ürün satışı',
                visibleToSeller: true,
              })
            }

            if (snapshotTotals.couponShareAmount.gt(0)) {
              const couponEntry = await ledger.findByReference({
                sellerId,
                type: 'coupon_share',
                referenceType: 'order',
                referenceId: params.orderId,
              })
              if (!couponEntry) {
                await ledger.createEntry({
                  sellerId,
                  type: 'coupon_share',
                  amount: snapshotTotals.couponShareAmount.negated(),
                  eventKey: `payment-confirmed:coupon-share:${params.orderId}:${sellerId}`,
                  effectiveAt: order.paymentConfirmedAt ?? params.deliveryConfirmedAt,
                  referenceType: 'order',
                  referenceId: params.orderId,
                  description: 'Satıcı tarafından karşılanan kupon payı',
                  visibleToSeller: true,
                })
              }
            }

            const commissionEntry = await ledger.findByReference({
              sellerId,
              type: 'commission',
              referenceType: 'payout',
              referenceId: payout.id,
            })
            // A later refund may have lowered the payout commission. Restore the
            // original debit only when matching reversal credits already exist.
            const reversals =
              existingPayout && !commissionEntry
                ? await tx.sellerLedgerEntry.aggregate({
                    where: {
                      sellerId,
                      type: 'commission',
                      referenceType: 'refund_transaction',
                      referenceId: {
                        in: (
                          await tx.refundTransaction.findMany({
                            where: { orderId: params.orderId, sellerId },
                            select: { id: true },
                          })
                        ).map((refund) => refund.id),
                      },
                    },
                    _sum: { amount: true },
                  })
                : null
            const missingCommission = payout.commissionAmount.plus(reversals?._sum.amount ?? zero)
            if (!commissionEntry && missingCommission.gt(0)) {
              await ledger.createEntry({
                sellerId,
                type: 'commission',
                amount: missingCommission.negated(),
                eventKey: `payout:commission:${payout.id}`,
                effectiveAt: payout.holdStartedAt ?? params.deliveryConfirmedAt,
                referenceType: 'payout',
                referenceId: payout.id,
                description: 'Platform komisyonu (fatura kesilince satıcı ekstresinde görünür)',
                visibleToSeller: payout.status === 'payout_paid',
              })
            }

            if (!existingPayout && accountedRefunds.length > 0) {
              await tx.refundTransaction.updateMany({
                where: {
                  id: {
                    in: accountedRefunds.map((refund) => refund.id),
                  },
                  payoutAppliedAt: null,
                },
                data: { payoutAppliedAt: new Date() },
              })
            }

            created.push(payout)
          }

          return created
        },
        { timeout: 30_000 },
      )
    },

    async checkReadiness(payoutId: string) {
      const payout = await payouts.findById(payoutId)
      if (!payout) throw new NotFoundError('Payout', payoutId)

      if (payout.status === 'payout_paid') return { ready: false, reason: 'already_paid' }
      if (payout.status === 'payout_blocked') {
        return { ready: false, reason: payout.blockedReason ?? 'blocked' }
      }

      if (!payout.holdUntil || !isHoldExpired(payout.holdUntil)) {
        return {
          ready: false,
          reason: `Hold süresi dolmadı. Bitiş: ${payout.holdUntil?.toISOString()}`,
        }
      }

      if (await returnRequests.countOpenByOrderAndSeller(payout.orderId, payout.sellerId)) {
        return { ready: false, reason: 'Açık iade talebi var' }
      }

      if (await disputes.countOpenByOrderAndSeller(payout.orderId, payout.sellerId)) {
        return { ready: false, reason: 'Açık uyuşmazlık var' }
      }

      const seller = await sellers.findActiveById(payout.sellerId)
      if (!seller) {
        return { ready: false, reason: 'Satıcı hesabı aktif değil' }
      }

      const activeBankDetail = await prisma.sellerBankDetail.findFirst({
        where: {
          sellerId: payout.sellerId,
          isActive: true,
          status: 'ACTIVE',
          isVerified: true,
        },
        select: { id: true },
      })
      if (!activeBankDetail) {
        return {
          ready: false,
          reason: 'Doğrulanmış aktif banka hesabı bulunamadı',
        }
      }

      const pendingOrBlockedChange = await prisma.sellerBankDetail.findFirst({
        where: {
          sellerId: payout.sellerId,
          status: { in: ['PENDING_ACTIVATION', 'BLOCKED'] },
        },
        select: { status: true },
      })
      if (pendingOrBlockedChange) {
        return {
          ready: false,
          reason: `Banka hesabı değişikliği incelemede: ${pendingOrBlockedChange.status}`,
        }
      }

      return { ready: true, payout }
    },

    async release(params: { payoutId: string; adminActorId: string; reason?: string }) {
      const readiness = await this.checkReadiness(params.payoutId)
      if (!readiness.ready) {
        throw new PayoutBlockedError(readiness.reason as string)
      }

      const payout = readiness.payout!
      const updated = await payouts.updateStatus(params.payoutId, 'payout_ready')

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'payout_released',
        targetType: 'payout',
        targetId: params.payoutId,
        previousData: { status: payout.status },
        newData: { status: 'payout_ready' },
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
      })

      return updated
    },

    async block(params: { payoutId: string; adminActorId: string; reason: string }) {
      const payout = await payouts.findById(params.payoutId)
      if (!payout) throw new NotFoundError('Payout', params.payoutId)

      const updated = await payouts.block(params.payoutId, params.reason)

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'payout_blocked',
        targetType: 'payout',
        targetId: params.payoutId,
        previousData: { status: payout.status },
        newData: { status: 'payout_blocked', reason: params.reason },
        reason: params.reason,
      })

      return updated
    },

    async markPaid(params: {
      payoutId: string
      adminActorId: string
      batchId?: string
      transferReference?: string
      transferDate: Date
      transferBankName?: string
      transferNote?: string
    }) {
      const owner = await prisma.payout.findUnique({
        where: { id: params.payoutId },
        select: { sellerId: true },
      })
      if (!owner) throw new NotFoundError('Payout', params.payoutId)
      return prisma.$transaction(
        async (tx) => {
          await lockSellerFinance(tx, [owner.sellerId])
          const payouts = createPayoutRepository(tx)
          const ledger = createSellerLedgerRepository(tx)
          const auditLog = createAdminAuditLogRepository(tx)
          const payout = await payouts.findById(params.payoutId)
          if (!payout) throw new NotFoundError('Payout', params.payoutId)
          if (payout.status === 'payout_paid') {
            const sameTransfer =
              payout.transferDate?.getTime() === params.transferDate.getTime() &&
              (payout.transferReference ?? '') === (params.transferReference ?? '') &&
              (payout.transferBankName ?? '') === (params.transferBankName ?? '') &&
              (payout.transferNote ?? '') === (params.transferNote ?? '') &&
              (params.batchId === undefined || payout.batchId === params.batchId)
            if (!sameTransfer)
              throw new ConflictError('Ödeme farklı transfer bilgileriyle zaten kaydedilmiş')
            return payout
          }

          if (payout.status !== 'payout_ready') {
            throw new ConflictError(`Ödeme hazır değil: ${payout.status}`)
          }

          const activeBankDetail = await tx.sellerBankDetail.findFirst({
            where: {
              sellerId: payout.sellerId,
              isActive: true,
              status: 'ACTIVE',
            },
            orderBy: { updatedAt: 'desc' },
          })

          const updated = await payouts.markPaidWithTransfer(params.payoutId, {
            transferDate: params.transferDate,
            paidByAdminId: params.adminActorId,
            ...(params.batchId !== undefined ? { batchId: params.batchId } : {}),
            ...(params.transferReference !== undefined
              ? { transferReference: params.transferReference || null }
              : {}),
            ...(params.transferBankName !== undefined
              ? { transferBankName: params.transferBankName || null }
              : {}),
            ...(params.transferNote !== undefined
              ? { transferNote: params.transferNote || null }
              : {}),
            ...(activeBankDetail
              ? {
                  ibanSnapshot: activeBankDetail.iban,
                  accountHolderSnapshot: activeBankDetail.accountHolder,
                  bankDetailId: activeBankDetail.id,
                }
              : {}),
          })

          const payoutLedgerEntry = await ledger.findByReference({
            sellerId: payout.sellerId,
            type: 'payout',
            referenceType: 'payout',
            referenceId: payout.id,
          })
          if (!payoutLedgerEntry) {
            const transferLabel = params.transferBankName?.trim() || 'EFT'
            const referenceSuffix = params.transferReference?.trim()
              ? ` (Ref: ${params.transferReference.trim()})`
              : ''
            await ledger.createEntry({
              sellerId: payout.sellerId,
              type: 'payout',
              amount: payout.netAmount.negated(),
              eventKey: `payout:paid:${payout.id}`,
              effectiveAt: params.transferDate,
              referenceType: 'payout',
              referenceId: payout.id,
              description: `Satıcı ödemesi — ${transferLabel}${referenceSuffix}`,
              createdBy: params.adminActorId,
              visibleToSeller: true,
            })

            // Reveal accrual entries linked to this payout (sale + commission) so
            // that the seller statement reconciles with the now-visible payout.
            const refundIds = await tx.refundTransaction.findMany({
              where: { orderId: payout.orderId, sellerId: payout.sellerId },
              select: { id: true },
            })
            await tx.sellerLedgerEntry.updateMany({
              where: {
                sellerId: payout.sellerId,
                visibleToSeller: false,
                OR: [
                  {
                    type: 'commission',
                    referenceType: 'payout',
                    referenceId: payout.id,
                  },
                  {
                    type: 'sale',
                    referenceType: 'order',
                    referenceId: payout.orderId,
                  },
                  ...(refundIds.length > 0
                    ? [
                        {
                          type: 'commission' as const,
                          referenceType: 'refund_transaction',
                          referenceId: {
                            in: refundIds.map((refund) => refund.id),
                          },
                        },
                      ]
                    : []),
                ],
              },
              data: { visibleToSeller: true },
            })
          }

          await auditLog.createEntry({
            actorId: params.adminActorId,
            actionType: 'payout_released',
            targetType: 'payout',
            targetId: params.payoutId,
            newData: {
              paidAt: new Date(),
              transferDate: params.transferDate.toISOString(),
              ...(params.transferReference !== undefined
                ? { transferReference: params.transferReference }
                : {}),
              ...(params.transferBankName !== undefined
                ? { transferBankName: params.transferBankName }
                : {}),
              ...(params.transferNote !== undefined ? { transferNote: params.transferNote } : {}),
              ...(activeBankDetail
                ? {
                    ibanSnapshot: activeBankDetail.iban,
                    accountHolderSnapshot: activeBankDetail.accountHolder,
                  }
                : {}),
              ...(params.batchId !== undefined ? { batchId: params.batchId } : {}),
            },
          })

          return updated
        },
        { timeout: 30_000 },
      )
    },

    listForSeller(sellerId: string, skip?: number, take?: number) {
      return payouts.listBySeller({
        sellerId,
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    /** Seller-scoped payout detail — returns null if not found or not owned. */
    findForSeller(payoutId: string, sellerId: string) {
      return payouts.findByIdForSeller(payoutId, sellerId)
    },

    listForAdmin(params: Parameters<typeof payouts.listForAdmin>[0]) {
      return payouts.listForAdmin(params)
    },

    getSummaryBySeller(sellerId: string) {
      return payouts.getSummaryBySeller(sellerId)
    },
  }
}

export type PayoutService = ReturnType<typeof createPayoutService>
