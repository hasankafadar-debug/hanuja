/**
 * Integration test — campaign discount activation-scan, stateful double-run.
 *
 * Invariant (campaign-discount.job processActivationScan, queue-jobs-plan.md):
 * the periodic sweep must be re-runnable safely. SCHEDULED rules whose startsAt
 * has passed flip to ACTIVE and enqueue exactly one fan-out; ACTIVE rules whose
 * endsAt has passed flip to EXPIRED with no enqueue; and a live ACTIVE rule is
 * left alone. Running the scan a second time must NOT re-enqueue an
 * already-activated rule (status guard) — proven here with a stateful store the
 * two runs share, not with per-call mock return sequencing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface StoredRule {
  id: string
  status: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  seller: { id: string; displayName: string; slug: string }
}

const { rulesState, queueAddMock } = vi.hoisted(() => ({
  rulesState: { rules: [] as unknown[] },
  queueAddMock: vi.fn(),
}))

vi.mock('bullmq', () => ({ Worker: vi.fn() }))
vi.mock('../../api/lib/redis', () => ({ redis: {} }))
vi.mock('../../api/lib/queue', () => ({
  QUEUE_NAMES: { CAMPAIGN_DISCOUNT: 'campaign-discount' },
  campaignDiscountQueue: { add: queueAddMock },
}))

vi.mock('../../api/lib/prisma', () => ({
  prisma: {
    discountRule: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const rules = rulesState.rules as StoredRule[]
        // Only shape used by the scan: SCHEDULED rules whose startsAt has passed.
        const status = where['status'] as StoredRule['status']
        const startsAt = where['startsAt'] as { lte: Date } | undefined
        return rules.filter((rule) => {
          if (rule.status !== status) return false
          if (startsAt && (rule.startsAt === null || rule.startsAt.getTime() > startsAt.lte.getTime())) {
            return false
          }
          return true
        })
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { status: StoredRule['status'] } }) => {
        const rules = rulesState.rules as StoredRule[]
        const id = where['id'] as string | undefined
        const status = where['status'] as StoredRule['status']
        const endsAt = where['endsAt'] as { lt: Date } | undefined
        let count = 0
        for (const rule of rules) {
          if (id !== undefined && rule.id !== id) continue
          if (rule.status !== status) continue
          if (endsAt && (rule.endsAt === null || rule.endsAt.getTime() >= endsAt.lt.getTime())) continue
          rule.status = data.status
          count += 1
        }
        return { count }
      }),
    },
  },
}))

import { processCampaignDiscountJob } from '../../api/jobs/campaign-discount.job'

function activationScanJob() {
  return { id: 'scan-1', name: 'activation-scan', data: {} } as never
}

const NOW = new Date('2026-07-17T12:00:00.000Z')
const PAST = new Date('2026-07-16T00:00:00.000Z')
const FUTURE = new Date('2026-08-01T00:00:00.000Z')
const ENDED = new Date('2026-07-10T00:00:00.000Z')

function seedRules(): StoredRule[] {
  return [
    {
      id: 'rule-due',
      status: 'SCHEDULED',
      startsAt: PAST,
      endsAt: FUTURE,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      seller: { id: 'seller-1', displayName: 'Atelier Noa', slug: 'atelier-noa' },
    },
    {
      id: 'rule-active-live',
      status: 'ACTIVE',
      startsAt: PAST,
      endsAt: FUTURE,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      seller: { id: 'seller-2', displayName: 'Woodform', slug: 'woodform' },
    },
    {
      id: 'rule-active-ended',
      status: 'ACTIVE',
      startsAt: new Date('2026-06-01T00:00:00.000Z'),
      endsAt: ENDED,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      seller: { id: 'seller-3', displayName: 'Kilim Atölyesi', slug: 'kilim-atolyesi' },
    },
  ]
}

describe('campaign discount activation-scan — stateful double-run', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    queueAddMock.mockReset()
    rulesState.rules = seedRules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('first run: activates the due rule (one enqueue), expires the ended rule, leaves the live rule', async () => {
    const result = await processCampaignDiscountJob(activationScanJob())

    expect(result).toEqual({ activated: 1, expired: 1 })
    expect(queueAddMock).toHaveBeenCalledTimes(1)
    expect(queueAddMock).toHaveBeenCalledWith(
      'fan-out',
      expect.objectContaining({
        discountRuleId: 'rule-due',
        discountFingerprint: 'rule-due:2026-07-16T00:00:00.000Z',
        sellerId: 'seller-1',
        sellerName: 'Atelier Noa',
        sellerSlug: 'atelier-noa',
      }),
      expect.objectContaining({ attempts: 3 }),
    )

    const rules = rulesState.rules as StoredRule[]
    expect(rules.find((rule) => rule.id === 'rule-due')?.status).toBe('ACTIVE')
    expect(rules.find((rule) => rule.id === 'rule-active-ended')?.status).toBe('EXPIRED')
    expect(rules.find((rule) => rule.id === 'rule-active-live')?.status).toBe('ACTIVE')
  })

  it('second run over the same store: no re-enqueue and no state churn (status guard holds)', async () => {
    await processCampaignDiscountJob(activationScanJob())
    queueAddMock.mockReset()

    const second = await processCampaignDiscountJob(activationScanJob())

    expect(second).toEqual({ activated: 0, expired: 0 })
    expect(queueAddMock).not.toHaveBeenCalled()

    const rules = rulesState.rules as StoredRule[]
    // rule-due stays ACTIVE (already activated, not re-enqueued); live rule untouched.
    expect(rules.find((rule) => rule.id === 'rule-due')?.status).toBe('ACTIVE')
    expect(rules.find((rule) => rule.id === 'rule-active-live')?.status).toBe('ACTIVE')
    expect(rules.find((rule) => rule.id === 'rule-active-ended')?.status).toBe('EXPIRED')
  })

  it('never enqueues a fan-out when the only work is an expiry', async () => {
    // Drop the due rule; only an ended ACTIVE rule remains.
    rulesState.rules = (rulesState.rules as StoredRule[]).filter((rule) => rule.id !== 'rule-due')

    const result = await processCampaignDiscountJob(activationScanJob())

    expect(result).toEqual({ activated: 0, expired: 1 })
    expect(queueAddMock).not.toHaveBeenCalled()
  })
})
