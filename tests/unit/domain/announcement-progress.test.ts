/**
 * Announcement progress refresh cadence: SMTP acceptance is not delivery, so the
 * screen keeps waiting for provider results for a bounded time.
 */
import { describe, expect, it } from 'vitest'
import {
  emptyProgressCounts,
  nextProgressPollDelayMs,
  PROGRESS_POLL_ACTIVE_MS,
  PROGRESS_POLL_AWAITING_RESULT_MS,
  safeNotificationErrorCode,
} from '../../../api/domain/announcement-progress'

const now = new Date('2026-09-24T12:00:00.000Z')

describe('nextProgressPollDelayMs', () => {
  it('polls often while rows are being prepared, queued or retried', () => {
    for (const bucket of ['preparing', 'queued', 'retry_pending'] as const) {
      const counts = { ...emptyProgressCounts(), [bucket]: 1 }
      expect(
        nextProgressPollDelayMs({ counts, awaitingResultCount: 0, lastSmtpAcceptedAt: null }, now),
      ).toBe(PROGRESS_POLL_ACTIVE_MS)
    }
  })

  it('keeps polling slowly while accepted rows await a delivery result, for 30 minutes', () => {
    const counts = { ...emptyProgressCounts(), accepted: 3 }
    expect(
      nextProgressPollDelayMs(
        { counts, awaitingResultCount: 3, lastSmtpAcceptedAt: '2026-09-24T11:45:00.000Z' },
        now,
      ),
    ).toBe(PROGRESS_POLL_AWAITING_RESULT_MS)
    expect(
      nextProgressPollDelayMs(
        { counts, awaitingResultCount: 3, lastSmtpAcceptedAt: new Date('2026-09-24T11:25:00.000Z') },
        now,
      ),
    ).toBeNull()
  })

  it('stops when every row has a final result', () => {
    const counts = { ...emptyProgressCounts(), delivered: 5, failed: 1 }
    expect(
      nextProgressPollDelayMs({ counts, awaitingResultCount: 0, lastSmtpAcceptedAt: now }, now),
    ).toBeNull()
  })
})

describe('safeNotificationErrorCode', () => {
  it('shows our codes and hides free-form provider text', () => {
    expect(safeNotificationErrorCode('SEND_FAILED:EENVELOPE:550')).toBe('SEND_FAILED:EENVELOPE:550')
    expect(safeNotificationErrorCode('550 mailbox full for ayse@example.test')).toBe(
      'LEGACY_ERROR_REVIEW_REQUIRED',
    )
    expect(safeNotificationErrorCode(null)).toBeNull()
  })
})
