/**
 * Payout Service — payout hold activation, readiness check, release.
 *
 * INVARIANTS:
 * - Payout countdown starts from delivery_confirmed ONLY.
 * - 30-day hold is mandatory after delivery_confirmed.
 * - Open return or dispute BLOCKS payout; manual release never bypasses eligibility.
 * - All payout state changes are auditable.
 */
import { Prisma, type PrismaClient, type Payout } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, PayoutBlockedError, ConflictError, DomainError, ValidationError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { calculateHoldUntil, sumPayoutSnapshot } from '../domain/payout-calculator'
import { lockPayoutEligibility, manualPayoutBlock, readPayoutEligibility } from './payout-eligibility'
import { syncPayoutBatch, syncSellerPayoutBatches } from '../lib/payout-batch-totals'
import { assertRoleCan } from '../lib/authorize'
import { isPayoutSettled, previewPayoutOffset, recordPayoutOffsets } from './payout-debt.service'

interface PayoutServiceDeps {
  prisma: PrismaClient
}

export function createPayoutService({ prisma }: PayoutServiceDeps) {
  const payouts = createPayoutRepository(prisma)
  async function withLockedPayout<T>(id: string, work: (tx: Prisma.TransactionClient, payout: Payout) => Promise<T>) {
    const owner = await prisma.payout.findUnique({ where: { id }, select: { sellerId: true } })
    if (!owner) throw new NotFoundError('Payout', id)
    return prisma.$transaction(async (tx) => {
      await lockSellerFinance(tx, [owner.sellerId])
      await tx.$queryRaw(Prisma.sql`SELECT id FROM payouts WHERE id = ${id} FOR UPDATE`)
      const payout = await tx.payout.findUniqueOrThrow({ where: { id } })
      await lockPayoutEligibility(tx, payout)
      return work(tx, payout)
    }, { timeout: 30_000 })
  }

  async function refreshState(tx: Prisma.TransactionClient, payout: Payout) {
    const eligibility = await readPayoutEligibility(tx, payout)
    if (isPayoutSettled(payout.status)) return { ...eligibility, payout }
    const status = eligibility.manualReason ? 'payout_blocked'
      : !eligibility.holdExpired ? 'hold_active'
      : eligibility.automaticReason ? 'payout_blocked' : 'payout_ready'
    const blockedReason = eligibility.manualReason || eligibility.automaticReason
    const changed = payout.status !== status || payout.blockedReason !== blockedReason ||
      payout.automaticBlockReason !== eligibility.automaticReason
    const updated = changed ? await tx.payout.update({
      where: { id: payout.id },
      data: { status, blockedReason, automaticBlockReason: eligibility.automaticReason },
    }) : payout
    if (changed) await createAdminAuditLogRepository(tx).createEntry({
      actorId: 'system:payout-eligibility',
      actionType: status === 'payout_ready' ? 'payout_released' : 'payout_blocked',
      targetType: 'payout', targetId: payout.id,
      previousData: { status: payout.status, automaticBlockReason: payout.automaticBlockReason },
      newData: { status, automaticBlockReason: eligibility.automaticReason, manualBlockedReason: eligibility.manualReason },
      reason: blockedReason || 'Güncel ödeme koşulları uygun',
    })
    await syncPayoutBatch(tx, payout.batchId)
    return { ...eligibility, payout: updated }
  }

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
              const issuedInvoice = await tx.sellerInvoice.findFirst({
                where: { sellerId, sourceOrderId: params.orderId, type: 'commission' },
                select: { id: true },
              })
              await ledger.createEntry({
                sellerId,
                type: 'commission',
                amount: missingCommission.negated(),
                eventKey: `payout:commission:${payout.id}`,
                effectiveAt: payout.holdStartedAt ?? params.deliveryConfirmedAt,
                referenceType: 'payout',
                referenceId: payout.id,
                description: 'Platform komisyonu (fatura kesilince satıcı ekstresinde görünür)',
                visibleToSeller: isPayoutSettled(payout.status) || Boolean(issuedInvoice),
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
      return withLockedPayout(payoutId, async (tx, payout) => ({
        ...await readPayoutEligibility(tx, payout), payout,
      }))
    },

    async reevaluate(payoutId: string) {
      return withLockedPayout(payoutId, refreshState)
    },

    async paymentContext(payoutId: string) {
      return withLockedPayout(payoutId, async (tx, payout) => {
        const current = await readPayoutEligibility(tx, payout)
        const offset = await previewPayoutOffset(tx, payout, current.snapshot)
        return {
          ready: current.ready && payout.status === 'payout_ready',
          reason: current.reason || (payout.status !== 'payout_ready' ? 'Ödeme uygunluğunu yeniden değerlendirin' : null),
          manualReason: current.manualReason, automaticReason: current.automaticReason,
          amount: offset.transferAmount.toFixed(2), currency: current.currency, snapshot: offset.snapshot,
          grossAmount: payout.grossAmount.toFixed(2), netAmount: current.amount,
          offsetAmount: offset.offsetAmount.toFixed(2), remainingDebt: offset.remainingDebt.toFixed(2),
          bank: current.bank ? {
            id: current.bank.id, iban: current.bank.iban,
            accountHolder: current.bank.accountHolder, bankName: current.bank.bankName,
          } : null,
        }
      })
    },

    async release(params: { payoutId: string; adminActorId: string; reason?: string; clearManualBlock?: boolean }) {
      return withLockedPayout(params.payoutId, async (tx, original) => {
        let payout = original
        if (manualPayoutBlock(payout)) {
          if (!params.clearManualBlock) throw new PayoutBlockedError('Manuel bloke açıkça kaldırılmalı')
          const actor = await tx.user.findUnique({ where: { id: params.adminActorId }, select: { role: true } })
          assertRoleCan(actor?.role || '', 'payout:release')
          if ((params.reason?.trim().length ?? 0) < 5) throw new ValidationError('Bloke kaldırma gerekçesi en az 5 karakter olmalı')
          // Reset legacy status too, otherwise its compatibility fallback remains manual.
          payout = await tx.payout.update({
            where: { id: payout.id },
            data: { manualBlockedAt: null, manualBlockedBy: null, manualBlockedReason: null,
              status: 'hold_active', blockedReason: null },
          })
        }
        const result = await refreshState(tx, payout)
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminActorId, actionType: 'payout_released', targetType: 'payout', targetId: payout.id,
          previousData: { status: original.status, manualBlockedReason: manualPayoutBlock(original) },
          newData: { status: result.payout.status, automaticBlockReason: result.automaticReason,
            manualBlockCleared: Boolean(params.clearManualBlock) },
          ...(params.reason ? { reason: params.reason.trim() } : {}),
        })
        return result.payout
      })
    },

    async block(params: { payoutId: string; adminActorId: string; reason: string }) {
      if (params.reason.trim().length < 5) throw new ValidationError('Bloke gerekçesi en az 5 karakter olmalı')
      return withLockedPayout(params.payoutId, async (tx, payout) => {
        if (isPayoutSettled(payout.status)) throw new ConflictError('Kapanmış hakediş bloke edilemez')
        const updated = await tx.payout.update({ where: { id: payout.id }, data: {
          status: 'payout_blocked', blockedReason: params.reason.trim(),
          manualBlockedAt: new Date(), manualBlockedBy: params.adminActorId,
          manualBlockedReason: params.reason.trim(),
        } })
        await syncPayoutBatch(tx, payout.batchId)
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminActorId, actionType: 'payout_blocked', targetType: 'payout', targetId: payout.id,
          previousData: { status: payout.status },
          newData: { status: updated.status, manualBlockedReason: updated.manualBlockedReason },
          reason: params.reason.trim(),
        })
        return updated
      })
    },

    async markPaid(params: {
      payoutId: string
      adminActorId: string
      batchId?: string
      transferReference?: string
      transferDate: Date
      transferBankName?: string
      transferNote?: string
      expectedSnapshot?: string
      settleWithoutTransfer?: boolean
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
          await tx.$queryRaw(Prisma.sql`SELECT id FROM payouts WHERE id = ${params.payoutId} FOR UPDATE`)
          const payout = await payouts.findById(params.payoutId)
          if (!payout) throw new NotFoundError('Payout', params.payoutId)
          if (payout.status === 'payout_offset') {
            if (params.settleWithoutTransfer) return payout
            throw new ConflictError('Hakediş banka transferi olmadan mahsupla kapatılmış')
          }
          if (payout.status === 'payout_paid') {
            if (params.settleWithoutTransfer) throw new ConflictError('Hakediş banka transferiyle zaten ödenmiş')
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
          await lockPayoutEligibility(tx, payout)
          const eligibility = await readPayoutEligibility(tx, payout)
          if (!eligibility.ready) throw new PayoutBlockedError(eligibility.reason || 'Ödeme uygun değil')
          const activeBankDetail = eligibility.bank!
          const offset = await previewPayoutOffset(tx, payout, eligibility.snapshot)
          if (!params.expectedSnapshot || params.expectedSnapshot !== offset.snapshot) {
            throw new DomainError('Borç, tutar veya banka bilgisi değişti. Güncel bilgileri kontrol ederek yeniden onaylayın.',
              'PAYOUT_SNAPSHOT_CHANGED', 409, { current: {
                amount: offset.transferAmount.toFixed(2), currency: eligibility.currency, snapshot: offset.snapshot,
                grossAmount: payout.grossAmount.toFixed(2), netAmount: eligibility.amount,
                offsetAmount: offset.offsetAmount.toFixed(2), remainingDebt: offset.remainingDebt.toFixed(2),
                bank: { id: activeBankDetail.id, iban: activeBankDetail.iban,
                  accountHolder: activeBankDetail.accountHolder, bankName: activeBankDetail.bankName },
              } })
          }
          if (offset.transferAmount.isZero() !== Boolean(params.settleWithoutTransfer)) {
            throw new ValidationError('Sıfır transfer için mahsupla kapatma, pozitif tutar için ödeme kaydı seçilmeli')
          }
          if (params.batchId !== undefined && params.batchId !== payout.batchId) {
            throw new ConflictError('Hakedişin ödeme partisi değişti')
          }

          await recordPayoutOffsets(tx, payout.id, offset.allocations)
          await tx.payout.update({ where: { id: payout.id }, data: {
            offsetAmount: offset.offsetAmount, settledAt: new Date(),
          } })
          const updated = params.settleWithoutTransfer
            ? await tx.payout.update({ where: { id: payout.id }, data: {
                status: 'payout_offset', paidByAdminId: params.adminActorId,
              } })
            : await payouts.markPaidWithTransfer(params.payoutId, {
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
            if (offset.transferAmount.gt(0)) await ledger.createEntry({
              sellerId: payout.sellerId,
              type: 'payout',
              amount: offset.transferAmount.negated(),
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
              status: updated.status,
              offsetAmount: offset.offsetAmount.toFixed(2),
              transferAmount: offset.transferAmount.toFixed(2),
              ...(params.settleWithoutTransfer ? {} : { paidAt: new Date(), transferDate: params.transferDate.toISOString() }),
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

          await syncSellerPayoutBatches(tx, payout.sellerId)
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

    async listForAdmin(params: Parameters<typeof payouts.listForAdmin>[0]) {
      return payouts.listForAdmin(params)
    },

    getSummaryBySeller(sellerId: string) {
      return payouts.getSummaryBySeller(sellerId)
    },
  }
}

export type PayoutService = ReturnType<typeof createPayoutService>
