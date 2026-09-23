import type { NotificationType, Prisma, PrismaClient } from '@prisma/client'
import { ValidationError } from '../lib/errors'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import {
  ADMIN_OPERATION_TYPES,
  OPS_RECIPIENT_ID,
} from '../lib/notification-policy'
import { getAdminPanelUrl, PLATFORM_LEGAL_INFO } from '../lib/platform-info'
import { recordNotification } from './notification-outbox.service'

/**
 * Admin operation notifications: one e-mail per event to a configured operations
 * mailbox. The number of admin users must not change how many e-mails go out, and
 * the mailbox does not need a user account — so these ride the durable outbox with
 * the reserved `OPS_RECIPIENT_ID` instead of a user id.
 */
export const ADMIN_NOTIFICATION_EVENTS = [
  'order_cancellation',
  'return_requested',
  'dispute_opened',
  'support_ticket',
  'eft_pending',
  'fulfillment_risk',
  'seller_application',
] as const

export type AdminNotificationEvent = (typeof ADMIN_NOTIFICATION_EVENTS)[number]

export const ADMIN_NOTIFICATION_EVENT_LABELS: Record<
  AdminNotificationEvent,
  string
> = {
  order_cancellation: 'Sipariş / adet iptali',
  return_requested: 'İade talebi',
  dispute_opened: 'Uyuşmazlık açıldı',
  support_ticket: 'Yeni destek bileti',
  eft_pending: 'Havale / EFT onayı bekliyor',
  fulfillment_risk: 'Sevk riski',
  seller_application: 'Yeni satıcı başvurusu',
}

export function isAdminNotificationEvent(
  value: string,
): value is AdminNotificationEvent {
  return (ADMIN_NOTIFICATION_EVENTS as readonly string[]).includes(value)
}

type RecipientClient = Pick<
  Prisma.TransactionClient,
  'adminNotificationRecipient'
>
type OutboxClient = Pick<Prisma.TransactionClient, 'notificationOutbox'>

/** Absolute admin panel link for an operation e-mail. */
export function adminPanelLink(path: string) {
  return `${getAdminPanelUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Resolved at record time, so the address in the queued row is the one that was
 * configured when the event happened. A missing row falls back to the platform
 * support mailbox rather than silently dropping the notification.
 */
export async function resolveAdminRecipient(
  tx: RecipientClient,
  event: AdminNotificationEvent,
): Promise<string> {
  const row = await tx.adminNotificationRecipient.findUnique({
    where: { event },
    select: { email: true },
  })
  const email = row?.email?.trim().toLowerCase()
  return email || PLATFORM_LEGAL_INFO.supportEmail
}

export interface AdminOperationNotificationInput {
  event: AdminNotificationEvent
  type: NotificationType
  eventKey: string
  title: string
  body: string
  data: Record<string, unknown>
}

/**
 * Writes the operations notification on the caller's business transaction.
 * Errors are not swallowed: a failure rolls the business change back.
 */
export async function recordAdminOperationNotification(
  tx: RecipientClient & OutboxClient,
  input: AdminOperationNotificationInput,
) {
  if (!ADMIN_OPERATION_TYPES.has(input.type))
    throw new Error(`EMAIL_OPS_TYPE_NOT_ALLOWED:${input.type}`)
  const emailTo = await resolveAdminRecipient(tx, input.event)
  return recordNotification(tx, {
    eventKey: input.eventKey,
    userId: OPS_RECIPIENT_ID,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data,
    emailTo,
  })
}

/* ------------------------------------------------------------------------- */
/* Recipient administration                                                   */
/* ------------------------------------------------------------------------- */

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export function isValidRecipientEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim())
}

export interface AdminNotificationRecipientRow {
  event: AdminNotificationEvent
  label: string
  email: string
  updatedAt: Date | null
}

export function createAdminNotificationRecipientService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  return {
    /** Every event is listed, falling back to the support mailbox when unset. */
    async list(): Promise<AdminNotificationRecipientRow[]> {
      const rows = await prisma.adminNotificationRecipient.findMany()
      const byEvent = new Map(rows.map((row) => [row.event, row]))
      return ADMIN_NOTIFICATION_EVENTS.map((event) => {
        const row = byEvent.get(event)
        return {
          event,
          label: ADMIN_NOTIFICATION_EVENT_LABELS[event],
          email: row?.email ?? PLATFORM_LEGAL_INFO.supportEmail,
          updatedAt: row?.updatedAt ?? null,
        }
      })
    },

    /** Admin authorisation belongs to the route; this guards the data itself. */
    async update(params: {
      actorId: string
      entries: ReadonlyArray<{ event: string; email: string }>
    }) {
      const normalized = params.entries.map((entry) => {
        if (!isAdminNotificationEvent(entry.event))
          throw new ValidationError(`Bilinmeyen bildirim olayı: ${entry.event}`)
        const email = entry.email.trim().toLowerCase()
        if (!isValidRecipientEmail(email))
          throw new ValidationError(`Geçersiz e-posta adresi: ${entry.email}`)
        return { event: entry.event, email }
      })

      await prisma.$transaction(async (tx) => {
        const audit = createAdminAuditLogRepository(tx as PrismaClient)
        for (const entry of normalized) {
          const previous = await tx.adminNotificationRecipient.findUnique({
            where: { event: entry.event },
            select: { email: true },
          })
          if (previous?.email === entry.email) continue
          await tx.adminNotificationRecipient.upsert({
            where: { event: entry.event },
            update: { email: entry.email, updatedByAdminId: params.actorId },
            create: {
              event: entry.event,
              email: entry.email,
              updatedByAdminId: params.actorId,
            },
          })
          await audit.createEntry({
            actorId: params.actorId,
            actionType: 'notification_recipient_changed',
            targetType: 'AdminNotificationRecipient',
            targetId: entry.event,
            previousData: {
              email: previous?.email ?? PLATFORM_LEGAL_INFO.supportEmail,
            },
            newData: { email: entry.email },
          })
        }
      })
    },
  }
}
