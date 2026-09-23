/**
 * Announcement delivery progress (e-mail plan phase 5) — bucket vocabulary and the
 * admin screen's refresh cadence. Pure: shared by the service and the admin UI.
 *
 * SMTP acceptance is not delivery: a row stays in `accepted` until the provider's
 * webhook reports delivered/bounced, which can arrive minutes later.
 */

export const ANNOUNCEMENT_PROGRESS_BUCKETS = [
  'preparing',
  'queued',
  'retry_pending',
  'accepted',
  'delivered',
  'bounced',
  'failed',
  'uncertain',
  'skipped',
  'seller_deleted',
] as const

export type AnnouncementProgressBucket = (typeof ANNOUNCEMENT_PROGRESS_BUCKETS)[number]

export const ANNOUNCEMENT_PROGRESS_LABELS: Record<AnnouncementProgressBucket, string> = {
  preparing: 'Hazırlanıyor',
  queued: 'Kuyrukta',
  retry_pending: 'Yeniden deneme bekliyor',
  accepted: 'SMTP kabul etti',
  delivered: 'Teslim edildi',
  bounced: 'Geri döndü / şikâyet',
  failed: 'Başarısız',
  uncertain: 'Sonuç belirsiz',
  skipped: 'Atlandı',
  seller_deleted: 'Hesap silindi',
}

export function isAnnouncementProgressBucket(value: unknown): value is AnnouncementProgressBucket {
  return (ANNOUNCEMENT_PROGRESS_BUCKETS as readonly unknown[]).includes(value)
}

export type AnnouncementProgressCounts = Record<AnnouncementProgressBucket, number>

export function emptyProgressCounts(): AnnouncementProgressCounts {
  return Object.fromEntries(
    ANNOUNCEMENT_PROGRESS_BUCKETS.map((bucket) => [bucket, 0]),
  ) as AnnouncementProgressCounts
}

/** Rows the system is still working on (the admin can do nothing but wait). */
export function activeProgressCount(counts: AnnouncementProgressCounts): number {
  return counts.preparing + counts.queued + counts.retry_pending
}

export const PROGRESS_POLL_ACTIVE_MS = 10_000
export const PROGRESS_POLL_AWAITING_RESULT_MS = 60_000
/** How long after the last SMTP acceptance the screen keeps waiting for delivery webhooks. */
export const PROGRESS_AWAIT_RESULT_WINDOW_MS = 30 * 60_000

/**
 * Next automatic refresh in ms, or null to stop. Frequent while rows are being
 * prepared or queued; slower while accepted rows still await a delivery result,
 * bounded to 30 minutes after the last acceptance. A manual refresh is always possible.
 */
export function nextProgressPollDelayMs(
  progress: {
    counts: AnnouncementProgressCounts
    awaitingResultCount: number
    lastSmtpAcceptedAt: string | Date | null
  },
  now: Date = new Date(),
): number | null {
  if (activeProgressCount(progress.counts) > 0) return PROGRESS_POLL_ACTIVE_MS
  if (progress.awaitingResultCount > 0 && progress.lastSmtpAcceptedAt) {
    const last = new Date(progress.lastSmtpAcceptedAt).getTime()
    if (Number.isFinite(last) && now.getTime() - last < PROGRESS_AWAIT_RESULT_WINDOW_MS) {
      return PROGRESS_POLL_AWAITING_RESULT_MS
    }
  }
  return null
}

/** Only our own error codes are shown; old provider strings may contain personal data. */
export function safeNotificationErrorCode(value: string | null | undefined): string | null {
  if (!value) return null
  return /^[A-Z_]+(?::[A-Za-z0-9_, ]+)*$/.test(value) ? value : 'LEGACY_ERROR_REVIEW_REQUIRED'
}
