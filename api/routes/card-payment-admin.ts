/**
 * Yönetici "iyzico ile mutabakat" eylemleri. Yalnız iyzico raporunda kanıtlanan sonucu uygular;
 * kart iadesini körlemesine yeniden göndermez. Her çağrı denetim kaydı yazar.
 */
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '../lib/prisma'
import { handleError, ok } from '../lib/response'
import { NotFoundError } from '../lib/errors'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createRefundExecutionService } from '../services/refund-execution.service'
import { createCardPaymentService } from '../services/card-payment.service'

const reconcileSchema = z.object({
  reason: z.string().trim().min(5, 'Gerekçe en az 5 karakter olmalıdır').max(1000),
})

function requestIp(request: NextRequest) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    undefined
  )
}

export async function reconcileCardRefundByAdmin(
  request: NextRequest,
  refundTransactionId: string,
  actorId: string,
) {
  try {
    const body = reconcileSchema.parse(await request.json().catch(() => null))
    const prisma = createPrismaForRoute()
    const before = await prisma.refundTransaction.findUnique({
      where: { id: refundTransactionId },
      select: { id: true, orderId: true, status: true },
    })
    if (!before) throw new NotFoundError('İade', refundTransactionId)
    const execution = createRefundExecutionService({ prisma })
    const summary = await execution.reconcileCardRefund(refundTransactionId)
    if (summary.reopened > 0) await execution.process(refundTransactionId)
    const after = await prisma.refundTransaction.findUniqueOrThrow({
      where: { id: refundTransactionId },
      select: { status: true },
    })
    const ipAddress = requestIp(request)
    await createAdminAuditLogRepository(prisma).createEntry({
      actorId,
      actionType: 'card_payment_reconciled',
      targetType: 'refund_transaction',
      targetId: refundTransactionId,
      previousData: { status: before.status },
      newData: { status: after.status, ...summary },
      reason: body.reason,
      ...(ipAddress ? { ipAddress } : {}),
    })
    return ok({ id: refundTransactionId, orderId: before.orderId, status: after.status, summary })
  } catch (error) {
    return handleError(error)
  }
}

export async function reconcileCardReversalByAdmin(
  request: NextRequest,
  reversalId: string,
  actorId: string,
) {
  try {
    const body = reconcileSchema.parse(await request.json().catch(() => null))
    const prisma = createPrismaForRoute()
    const before = await prisma.cardAttemptReversal.findUnique({
      where: { id: reversalId },
      include: { attempt: { select: { orderId: true } } },
    })
    if (!before) throw new NotFoundError('Geri ödeme', reversalId)
    const cardPayments = createCardPaymentService({ prisma })
    await cardPayments.reconcileReversal(reversalId)
    const after = await prisma.cardAttemptReversal.findUniqueOrThrow({
      where: { id: reversalId },
      select: { status: true },
    })
    const ipAddress = requestIp(request)
    await createAdminAuditLogRepository(prisma).createEntry({
      actorId,
      actionType: 'card_payment_reconciled',
      targetType: 'card_attempt_reversal',
      targetId: reversalId,
      previousData: { status: before.status },
      newData: { status: after.status },
      reason: body.reason,
      ...(ipAddress ? { ipAddress } : {}),
    })
    return ok({ id: reversalId, orderId: before.attempt.orderId, status: after.status })
  } catch (error) {
    return handleError(error)
  }
}
