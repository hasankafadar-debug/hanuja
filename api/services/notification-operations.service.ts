import type { PrismaClient } from '@prisma/client'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { recordNotification } from './notification-outbox.service'
import type { NotificationDispatchJobData } from '../jobs/notification-dispatch.job'

export function createNotificationOperationsService(prisma: PrismaClient) {
  async function assertAdmin(actorId: string) {
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    })
    if (actor?.role !== 'admin') throw new ForbiddenError()
  }

  async function list(actorId: string, page = 1, failedOnly = false) {
    await assertAdmin(actorId)
    const where = failedOnly ? { status: 'failed' as const } : {}
    const [deliveries, count, outbox] = await Promise.all([
      prisma.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 30,
        take: 30,
        select: {
          id: true,
          eventKey: true,
          type: true,
          channel: true,
          recipient: true,
          status: true,
          transportStatus: true,
          attemptCount: true,
          lastError: true,
          createdAt: true,
          smtpAcceptedAt: true,
          deliveredAt: true,
          providerMessageId: true,
          payload: true,
        },
      }),
      prisma.notificationDelivery.count({ where }),
      prisma.notificationOutbox.findMany({
        where: { status: { in: ['pending', 'queued', 'failed'] } },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: {
          id: true,
          type: true,
          status: true,
          lastError: true,
          createdAt: true,
        },
      }),
    ])
    return {
      count,
      outbox,
      deliveries: deliveries.map(({ payload, ...row }) => ({
        ...row,
        canRetry:
          row.status === 'failed' &&
          row.transportStatus !== 'uncertain' &&
          !!payload,
        // Old provider error strings may contain personal data; only display our safe codes.
        lastError:
          row.lastError && /^[A-Z_]+(?::[A-Za-z0-9_, ]+)*$/.test(row.lastError)
            ? row.lastError
            : row.lastError
              ? 'LEGACY_ERROR_REVIEW_REQUIRED'
              : null,
      })),
    }
  }

  async function retry(
    actorId: string,
    id: string,
    reason: string,
    kind: 'delivery' | 'outbox',
  ) {
    await assertAdmin(actorId)
    if (reason.trim().length < 10 || reason.length > 500)
      throw new ValidationError(
        'En az 10 karakterlik yeniden deneme gerekçesi yazın.',
      )
    return prisma.$transaction(async (tx) => {
      let outbox
      if (kind === 'delivery') {
        const delivery = await tx.notificationDelivery.findUnique({
          where: { id },
        })
        if (!delivery) throw new NotFoundError('Gönderim')
        if (
          delivery.status !== 'failed' ||
          delivery.transportStatus === 'uncertain' ||
          !delivery.payload
        ) {
          throw new ValidationError(
            'Bu gönderim yeniden denemeye uygun değil. Belirsiz sonuç için sağlayıcı kaydını inceleyin.',
          )
        }
        const changed = await tx.notificationDelivery.updateMany({
          where: {
            id,
            status: 'failed',
            transportStatus: { not: 'uncertain' },
          },
          data: { status: 'pending', lastError: null },
        })
        if (!changed.count)
          throw new ValidationError(
            'Gönderim başka bir işlem tarafından güncellendi.',
          )
        outbox = await recordNotification(
          tx,
          delivery.payload as unknown as NotificationDispatchJobData,
        )
      } else {
        outbox = await tx.notificationOutbox.findUnique({ where: { id } })
        if (!outbox) throw new NotFoundError('Bildirim olayı')
      }
      if (outbox.status === 'queued')
        throw new ValidationError(
          'Bildirim hâlâ kuyrukta; tekrar oluşturulamaz.',
        )
      const uncertain = await tx.notificationDelivery.count({
        where: {
          eventKey: outbox.eventKey,
          userId: outbox.userId,
          transportStatus: 'uncertain',
        },
      })
      if (uncertain)
        throw new ValidationError(
          'SMTP sonucu belirsiz; sağlayıcı kaydı incelenmelidir.',
        )
      const claimed = await tx.notificationOutbox.updateMany({
        where: {
          id: outbox.id,
          generation: outbox.generation,
          status: {
            in:
              kind === 'outbox'
                ? ['failed']
                : ['failed', 'completed', 'pending'],
          },
        },
        data: {
          status: 'pending',
          generation: { increment: 1 },
          queuedAt: null,
          lastError: null,
        },
      })
      if (!claimed.count)
        throw new ValidationError(
          'Bildirim yeniden denemeye uygun değil veya başka bir işlem tarafından güncellendi.',
        )
      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'notification_retry_requested',
          targetType: 'notification_outbox',
          targetId: outbox.id,
          reason: reason.trim(),
          previousData: {
            status: outbox.status,
            generation: outbox.generation,
          },
          newData: { status: 'pending', generation: outbox.generation + 1 },
        },
      })
      return { queued: true }
    })
  }
  return { list, retry }
}
